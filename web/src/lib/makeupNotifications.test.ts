/**
 * Make-up reminders keep each deadline and remain once per patient/scheduled
 * day after progress changes or overlapping notification requests. Execute the
 * actual sync function with fictional database/transaction transports.
 *
 *   npx tsx src/lib/makeupNotifications.test.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { DAY_MS, manilaDayKey } from "./demoClock";
import { joinNames } from "./notificationText";

type Occurrence = {
  id: number;
  patient_id: string;
  patient_name: string;
  therapist_id: string | null;
  exercise_name: string;
  due_key: string;
  last_key: string;
  status: string;
};
type Notice = { user_id: string; title: string; message: string; type: string; occurrence_id: number };

const source = readFileSync(new URL("./db.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("db.ts", source, ts.ScriptTarget.Latest, true);
const names = [
  "syncTimeNotifications", "makeupAvailableRows", "notifyMakeupAvailable",
  "longDateLabel", "manilaHour", "REMINDER_TOMORROW_HOUR_MANILA",
];
const nodes = ast.statements.filter((node) => ts.isFunctionDeclaration(node)
  ? names.includes(node.name?.text ?? "")
  : ts.isVariableStatement(node) && node.declarationList.declarations.some((d) => names.includes(d.name.getText(ast))));
assert(nodes.some((node) => ts.isFunctionDeclaration(node) && node.name?.text === "syncTimeNotifications"));
const production = ts.transpileModule(nodes.map((node) => node.getText(ast)).join("\n"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture() {
  const rows: Occurrence[] = [];
  const notices: Notice[] = [];
  const locks = new Map<string, Promise<void>>();
  let failTherapist = false;
  let released = 0;

  async function query(sql: string, values: any[] = [], pending: Notice[] = []): Promise<{ rows: any[] }> {
    if (sql.includes("COALESCE(eo.makeup_until, eo.due_date) >= $2::date")) {
      return { rows: rows.filter((r) => r.due_key === values[0] && r.last_key >= values[1]
        && (r.status === "pending" || r.status === "in_progress") && (!values[2] || r.patient_id === values[2])) };
    }
    if (sql.includes("FROM notifications")) {
      // A day is already reported even if its linked occurrence has since
      // completed. Retain the earlier query's behavior for regression checks.
      const ids = Array.isArray(values[2]) ? values[2] : rows
        .filter((r) => r.patient_id === values[2] && r.due_key === values[3]).map((r) => r.id);
      return { rows: [...notices, ...pending].filter((n) => n.user_id === values[0] && n.type === values[1] && ids.includes(n.occurrence_id)) };
    }
    if (sql.includes("INSERT INTO notifications")) {
      if (failTherapist && values[3] === "exercise_makeup_available_day") {
        failTherapist = false;
        throw new Error("fictional therapist insert failure");
      }
      pending.push({ user_id: values[0], title: values[1], message: values[2], type: values[3], occurrence_id: values[4] });
      return { rows: [] };
    }
    // Other scheduled reminders are outside these fictional make-up days.
    if (sql.includes("FROM exercise_occurrences")) return { rows: [] };
    throw new Error(`Unexpected fixture query: ${sql}`);
  }
  const pool = {
    query: (sql: string, values?: any[]) => query(sql, values),
    connect: async () => {
      const pending: Notice[] = [];
      let unlock: (() => void) | undefined;
      return {
        query: async (sql: string, values?: any[]) => {
          if (sql === "BEGIN") return { rows: [] };
          if (sql.includes("pg_advisory_xact_lock")) {
            const key = JSON.stringify(values);
            const previous = locks.get(key) ?? Promise.resolve();
            locks.set(key, new Promise<void>((resolve) => { unlock = resolve; }));
            await previous;
            return { rows: [] };
          }
          if (sql === "COMMIT") { notices.push(...pending); pending.length = 0; unlock?.(); return { rows: [] }; }
          if (sql === "ROLLBACK") { pending.length = 0; unlock?.(); return { rows: [] }; }
          return query(sql, values, pending);
        },
        release() { released++; },
      };
    },
  };
  const context: any = vm.createContext({
    exports: {}, pool, console, DAY_MS, manilaDayKey, joinNames,
    getEffectiveNow: async () => new Date("2026-11-09T10:00:00+08:00"),
    createNotification: async (user_id: string, title: string, message: string, type: string, occurrence_id: number) => {
      notices.push({ user_id, title, message, type, occurrence_id });
    },
  });
  vm.runInContext(production, context);
  return {
    due(id: number, exercise: string, last: string, patient = "patient-one", therapist: string | null = "therapist-one") {
      rows.push({ id, patient_id: patient, patient_name: patient, therapist_id: therapist, exercise_name: exercise,
        due_key: "2026-11-08", last_key: last, status: "pending" });
    },
    finish(id: number) { const row = rows.find((r) => r.id === id); assert(row); row.status = "completed"; },
    sync: (patient = "patient-one") => context.exports.syncTimeNotifications(patient) as Promise<void>,
    failTherapistOnce() { failTherapist = true; },
    notices,
    get released() { return released; },
  };
}

let failed = 0;
let passed = 0;
async function test(name: string, run: () => Promise<void>) {
  try { await run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}`, error); }
}

async function main() {
  await test("mixed windows name each exercise's actual deadline for both recipients", async () => {
    const f = fixture();
    f.due(11, "Lateral Arm Raises", "2026-11-09");
    f.due(12, "Arm Hold", "2026-11-11");
    await f.sync();
    assert.equal(f.notices.length, 2);
    for (const notice of f.notices) {
      assert.match(notice.message, /Lateral Arm Raises \(last day: today\)/);
      assert.match(notice.message, /Arm Hold \(last day: November 11, 2026\)/);
      assert(!notice.message.includes("The last day to make them up is today"));
    }
  });
  await test("equal windows retain one common deadline", async () => {
    const f = fixture();
    f.due(11, "Raises", "2026-11-09"); f.due(12, "Hold", "2026-11-09");
    await f.sync();
    assert.equal(f.notices.length, 2);
    for (const notice of f.notices) assert.match(notice.message, /Raises and Hold\. The last day.*today\.$/);
  });
  await test("the first completion and repeated reads do not create new reminders", async () => {
    const f = fixture();
    f.due(11, "Raises", "2026-11-09"); f.due(12, "Hold", "2026-11-11");
    await f.sync(); await f.sync(); f.finish(11); await f.sync();
    assert.equal(f.notices.length, 2);
    f.finish(12); await f.sync(); assert.equal(f.notices.length, 2);
  });
  await test("one therapist's different patients have separate reminder days", async () => {
    const f = fixture();
    f.due(11, "Raises", "2026-11-09"); f.due(12, "Hold", "2026-11-11", "patient-two");
    await f.sync(); await f.sync("patient-two"); await f.sync();
    assert.equal(f.notices.filter((n) => n.user_id === "therapist-one").length, 2);
    assert.equal(f.notices.length, 4);
  });
  await test("overlapping reads produce one reminder per recipient", async () => {
    const f = fixture(); f.due(11, "Raises", "2026-11-09");
    await Promise.all([f.sync(), f.sync()]);
    assert.equal(f.notices.length, 2);
  });
  await test("a failed recipient write rolls back both notices and can be retried", async () => {
    const f = fixture(); f.due(11, "Raises", "2026-11-09"); f.failTherapistOnce();
    await assert.rejects(f.sync(), /fictional therapist insert failure/);
    assert.equal(f.notices.length, 0);
    await f.sync(); assert.equal(f.notices.length, 2);
    assert.equal(f.released, 2);
  });
  await test("a patient without a therapist still receives exactly one reminder", async () => {
    const f = fixture(); f.due(11, "Raises", "2026-11-09", "patient-one", null);
    await f.sync(); await f.sync(); assert.equal(f.notices.length, 1);
  });
  console.log(`${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}
void main();
