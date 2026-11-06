/** Exercise the page's real callbacks with delayed requests that ignore abort. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const filename = fileURLToPath(new URL("./page.tsx", import.meta.url));
const source = readFileSync(filename, "utf8");
const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const found: Record<string, string> = {};
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "paramsFromExisting") found.params = node.getText(ast);
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "togglePatientSelection") found.toggle = node.initializer!.getText(ast);
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "handleConfirmAssign") found.confirm = node.initializer!.getText(ast);
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "handleProgramSelect") found.program = node.initializer!.getText(ast);
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" && node.arguments[1]?.getText(ast) === "[assignPatientIds]") found.load = node.arguments[0].getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
assert(found.params && found.toggle && found.load && found.confirm);
const code = ts.transpileModule(`${found.params}; globalThis.load = ${found.load}; globalThis.toggle = ${found.toggle}; globalThis.confirm = ${found.confirm}; globalThis.program = ${found.program};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function fixture() {
  const requests: { url: string; signal: AbortSignal; resolve(value: unknown): void }[] = [];
  const context = vm.createContext({
    AbortController,
    assignPatientIds: ["patient-a"], existingAssignments: [], assignSelected: new Set(), assignParams: {}, programAddedIds: new Set(), programs: [],
    assignmentRequest: { current: null },
    pendingPayload: [], showToast() {},
    fetch: (url: string, options: { signal: AbortSignal; method?: string }) => options.method === "POST"
      ? Promise.resolve({ ok: true, json: async () => ({}) })
      : new Promise(resolve => {
      requests.push({ url, signal: options.signal, resolve });
    }),
  });
  for (const [setter, field] of Object.entries({
    setAssignPatientIds: "assignPatientIds", setExpandedPatientId: "expandedPatientId",
    setShowValidationErrors: "showValidationErrors", setAssignSelected: "assignSelected",
    setAssignParams: "assignParams", setAssignProgramId: "assignProgramId", setProgramAddedIds: "programAddedIds",
    setExistingAssignments: "existingAssignments", setDeleteSelected: "deleteSelected", setEditingExercises: "editingExercises",
    setAssigning: "assigning", setShowAssignPreview: "showAssignPreview", setAssignErrorMsg: "assignErrorMsg", setShowAssignError: "showAssignError",
  })) context[setter] = (value: unknown) => { context[field] = typeof value === "function" ? value(context[field]) : value; };
  vm.runInContext(code, context);
  async function reply(index: number, exerciseId: string) {
    requests[index].resolve({ json: async () => ({ exercises: [{
      exercise_id: exerciseId, sets: 2, reps: 8, rest_seconds: 60, hold_seconds: 30,
      sequence_index: 1, start_date: "2026-10-01", end_date: "2026-10-07",
      recurrence: "interval", interval_days: 1, weekdays: [], prescribed_side: "left", resistance_type: "none",
    }] }) });
    await new Promise(resolve => setImmediate(resolve));
  }
  function assertEmpty() {
    assert.equal(context.existingAssignments.length, 0);
    assert.equal(context.assignSelected.size, 0);
    assert.equal(Object.keys(context.assignParams).length, 0);
  }
  return { context, requests, reply, assertEmpty };
}

async function run() {
  const multi = fixture();
  const cleanup = multi.context.load();
  multi.context.toggle("patient-b");
  assert.equal(multi.requests[0].signal.aborted, true, "selection invalidates before effect cleanup");
  await multi.reply(0, "a-only");
  multi.assertEmpty();
  cleanup();
  multi.context.load();
  assert.equal(multi.requests.length, 1, "multi-selection must not load one patient's assignments");
  assert.deepEqual(Array.from(multi.context.assignPatientIds), ["patient-a", "patient-b"]);

  const latest = fixture();
  const cleanupA = latest.context.load();
  latest.context.toggle("patient-b");
  latest.context.toggle("patient-a");
  cleanupA();
  latest.context.load();
  await latest.reply(1, "b-only");
  await latest.reply(0, "a-only");
  assert.deepEqual(Array.from(latest.context.assignSelected), ["b-only"], "late A cannot replace B");
  assert.equal(latest.context.assignParams["b-only"].prescribedSide, "left");
  assert.equal(latest.context.assignParams["b-only"].reps, 8, "current single-patient loading still works");

  const unmount = fixture();
  unmount.context.load()();
  await unmount.reply(0, "a-only");
  unmount.assertEmpty();
  assert.equal(unmount.requests[0].signal.aborted, true);

  const deselect = fixture();
  deselect.context.load();
  deselect.context.toggle("patient-a");
  deselect.context.load();
  await deselect.reply(0, "a-only");
  deselect.assertEmpty();

  const strict = fixture();
  strict.context.load()(); // React development setup/cleanup/setup
  strict.context.load();
  await strict.reply(0, "stale");
  strict.assertEmpty();
  await strict.reply(1, "current");
  assert.deepEqual(Array.from(strict.context.assignSelected), ["current"]);

  const submitted = fixture();
  submitted.context.load();
  await submitted.context.confirm();
  assert.equal(submitted.context.showAssignError, undefined, "assignment submission succeeds");
  assert.equal(submitted.requests[0].signal.aborted, true, "successful submission invalidates before clearing selection");
  await submitted.reply(0, "pre-submit-assignment");
  submitted.assertEmpty();

  const programs = fixture();
  programs.context.assignSelected = new Set(["manual-choice"]);
  programs.context.programs = [
    { id: "a", exercises: [{ exerciseId: "manual-choice" }, { exerciseId: "from-a" }] },
    { id: "b", exercises: [{ exerciseId: "from-b" }] },
  ];
  programs.context.program("a");
  assert.deepEqual(Array.from(programs.context.assignSelected).sort(), ["from-a", "manual-choice"]);
  programs.context.program("b");
  assert.deepEqual(Array.from(programs.context.assignSelected).sort(), ["from-b", "manual-choice"]);
  programs.context.program("");
  assert.deepEqual(Array.from(programs.context.assignSelected), ["manual-choice"], "clearing the program preserves a prior manual selection");
  assert.equal(programs.context.programAddedIds.size, 0);
  console.log("Assignment selection: multi-select, replacement, deselect, unmount, effect replay and successful submission passed.");
}
run().catch(error => { console.error(error); process.exitCode = 1; });
