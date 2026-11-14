/** Actual manual-session SQL and terminal lifecycle on connection-private
 * tables only. Supply a loopback DATABASE_URL; never changes public data. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { Client, types } from "pg";
import { PRESCRIPTION_SNAPSHOT_VERSION, SESSION_CONTEXT_VERSION, SESSION_VIDEO_NOTICE_VERSION, resistanceContextFromRow } from "../src/lib/prescriptionContext";

assert(process.env.DATABASE_URL, "DATABASE_URL is required for the private manual-session check");
assert(["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL).hostname), "Use a loopback fixture database");
// Match db.ts: dates identify Manila calendar days, not JavaScript instants.
types.setTypeParser(1082, value => value);
const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000, statement_timeout: 5000 });
const ast = ts.createSourceFile("db.ts", readFileSync(new URL("../src/lib/db.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
const names = ["SessionNotScheduledError", "ManualOccurrenceNotCompletableError", "createCustomExerciseSession", "completeManualOccurrence", "endSession", "completedWithPain"];
const nodes = ast.statements.filter(n => (ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n)) && names.includes(n.name?.text ?? ""));
assert.equal(nodes.length, names.length);
const code = ts.transpileModule(nodes.map(n => n.getText(ast)).join("\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

async function main() {
  await client.connect();
  try {
    await client.query("SET search_path TO pg_temp");
    await client.query(`CREATE TEMP TABLE users (id text, name text, therapist_id text);
      CREATE TEMP TABLE exercises (id text, name text, archived_at timestamptz, monitoring_mode text);
      CREATE TEMP TABLE patient_exercises (id int, patient_id text, exercise_id text, sets int, reps int, rest_seconds int,
        hold_seconds int, sequence_index int, prescribed_side text, resistance_type text, resistance_value numeric,
        resistance_unit text, resistance_label text, archived_at timestamptz);
      CREATE TEMP TABLE exercise_occurrences (id int, patient_exercise_id int, due_date date, makeup_until date,
        status text, cancelled_at timestamptz, completed_at timestamptz, pain_stopped_at timestamptz,
        prescription_snapshot jsonb, prescription_snapshot_version int, prescription_captured_at timestamptz);
      CREATE TEMP TABLE sessions (id int GENERATED ALWAYS AS IDENTITY, patient_id text, patient_exercise_id int,
        exercise_id text, device_info jsonb, occurrence_id int, started_at timestamptz, ended_at timestamptz,
        end_reason text, context_snapshot jsonb, context_snapshot_version int, context_captured_at timestamptz,
        app_revision text, capture_quality_summary jsonb, notes text)`);
    for (const table of ["users", "exercises", "patient_exercises", "exercise_occurrences", "sessions"]) {
      assert.equal((await client.query("SELECT to_regclass($1)::oid = to_regclass($2)::oid AS isolated", [table, `pg_temp.${table}`])).rows[0].isolated, true);
    }
    const query = (sql: string, values?: any[]) => {
      assert(!/\bpublic\s*\./i.test(sql), "fixture SQL cannot reach public tables");
      assert(/^\s*(SELECT\b|BEGIN\b|COMMIT\b|ROLLBACK\b|UPDATE (sessions|exercise_occurrences)\b|INSERT INTO sessions\b)/i.test(sql), sql);
      return client.query(sql, values);
    };
    const notices: string[] = [];
    const context = vm.createContext({ exports: {}, console,
      pool: { query, connect: async () => ({ query, release() {} }) },
      getEffectiveNow: async () => new Date("2026-11-02T04:00:00Z"),
      SESSION_CONTEXT_VERSION, PRESCRIPTION_SNAPSHOT_VERSION, resistanceContextFromRow,
      getAppRevision: () => "private-manual-fixture",
      getPausedProgress: async () => ({ custom: true }), describePausedProgress: () => "custom exercise",
      createNotification: async (_id: string, title: string) => { notices.push(title); },
      emailPainPause: async () => undefined, emailCompletedWithPain: async () => undefined,
    }) as any;
    vm.runInContext(code, context);
    const db = context.exports;
    await client.query("INSERT INTO users VALUES ('fixture-patient','Disposable fixture','fixture-therapist')");
    await client.query("INSERT INTO exercises VALUES ('fixture-custom','Disposable custom exercise',null,'manual')");
    await client.query("INSERT INTO patient_exercises (id,patient_id,exercise_id,sets,reps,rest_seconds,hold_seconds,sequence_index,prescribed_side,resistance_type) VALUES (81,'fixture-patient','fixture-custom',2,5,0,0,0,'both','none')");
    const snapshot = { version: 2, capturedAt: "2026-11-01T04:00:00Z", patientExerciseId: 81, exerciseId: "fixture-custom",
      sets: 4, reps: 12, restSeconds: 90, holdSeconds: 0, sequenceIndex: 0, prescribedSide: "left",
      resistance: { type: "external_weight", value: 2, unit: "kg", label: null }, schedule: { dueDate: "2026-11-02", makeupUntil: "2026-11-02" } };
    await client.query("INSERT INTO exercise_occurrences (id,patient_exercise_id,due_date,makeup_until,status,prescription_snapshot,prescription_snapshot_version) VALUES (91,81,'2026-11-02','2026-11-02','pending',$1,2)", [JSON.stringify(snapshot)]);
    const request = { patientId: "fixture-patient", patientExerciseId: 81, occurrenceId: 91, exerciseId: "fixture-custom",
      preSessionPain: { status: "declined" }, videoConsent: { consentedAt: "2026-11-02T04:00:00Z", notice: SESSION_VIDEO_NOTICE_VERSION } };
    const created = await db.createCustomExerciseSession(request);
    const stored = (await client.query("SELECT context_snapshot FROM sessions WHERE id=$1", [created.id])).rows[0].context_snapshot;
    assert.deepEqual(stored.prescription, snapshot);
    assert.equal(created.runtimePrescription.sets, 4);
    assert.equal(created.runtimePrescription.reps, 12);
    assert.equal(created.runtimePrescription.prescribedSide, "left");
    assert.equal(created.runtimePrescription.resistance.value, 2);
    assert.equal(stored.videoConsent.notice, SESSION_VIDEO_NOTICE_VERSION);
    assert.equal((await client.query("SELECT status FROM exercise_occurrences WHERE id=91")).rows[0].status, "in_progress");
    console.log("PASS manual start preserves the scheduled dose/side/load, records consent and marks the occurrence in progress");

    assert.equal(await db.endSession(created.id, { endReason: "pain" }), true);
    assert.equal((await client.query("SELECT status FROM exercise_occurrences WHERE id=91")).rows[0].status, "pain_stopped");
    assert(notices.includes("Exercise paused because of pain"));
    const count = (await client.query("SELECT count(*)::int AS n FROM sessions")).rows[0].n;
    await assert.rejects(() => db.createCustomExerciseSession(request), db.SessionNotScheduledError);
    await assert.rejects(() => db.completeManualOccurrence(91, "fixture-patient"), db.ManualOccurrenceNotCompletableError);
    assert.equal((await client.query("SELECT count(*)::int AS n FROM sessions")).rows[0].n, count);
    assert.equal(await db.endSession(created.id, { completed: true }), false);
    assert.equal((await client.query("SELECT end_reason FROM sessions WHERE id=$1", [created.id])).rows[0].end_reason, "pain");
    console.log("PASS pain stop changes the scheduled state, blocks restart and legacy completion, and survives stale terminal retries");

    // Simulate rescheduling only within the disposable fixture.
    await client.query("UPDATE exercise_occurrences SET status='pending', pain_stopped_at=null WHERE id=91");
    const restarted = await db.createCustomExerciseSession(request);
    assert.equal(await db.endSession(restarted.id, { completed: true }), true);
    assert.equal((await client.query("SELECT status FROM exercise_occurrences WHERE id=91")).rows[0].status, "completed");
    await assert.rejects(() => db.createCustomExerciseSession(request), db.SessionNotScheduledError);
    assert(notices.includes("Session Completed"));
    console.log("PASS a rescheduled manual task completes through the real terminal writer and cannot start again once completed");

    await client.query("INSERT INTO exercise_occurrences (id,patient_exercise_id,due_date,makeup_until,status) VALUES (92,81,'2026-11-02','2026-11-02','pending')");
    const first = await db.createCustomExerciseSession({ ...request, occurrenceId: 92 });
    const frozen = (await client.query("SELECT prescription_snapshot FROM exercise_occurrences WHERE id=92")).rows[0].prescription_snapshot;
    assert.equal(frozen.version, PRESCRIPTION_SNAPSHOT_VERSION);
    assert.equal(frozen.sets, 2);
    await client.query("UPDATE patient_exercises SET sets=3, reps=9 WHERE id=81");
    const second = await db.createCustomExerciseSession({ ...request, occurrenceId: 92 });
    assert.equal(second.runtimePrescription.sets, 2);
    assert.equal(second.runtimePrescription.reps, 5);
    assert.equal((await client.query("SELECT end_reason FROM sessions WHERE id=$1", [first.id])).rows[0].end_reason, "superseded");
    assert.equal((await client.query("SELECT count(*)::int AS n FROM sessions WHERE ended_at IS NULL")).rows[0].n, 1);
    for (const bad of [{ patientId: "other-patient" }, { patientExerciseId: 999 }, { exerciseId: "other-exercise" }]) {
      await assert.rejects(() => db.createCustomExerciseSession({ ...request, occurrenceId: 92, ...bad }), db.SessionNotScheduledError);
    }
    assert.equal((await client.query("SELECT count(*)::int AS n FROM sessions WHERE ended_at IS NULL")).rows[0].n, 1);
    console.log("PASS first-start snapshot freezes later retries, replaces only open attempts and rejects mismatched ownership/assignment");
    console.log("Private manual-session acceptance passed; no public rows or public sequences read or changed.");
  } finally {
    await client.end();
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
