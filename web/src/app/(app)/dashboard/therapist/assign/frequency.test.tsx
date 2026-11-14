/** The real frequency control and assignment callback must agree on an unset choice. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { renderToStaticMarkup } from "react-dom/server";
import vm from "node:vm";
import ts from "typescript";
import { getExerciseDefinition } from "@/lib/exercises/registry";
import { pastScheduleDate, storedScheduleDates } from "@/lib/exercises/scheduleDates";
import { MAX_INTERVAL_DAYS, MAX_RECURRENCE_SPAN_DAYS, WEEKDAY_SHORT, spanDays } from "@/lib/exercises/occurrences";
import { formatResistanceContext, parseResistanceContext } from "@/lib/prescriptionContext";
import { MAX_PRESCRIPTION_REPS, isPrescriptionCount, maxPrescriptionSets, prescriptionCountError } from "@/lib/prescriptionLimits";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = ["presetIdFor", "fmtDate", "sameWeekdays", "paramsFromExisting", "AssignRow"];
const constants = ["CADENCE_PRESETS", "DEFAULT_REST_SECONDS", "DEFAULT_HOLD_SECONDS"];
const nodes = ast.statements.filter(node =>
  ts.isFunctionDeclaration(node) ? functions.includes(node.name?.text ?? "") :
  ts.isVariableStatement(node) && node.declarationList.declarations.some(d => constants.includes(d.name.getText(ast))));
assert.equal(nodes.length, functions.length + constants.length);
let assign = "";
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "handleAssign") assign = node.initializer!.getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
assert(assign);
const code = ts.transpileModule(nodes.map(node => node.getText(ast)).join("\n") +
  `\nglobalThis.subject = { AssignRow, paramsFromExisting, handleAssign: ${assign} };`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

const defaults = {
  sets: 2, reps: 8, restSeconds: 60, sequenceIndex: 1, scheduledDate: "2026-11-09", endDate: "2026-11-10",
  prescribedSide: "both", resistanceType: "none",
};
function fixture(id = "ex_001", initial: Record<string, unknown> = defaults) {
  const exercise = { id, name: "Fictional exercise", description: "", is_custom: id === "fixture-custom", monitoring_mode: id === "fixture-custom" ? "manual" : "camera" };
  const context: any = vm.createContext({
    exports: {}, require: createRequire(import.meta.url),
    getExerciseDefinition, pastScheduleDate, storedScheduleDates, MAX_INTERVAL_DAYS, MAX_RECURRENCE_SPAN_DAYS,
    WEEKDAY_SHORT, spanDays, formatResistanceContext, parseResistanceContext,
    MAX_PRESCRIPTION_REPS, isPrescriptionCount, maxPrescriptionSets, prescriptionCountError,
    MovementContextFields: () => null, PencilIcon: () => null, TrashIcon: () => null,
    assignPatientIds: ["fixture-patient"], assignSelected: new Set([id]), assignParams: { [id]: { ...initial } },
    exercises: [exercise], existingAssignments: [], todayKey: "2026-11-09", pendingPayload: null, showAssignPreview: false,
  });
  for (const [setter, field] of Object.entries({
    setShowValidationErrors: "showValidationErrors", setAssignErrorMsg: "assignErrorMsg", setShowAssignError: "showAssignError",
    setPendingPayload: "pendingPayload", setPreviewItems: "previewItems", setShowAssignPreview: "showAssignPreview",
  })) context[setter] = (value: unknown) => { context[field] = value; };
  vm.runInContext(code, context);
  function row(existing = false) {
    return context.subject.AssignRow({ exercise, checked: true, params: context.assignParams[id], minDate: "2026-11-09",
      showValidationErrors: Boolean(context.showValidationErrors), isExisting: existing, isEditing: false,
      onToggle() {}, onEdit() {}, onCancelEdit() {}, onParam() {},
      onSchedule: (patch: object) => { context.assignParams[id] = { ...context.assignParams[id], ...patch }; },
    });
  }
  function select(existing = false): any {
    let found: any;
    function walk(node: any) {
      if (!node || typeof node !== "object") return;
      if (node.type === "select" && node.props.id === `frequency-${id}`) found = node;
      const children = node.props?.children;
      if (Array.isArray(children)) children.flat(Infinity).forEach(walk); else walk(children);
    }
    walk(row(existing)); assert(found); return found;
  }
  return { context, row, select, choose: (value: string) => select().props.onChange({ target: { value } }) };
}
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
let passed = 0;
for (const id of ["ex_001", "fixture-custom"]) {
  const f = fixture(id);
  assert.equal(f.select().props.value, "");
  assert.equal(f.select().props.required, true);
  assert.match(renderToStaticMarkup(f.row()), /<option value="" disabled="" selected="">---Select Frequency---<\/option>/);
  f.context.subject.handleAssign();
  assert.match(f.context.assignErrorMsg, /Please select a frequency/);
  assert.equal(f.context.pendingPayload, null, "unset frequency cannot reach assignment preview");
  assert.equal(f.context.showAssignPreview, false);
  assert.equal(f.select().props["aria-invalid"], true);
  f.choose("every_day");
  assert.equal(f.select().props.value, "every_day");
  assert.equal(f.select().props["aria-invalid"], false);
  f.context.subject.handleAssign();
  assert.equal(f.context.showAssignPreview, true);
  assert.equal(f.context.pendingPayload[0].recurrence, "interval");
  assert.equal(f.context.pendingPayload[0].intervalDays, 1);
  passed++;
}
{
  const f = fixture("ex_001", { ...defaults, recurrence: "interval" });
  assert.equal(f.select().props.value, "", "a missing interval must not look like Every day");
  f.context.subject.handleAssign();
  assert.match(f.context.assignErrorMsg, /Please select a frequency/);
  assert.equal(f.context.pendingPayload, null);
  passed++;
}
{
  const f = fixture();
  f.choose("twice_a_week");
  f.context.subject.handleAssign();
  assert.equal(f.context.showAssignPreview, true);
  assert.equal(f.context.pendingPayload[0].recurrence, "weekly");
  assert.equal(f.context.pendingPayload[0].intervalDays, null);
  assert.deepEqual(plain(f.context.pendingPayload[0].weekdays), [1, 4]);
  passed++;
}
{
  const f = fixture();
  f.choose("custom_weekdays");
  f.context.subject.handleAssign();
  assert.match(f.context.assignErrorMsg, /Please pick at least one weekday/);
  assert.equal(f.context.pendingPayload, null);
  passed++;
}
{
  const f = fixture();
  f.context.assignParams.ex_001 = f.context.subject.paramsFromExisting({
    exercise_id: "ex_001", sets: 2, reps: 8, rest_seconds: 60, hold_seconds: 30, sequence_index: 1,
    start_date: "2026-11-09", end_date: "2026-11-10", recurrence: "interval", interval_days: 1, weekdays: [],
    prescribed_side: "both", resistance_type: "none", resistance_value: null, resistance_unit: null, resistance_label: null,
  });
  assert.equal(f.select(true).props.value, "every_day", "saved prescriptions keep their recorded frequency");
  assert.equal(f.select(true).props.disabled, true);
  passed++;
}
console.log(`${passed} assignment-frequency cases passed: placeholder, required choice, explicit daily/weekly, weekday validation and saved prescriptions.`);
