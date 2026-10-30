/** Date correction contracts and opt-in real PostgreSQL transaction acceptance.
 * npx tsx src/lib/sessionDateCorrection.test.tsx [--db]
 * --db creates ONLY connection-private temporary fixtures; no real rows read.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { Client, types } from "pg";
import { loadEnvConfig } from "@next/env";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as correction from "./sessionDateCorrection";
import { DemoClockError, demoClockAllowed, manilaDayKey } from "./demoClock";
import { SessionDateCorrectionPreview } from "../app/(app)/dashboard/admin/SessionDateCorrectionPanel";
import { deriveOccurrenceState } from "./exercises/occurrences";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const transpile = (source: string) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) { await fn(); passed++; console.log(`PASS ${name}`); }
const input = {
  targetAt: "2026-10-27T01:15:00.000Z", expectedStartedAt: "2026-10-26T01:15:00.123456Z",
  expectedRevision: "0", targetOccurrenceId: 11, reason: "Forgot to set the demo date",
};
const prescription = {
  version: 2, patientExerciseId: 1, exerciseId: "exercise", sets: 2, reps: 6,
  restSeconds: 30, holdSeconds: 30, prescribedSide: "left", resistance: { type: "none", value: null, unit: null, label: null },
  capturedAt: "2026-10-20T00:00:00Z", schedule: { dueDate: "2026-10-26", makeupUntil: "2026-10-26" },
};
const sessionFixture: correction.CorrectableSession = {
  id: 1, patientName: "Fixture Patient", exerciseName: "Fixture Exercise", startedAt: "2026-10-26T01:15:00.000Z",
  endedAt: "2026-10-26T01:17:03.500Z", scheduledDay: "2026-10-26", occurrenceId: 10, endReason: "completed",
};

function routes(env: Record<string, string | undefined>, role: string | null, db: any, enabled = true) {
  const response = { NextResponse: { json: (body: any, init?: ResponseInit) => new Response(JSON.stringify(body), { ...init, headers: { "Content-Type": "application/json", ...init?.headers } }) } };
  let authCalls = 0;
  const helper: any = vm.createContext({ exports: {}, process: { env }, console, require: (name: string) => {
    if (name === "next/server") return response;
    if (name === "./auth-server") return { getAuthenticatedUser: async () => { authCalls++; return role ? { id: "admin", role } : null; } };
    if (name === "./demoClock") return { demoClockAllowed };
    if (name === "./db") return { getDemoClockState: db.getDemoClockState ?? (async () => ({ enabled })) };
    if (name === "./sessionDateCorrection") return correction;
    throw new Error(`Unexpected dependency ${name}`);
  } });
  vm.runInContext(transpile(read("./sessionDateCorrectionApi.ts")), helper);
  const load = (path: string) => {
    const context: any = vm.createContext({ exports: {}, console, require: (name: string) => {
      if (name === "next/server") return response;
      if (name === "@/lib/db") return db;
      if (name === "@/lib/sessionDateCorrectionApi") return helper.exports;
      if (name === "@/lib/sessionDateCorrection") return correction;
      if (name === "@/lib/demoClock") return { DemoClockError };
      if (name === "@/lib/auth-server") return { getAuthenticatedUser: async () => role ? { id: "admin", role } : null };
      throw new Error(`Unexpected dependency ${name}`);
    } });
    vm.runInContext(transpile(read(path)), context);
    return context.exports;
  };
  return { list: load("../app/api/demo-clock/sessions/route.ts"), detail: load("../app/api/demo-clock/sessions/[id]/route.ts"), clock: load("../app/api/demo-clock/route.ts"), authCalls: () => authCalls };
}
const request = (body: unknown = input, query = "") => ({ json: async () => body, nextUrl: new URL(`http://fixture/api/demo-clock/sessions${query}`) });
const params = (id = "1") => ({ params: Promise.resolve({ id }) });

async function contracts() {
  await test("strict date, revision, destination, reason and unsupported-field validation", () => {
    assert.equal(correction.parseSessionDateCorrection({ ...input, reason: " reason " }).reason, "reason");
    for (const value of [null, [], {}, { ...input, targetAt: "2026-02-30T00:00:00.000Z" }, { ...input, targetAt: "2026-10-26T10:00" }, { ...input, targetAt: "0000-01-01T00:00:00.000Z" }, { ...input, reason: " " }, { ...input, reason: "x".repeat(501) }, { ...input, expectedRevision: "-1" }, { ...input, targetOccurrenceId: "11" }, { ...input, targetOccurrenceId: 1.5 }, { ...input, completed: true }]) {
      assert.throws(() => correction.parseSessionDateCorrection(value), correction.SessionDateCorrectionError);
    }
    for (const id of ["0", "1.5", "-1", "01", "1x", "2147483648"]) assert.throws(() => correction.parseCorrectionSessionId(id));
    assert.equal(correction.parseSessionDateCorrection({ ...input, targetAt: "2028-02-29T16:30:00.000Z" }).targetAt, "2028-02-29T16:30:00.000Z");
  });
  await test("destination compares recorded dose and context, permits different schedule metadata only", () => {
    assert(correction.sameCorrectionPrescription(prescription, { ...prescription, capturedAt: "different", version: 1, sequenceIndex: 10, schedule: { dueDate: "2026-10-27" } }));
    for (const other of [null, {}, { ...prescription, reps: 7 }, { ...prescription, prescribedSide: "both" }, { ...prescription, patientExerciseId: 2 }, { ...prescription, resistance: { type: "band", label: "light" } }, { ...prescription, version: 3 }]) assert.equal(correction.sameCorrectionPrescription(prescription, other), false);
    assert.equal(correction.correctionStartOnDay("2026-10-26T16:30:45.123Z", "2026-11-01"), "2026-10-31T16:30:45.123Z");
  });
  await test("rendered preview shows date move, preserved duration, and transferred outcome", () => {
    const html = renderToStaticMarkup(createElement(SessionDateCorrectionPreview, { session: sessionFixture, targetAt: input.targetAt, destination: { id: 11, dueDate: "2026-10-27", makeupUntil: "2026-10-27" } }));
    assert(html.includes("2 min 3.5 sec")); assert(html.includes("2026-10-26")); assert(html.includes("2026-10-27"));
    assert(html.includes("completion")); assert(html.includes("old day becomes unfinished"));
    const pain = renderToStaticMarkup(createElement(SessionDateCorrectionPreview, { session: { ...sessionFixture, endReason: "pain" }, targetAt: input.targetAt, destination: { id: 11, dueDate: "2026-10-27", makeupUntil: "2026-10-27" } }));
    assert(pain.includes("pain-stop outcome"));
  });
  await test("all correction routes are default-off and admin-only in development and production", async () => {
    let calls = 0;
    const db = { listCorrectableSessions: async () => { calls++; return { sessions: [], hasMore: false }; }, getSessionDateCorrectionDetail: async () => { calls++; return { session: sessionFixture }; }, correctSessionDate: async () => { calls++; } };
    for (const NODE_ENV of ["development", "production"]) for (const DEMO_CLOCK of [undefined, "off", "on"]) for (const enabled of [false, true]) for (const role of [null, "patient", "therapist", "admin"]) {
      const route = routes({ NODE_ENV, DEMO_CLOCK }, role, db, enabled);
      const expected = DEMO_CLOCK === "off" ? 404 : role === null ? 401 : role !== "admin" ? 403 : !enabled ? 404 : 200;
      const before = calls;
      for (const response of [await route.list.GET(request()), await route.detail.GET(request(), params()), await route.detail.PATCH(request(), params())]) assert.equal(response.status, expected);
      assert.equal(calls - before, expected === 200 ? 3 : 0);
      if (DEMO_CLOCK === "off") assert.equal(route.authCalls(), 0);
    }
  });
  await test("routes reject bad input without writing and expose missing setup, conflicts, and no-store", async () => {
    let calls = 0;
    let failure: unknown;
    const route = routes({ NODE_ENV: "production", DEMO_CLOCK: "on" }, "admin", {
      listCorrectableSessions: async () => ({ sessions: [], hasMore: false }), getSessionDateCorrectionDetail: async () => null,
      correctSessionDate: async () => { calls++; if (failure) throw failure; },
    });
    for (const body of [null, { ...input, reason: "" }, { ...input, patientId: "other" }]) assert.equal((await route.detail.PATCH(request(body), params())).status, 400);
    assert.equal((await route.detail.PATCH(request(), params("1bad"))).status, 400);
    assert.equal(calls, 0);
    for (const query of ["?offset=-1", `?q=${"x".repeat(101)}`]) assert.equal((await route.list.GET(request(null, query))).status, 400);
    assert.equal((await route.detail.GET(request(), params())).status, 404);
    assert.equal((await route.detail.PATCH(request(), params())).headers.get("Cache-Control"), "no-store");
    failure = Object.assign(new Error("missing fixture table"), { code: "42P01" });
    assert.equal((await route.detail.PATCH(request(), params())).status, 503);
    failure = new correction.SessionDateCorrectionError("stale", 409);
    assert.equal((await route.detail.PATCH(request(), params())).status, 409);
  });
}

async function database() {
  types.setTypeParser(1082, value => value);
  loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
  assert(process.env.DATABASE_URL, "Local DATABASE_URL required");
  assert(["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL).hostname), "Only local fixture acceptance is allowed");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  const env: Record<string, string | undefined> = { NODE_ENV: "production" };
  await client.connect();
  try {
    await client.query("SET search_path TO pg_temp");
    await client.query("SET TIME ZONE 'UTC'");
    await client.query(`
      CREATE TEMP TABLE users (id varchar(50) PRIMARY KEY, name text, role text, is_archived boolean, must_change_password boolean);
      CREATE TEMP TABLE exercises (id text PRIMARY KEY, name text, description text, monitoring_mode text DEFAULT 'camera', archived_at timestamptz);
      CREATE TEMP TABLE patient_exercises (id integer PRIMARY KEY, patient_id varchar(50), exercise_id text, sets integer DEFAULT 2, reps integer DEFAULT 6, rest_seconds integer DEFAULT 30, hold_seconds integer DEFAULT 30, sequence_index integer DEFAULT 1, prescribed_side text DEFAULT 'left', resistance_type text DEFAULT 'none', resistance_value numeric, resistance_unit text, resistance_label text, archived_at timestamptz);
      CREATE TEMP TABLE exercise_occurrences (id integer PRIMARY KEY, patient_exercise_id integer, due_date date, makeup_until date, status text, completed_at timestamptz, pain_stopped_at timestamptz, prescription_snapshot jsonb, cancelled_at timestamptz);
      CREATE TEMP TABLE sessions (id integer PRIMARY KEY, patient_id varchar(50), exercise_id text, patient_exercise_id integer, occurrence_id integer REFERENCES exercise_occurrences(id), started_at timestamptz, ended_at timestamptz, end_reason text, context_snapshot jsonb, context_captured_at timestamptz, measurements jsonb);
      CREATE TEMP TABLE rep_events (session_id integer, payload jsonb);
      CREATE TEMP TABLE set_events (session_id integer, payload jsonb);
      CREATE TEMP TABLE raw_frames (session_id integer, payload jsonb);
      CREATE TEMP TABLE session_recordings (session_id integer, payload jsonb);
      CREATE TEMP TABLE notifications (payload jsonb);
    `);
    const ddl = read("../../../scripts/session_date_corrections_pg.sql");
    const createTable = ddl.match(/CREATE TABLE IF NOT EXISTS session_date_corrections[\s\S]*?\n\);/)![0].replace("CREATE TABLE IF NOT EXISTS", "CREATE TEMP TABLE");
    await client.query(createTable);
    const clockDdl = read("../../../scripts/demo_clock_settings_pg.sql");
    await client.query(clockDdl.match(/CREATE TABLE IF NOT EXISTS demo_clock_settings[\s\S]*?\n\);/)![0].replace("CREATE TABLE IF NOT EXISTS", "CREATE TEMP TABLE"));
    assert(ddl.includes("GRANT SELECT, INSERT ON TABLE session_date_corrections TO postural"));
    assert(!/GRANT.*UPDATE/.test(ddl));
    for (const name of ["users", "exercises", "sessions", "exercise_occurrences", "session_date_corrections"]) {
      assert.equal((await client.query("SELECT to_regclass($1)::oid = to_regclass($2)::oid AS isolated", [name, `pg_temp.${name}`])).rows[0].isolated, true);
    }
    const query = (sql: string, values?: any[]) => {
      assert(!/\bpublic\s*\./i.test(sql));
      assert(/^\s*(SELECT\b|BEGIN\b|COMMIT\b|ROLLBACK\b|SET LOCAL TIME ZONE|INSERT INTO (session_date_corrections|demo_clock_settings)\b|UPDATE (sessions|exercise_occurrences|demo_clock_settings)\b)/i.test(sql), sql);
      return client.query(sql, values);
    };
    const source = read("./db.ts");
    const ast = ts.createSourceFile("db.ts", source, ts.ScriptTarget.Latest, true);
    const names = ["mapCorrectableSession", "listCorrectableSessions", "getSessionDateCorrectionDetail", "correctSessionDate", "getPatientOccurrences", "readDemoClockSettings", "getDemoClockState", "getEffectiveNow", "setDemoClockMode", "setDemoClock", "resetDemoClock"];
    const functions = ast.statements.filter(n => ts.isFunctionDeclaration(n) && names.includes(n.name?.text ?? ""));
    assert.equal(functions.length, names.length);
    const context: any = vm.createContext({ exports: {}, console, process: { env }, ...correction, DemoClockError, demoClockAllowed, manilaDayKey,
      // The fixture's exercises table has no guide-video columns, so the schedule query selects NULLs for them.
      hasExerciseVideoColumns: async () => false,
      pool: { query, connect: async () => ({ query, release() {} }) } });
    vm.runInContext(transpile(functions.map(n => n.getText(ast)).join("\n")), context);
    const db = context.exports;
    const route = routes(env, "admin", db);
    const reset = async (endReason = "completed") => {
      await client.query("TRUNCATE pg_temp.session_date_corrections, pg_temp.sessions, pg_temp.exercise_occurrences, pg_temp.users, pg_temp.exercises, pg_temp.patient_exercises, pg_temp.rep_events, pg_temp.set_events, pg_temp.raw_frames, pg_temp.session_recordings, pg_temp.notifications RESTART IDENTITY CASCADE");
      await client.query("INSERT INTO pg_temp.users VALUES ('admin','Fixture Admin','admin',false,false), ('patient','Fixture Patient','patient',false,false), ('therapist','Fixture Therapist','therapist',false,false)");
      await client.query("INSERT INTO pg_temp.demo_clock_settings (id,enabled,offset_ms,updated_by) VALUES (1,true,0,'admin') ON CONFLICT (id) DO UPDATE SET enabled=true,offset_ms=0,updated_by='admin'");
      await client.query("INSERT INTO pg_temp.exercises (id,name) VALUES ('exercise','Fixture Exercise')");
      await client.query("INSERT INTO pg_temp.patient_exercises (id,patient_id,exercise_id) VALUES (1,'patient','exercise'),(2,'patient','exercise')");
      await client.query("INSERT INTO pg_temp.exercise_occurrences (id,patient_exercise_id,due_date,makeup_until,status,prescription_snapshot) VALUES (10,1,'2026-10-26','2026-10-26',$1,$2), (11,1,'2026-10-27','2026-10-27','pending',$2), (12,2,'2026-10-28','2026-10-28','pending',$2)", [endReason === "completed" ? "completed" : endReason === "pain" ? "pain_stopped" : "in_progress", prescription]);
      await client.query("INSERT INTO pg_temp.sessions VALUES (1,'patient','exercise',1,10,'2026-10-26T01:15:00.123456Z','2026-10-26T01:17:03.654321Z',$1,$2,'2026-10-26T01:15:00.123456Z',$3)", [endReason, { prescription, capturedAt: "original", schedule: prescription.schedule }, { reps: 12, score: 79.4 }]);
      await client.query("UPDATE pg_temp.exercise_occurrences SET completed_at = CASE WHEN status='completed' THEN '2026-10-26T01:17:03.654321Z'::timestamptz END, pain_stopped_at = CASE WHEN status='pain_stopped' THEN '2026-10-26T01:17:03.654321Z'::timestamptz END WHERE id=10");
      for (const name of ["rep_events", "set_events", "raw_frames", "session_recordings"]) await client.query(`INSERT INTO pg_temp.${name} VALUES (1,$1)`, [{ startTs: 123456, endTs: 234567, samples: [1, 2, 3] }]);
      await client.query("INSERT INTO pg_temp.notifications VALUES ($1)", [{ original: true }]);
    };
    const snapshot = async () => {
      const data: any = {};
      for (const name of ["sessions", "exercise_occurrences", "session_date_corrections", "rep_events", "set_events", "raw_frames", "session_recordings", "notifications"]) data[name] = (await client.query(`SELECT to_jsonb(t) AS row FROM pg_temp.${name} t ORDER BY to_jsonb(t)::text`)).rows.map(r => r.row);
      return data;
    };
    const patch = (value: any = input) => route.detail.PATCH(request(value), params());
    await test("real admin switch activates correction access without restart and clears offsets on disable", async () => {
      await reset();
      const before = await snapshot();
      assert.equal((await route.clock.PATCH(request({ enabled: false }))).status, 200);
      assert.equal((await route.list.GET(request())).status, 404);
      await assert.rejects(db.correctSessionDate(1, "admin", input), (error: any) => error.status === 404);
      assert.equal((await route.clock.PATCH(request({ enabled: true }))).status, 200);
      assert.equal((await route.list.GET(request())).status, 200);
      const targetAt = new Date(Date.now() + 3 * 86400000).toISOString();
      assert.equal((await route.clock.PUT(request({ targetAt }))).status, 200);
      const state = await db.getDemoClockState();
      assert(state.enabled && state.isOverridden); assert(Math.abs((await db.getEffectiveNow()).getTime() - Date.parse(targetAt)) < 2000);
      await route.clock.PATCH(request({ enabled: true }));
      assert.equal((await db.getDemoClockState()).offsetMs, state.offsetMs);
      await route.clock.DELETE(request());
      assert.equal((await db.getDemoClockState()).enabled, true); assert.equal((await db.getDemoClockState()).offsetMs, 0);
      await route.clock.PUT(request({ targetAt }));
      await route.clock.PATCH(request({ enabled: false }));
      assert.equal((await db.getDemoClockState()).enabled, false); assert.equal((await db.getDemoClockState()).offsetMs, 0);
      assert.equal((await route.clock.PUT(request({ targetAt }))).status, 409, "stale date save cannot revive disabled mode");
      await route.clock.PATCH(request({ enabled: true }));
      assert.equal((await db.getDemoClockState()).offsetMs, 0);
      assert.deepEqual(await snapshot(), before, "toggle changes settings only, never recorded history");
    });
    await test("real legacy-schema upgrade defaults off and ignores an old saved offset", async () => {
      await client.query("UPDATE pg_temp.demo_clock_settings SET offset_ms=86400000");
      await client.query("ALTER TABLE pg_temp.demo_clock_settings DROP COLUMN enabled");
      assert.equal((await db.getDemoClockState()).available, false);
      await client.query(clockDdl.match(/ALTER TABLE demo_clock_settings ADD COLUMN[^;]+;/)![0]);
      assert.equal((await db.getDemoClockState()).enabled, false);
      assert.equal((await db.getDemoClockState()).offsetMs, 0);
      await route.clock.PATCH(request({ enabled: true }));
      assert.equal((await db.getDemoClockState()).offsetMs, 0);
    });
    await test("actual PATCH and SQL move a completed session and calendar outcome atomically", async () => {
      await reset();
      const before = await snapshot();
      const detail = await db.getSessionDateCorrectionDetail(1);
      assert.equal(detail.session.startedAt, input.expectedStartedAt);
      assert.deepEqual(Array.from(detail.destinations, (d: any) => d.id), [10, 11]);
      const beforeTime = Date.now();
      const response = await patch(); assert.equal(response.status, 200, await response.text());
      const after = await snapshot();
      const session = after.sessions[0];
      assert.equal(session.occurrence_id, 11); assert.equal(Date.parse(session.started_at), Date.parse(input.targetAt));
      const originalFields = (s: any) => Object.fromEntries(Object.entries(s).filter(([key]) => !["started_at", "ended_at", "occurrence_id"].includes(key)));
      assert.deepEqual(originalFields(session), originalFields(before.sessions[0]));
      for (const name of ["rep_events", "set_events", "raw_frames", "session_recordings", "notifications"]) assert.deepEqual(after[name], before[name]);
      assert.equal(after.exercise_occurrences[0].status, "pending"); assert.equal(after.exercise_occurrences[0].completed_at, null);
      assert.equal(after.exercise_occurrences[1].status, "completed"); assert.equal(after.exercise_occurrences[1].completed_at, session.ended_at);
      assert.deepEqual(after.exercise_occurrences[2], before.exercise_occurrences[2]);
      const audit = after.session_date_corrections[0];
      assert.equal(audit.old_occurrence_id, 10); assert.equal(audit.new_occurrence_id, 11);
      assert.deepEqual(audit.source_before, before.exercise_occurrences[0]); assert.deepEqual(audit.source_after, after.exercise_occurrences[0]);
      assert.deepEqual(audit.destination_before, before.exercise_occurrences[1]); assert.deepEqual(audit.destination_after, after.exercise_occurrences[1]);
      assert(Date.parse(audit.corrected_at) >= beforeTime - 1000 && Date.parse(audit.corrected_at) <= Date.now() + 1000);
      assert.equal((await client.query("SELECT (new_ended_at-new_started_at)=(old_ended_at-old_started_at) AS exact FROM pg_temp.session_date_corrections")).rows[0].exact, true);
      const readback = await db.getSessionDateCorrectionDetail(1);
      assert.equal(readback.session.scheduledDay, "2026-10-27"); assert.equal(readback.history[0].oldScheduledDay, "2026-10-26");
      assert.equal((await db.listCorrectableSessions("Fixture", 0)).sessions[0].startedAt, readback.session.startedAt);
      assert.equal((await db.listCorrectableSessions("%", 0)).sessions.length, 0, "wildcards are literal");
      const schedule = await db.getPatientOccurrences("patient");
      const state = (id: number) => {
        const occurrence = schedule.find((o: any) => o.id === id);
        return deriveOccurrenceState({ dueDate: occurrence.due_date, makeupUntil: occurrence.makeup_until, status: occurrence.status }, "2026-10-27");
      };
      assert.equal(state(10), "missed", "actual patient schedule reader no longer counts the old day as completed");
      assert.equal(state(11), "completed", "actual patient schedule reader counts the destination as completed");
    });
    await test("stale revisions and stale timestamps cannot change a corrected session", async () => {
      const before = await snapshot();
      assert.equal((await patch()).status, 409);
      assert.deepEqual(await snapshot(), before);
      const detail = await db.getSessionDateCorrectionDetail(1);
      assert.equal((await patch({ ...input, expectedStartedAt: detail.session.startedAt, targetAt: "2026-10-27T02:00:00.000Z" })).status, 409);
    });
    await test("return to original day is another audited correction, preserving the first record", async () => {
      const detail = await db.getSessionDateCorrectionDetail(1);
      assert.equal((await patch({ ...input, expectedStartedAt: detail.session.startedAt, expectedRevision: detail.revision, targetOccurrenceId: 10, targetAt: input.expectedStartedAt })).status, 200);
      const readback = await db.getSessionDateCorrectionDetail(1);
      assert.equal(readback.history.length, 2); assert.equal(readback.session.startedAt, input.expectedStartedAt);
      const before = await snapshot();
      assert.equal((await patch()).status, 409, "ABA stale edit is rejected even when original date matches");
      assert.deepEqual(await snapshot(), before);
    });
    await test("same-day time corrections shift completion time; cross-DST moves preserve duration", async () => {
      await reset(); await client.query("SET TIME ZONE 'America/New_York'");
      assert.equal((await patch({ ...input, targetOccurrenceId: 10, targetAt: "2026-10-26T02:00:00.000Z" })).status, 200);
      assert.equal((await client.query("SELECT o.completed_at=s.ended_at AS same FROM pg_temp.sessions s JOIN pg_temp.exercise_occurrences o ON o.id=s.occurrence_id")).rows[0].same, true);
      assert.equal((await client.query("SELECT (new_ended_at-new_started_at)=(old_ended_at-old_started_at) AS exact FROM pg_temp.session_date_corrections")).rows[0].exact, true);
      await reset();
      await client.query("UPDATE pg_temp.exercise_occurrences SET due_date=CASE WHEN id=10 THEN '2026-10-30'::date ELSE '2026-11-02'::date END, makeup_until=CASE WHEN id=10 THEN '2026-10-30'::date ELSE '2026-11-02'::date END WHERE id IN (10,11)");
      await client.query("UPDATE pg_temp.sessions SET started_at='2026-10-30T12:00Z', ended_at='2026-10-30T14:00Z' WHERE id=1");
      assert.equal((await patch({ ...input, expectedStartedAt: "2026-10-30T12:00:00.000Z", targetAt: "2026-11-02T12:00:00.000Z" })).status, 200);
      assert.equal((await client.query("SELECT ended_at-started_at=interval '2 hours' AS exact FROM pg_temp.sessions WHERE id=1")).rows[0].exact, true);
      await client.query("SET TIME ZONE 'UTC'");
    });
    await test("pain outcomes and partial attempts retain their meaning; earlier partial history stays", async () => {
      for (const reason of ["pain", "user"]) {
        await reset(reason);
        await client.query("INSERT INTO pg_temp.sessions (id,patient_id,exercise_id,patient_exercise_id,occurrence_id,started_at,ended_at,end_reason) VALUES (2,'patient','exercise',1,10,'2026-10-26T00:00Z','2026-10-26T00:01Z','user')");
        const before = (await snapshot()).sessions.find((s: any) => s.id === 2);
        assert.equal((await patch()).status, 200);
        const after = await snapshot();
        assert.deepEqual(after.sessions.find((s: any) => s.id === 2), before);
        assert.equal(after.exercise_occurrences[0].status, "in_progress");
        assert.equal(after.exercise_occurrences[1].status, reason === "pain" ? "pain_stopped" : "in_progress");
        assert.equal(after.exercise_occurrences[1].completed_at, null);
      }
    });
    await test("invalid destinations, active work, changed doses and ambiguous outcomes roll back completely", async () => {
      const cases: Array<[string, string?, any?]> = [
        ["occupied", "UPDATE pg_temp.exercise_occurrences SET status='completed' WHERE id=11"],
        ["cancelled", "UPDATE pg_temp.exercise_occurrences SET cancelled_at=now() WHERE id=11"],
        ["changed dose", "UPDATE pg_temp.exercise_occurrences SET prescription_snapshot=jsonb_set(prescription_snapshot,'{reps}','7') WHERE id=11"],
        ["unknown snapshot", "UPDATE pg_temp.sessions SET context_snapshot=NULL WHERE id=1"],
        ["active selected", "UPDATE pg_temp.sessions SET ended_at=NULL WHERE id=1"],
        ["invalid duration", "UPDATE pg_temp.sessions SET ended_at=started_at-interval '1 second' WHERE id=1"],
        ["different prescription", undefined, { targetOccurrenceId: 12, targetAt: "2026-10-28T01:00:00.000Z" }],
        ["outside window", undefined, { targetAt: "2026-10-26T15:59:59.999Z" }],
        ["another active attempt", "INSERT INTO pg_temp.sessions (id,occurrence_id,started_at) VALUES (2,10,now())"],
        ["destination has attempt", "INSERT INTO pg_temp.sessions (id,occurrence_id,started_at,ended_at,end_reason) VALUES (2,11,now(),now(),'user')"],
        ["another terminal", "INSERT INTO pg_temp.sessions (id,occurrence_id,started_at,ended_at,end_reason) VALUES (2,10,now(),now(),'completed')"],
      ];
      for (const [label, sql, changes] of cases) {
        await reset(); if (sql) await client.query(sql);
        const before = await snapshot();
        const response = await patch({ ...input, ...changes }); assert([400, 409].includes(response.status), `${label}: ${response.status}`);
        assert.deepEqual(await snapshot(), before, label);
      }
    });
    await test("Manila midnight and make-up windows select the intended day", async () => {
      await reset();
      assert.equal((await patch({ ...input, targetAt: "2026-10-26T16:00:00.000Z" })).status, 200);
      await reset(); await client.query("UPDATE pg_temp.exercise_occurrences SET makeup_until='2026-10-29' WHERE id=11");
      assert.equal((await patch({ ...input, targetAt: "2026-10-28T16:00:00.000Z" })).status, 200);
    });
    await test("DB writer independently checks opt-in and current active-admin identity", async () => {
      await reset(); const before = await snapshot();
      for (const actor of ["patient", "therapist", "missing"]) await assert.rejects(db.correctSessionDate(1, actor, input), (e: any) => e.status === 403);
      await client.query("UPDATE pg_temp.users SET must_change_password=true WHERE id='admin'");
      await assert.rejects(db.correctSessionDate(1, "admin", input), (e: any) => e.status === 403);
      env.DEMO_CLOCK = "off";
      await assert.rejects(db.correctSessionDate(1, "admin", input), (e: any) => e.status === 404);
      env.DEMO_CLOCK = "on";
      assert.deepEqual(await snapshot(), before);
    });
    await test("missing audit setup fails closed; failure after occurrence updates rolls everything back", async () => {
      await reset();
      const before = await snapshot();
      await client.query("ALTER TABLE pg_temp.session_date_corrections ADD CONSTRAINT fixture_reject CHECK (reason <> 'force rejection')");
      await assert.rejects(db.correctSessionDate(1, "admin", { ...input, reason: "force rejection" }), (e: any) => e.code === "23514");
      assert.deepEqual(await snapshot(), before);
      await client.query("DROP TABLE pg_temp.session_date_corrections");
      const noTableBefore = (await client.query("SELECT to_jsonb(s) AS row FROM pg_temp.sessions s")).rows;
      assert.equal((await db.getSessionDateCorrectionDetail(1)).available, false);
      assert.equal((await patch()).status, 503);
      assert.deepEqual((await client.query("SELECT to_jsonb(s) AS row FROM pg_temp.sessions s")).rows, noTableBefore);
    });
  } finally {
    await client.end(); // PostgreSQL drops every private fixture and its sequence.
  }
}

async function main() {
  await contracts();
  if (process.argv.includes("--db")) await database();
  console.log(`${passed} checks passed${process.argv.includes("--db") ? "; all database fixtures were temporary" : ""}.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
