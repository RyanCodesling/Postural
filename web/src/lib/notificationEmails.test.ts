/**
 * Notification emails cannot hold up the app or skip anything (Codex review
 * 2026-10-15, findings 4 and 5). Ending a session for pain does not wait for
 * the mail server. Each daily summary covers one finished Manila day, so an
 * exercise completed late in the evening is still emailed. A summary whose
 * query fails after its claim releases the claim, and holds are named by their
 * time, not repetitions (Codex review 2026-10-19, findings 3 and 4).
 *
 * The production functions are taken from db.ts unchanged and run against
 * in-memory database and mail stand-ins: no email is sent and no database is
 * touched.
 *
 *   npx tsx src/lib/notificationEmails.test.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { transpile } from "../../scripts/lib/cameraReplayHarness";
import { DAY_MS, manilaDayKey } from "./demoClock";
import { isIsometricExercise, prescriptionTargetText } from "./exercises/prescriptionDisplay";
import { describePausedProgress } from "./email";

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`      ${err instanceof Error ? err.message : String(err)}`);
    failed += 1;
  }
}

const unhandled: unknown[] = [];
process.on("unhandledRejection", (reason) => unhandled.push(reason));

const source = readFileSync(new URL("./db.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("db.ts", source, ts.ScriptTarget.Latest, true);
/** The named top-level functions and constants of db.ts, transpiled unchanged. */
function production(names: string[]) {
  const nodes = ast.statements.filter((n) =>
    ts.isFunctionDeclaration(n)
      ? names.includes(n.name?.text ?? "")
      : ts.isVariableStatement(n) && n.declarationList.declarations.some((d) => names.includes(d.name.getText(ast))));
  assert.equal(nodes.length, names.length, `db.ts must define ${names.join(", ")}`);
  return transpile(nodes.map((n) => n.getText(ast)).join("\n"));
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const timeout = (ms: number) => new Promise((resolve) => setTimeout(() => resolve("timed out"), ms));

/** endSession with an in-memory database; `mail` stands in for each pain-pause email. */
function endSessionHarness(mail: (role: string) => Promise<boolean>, lookupFails = false, holdExercise = false) {
  const state = { committed: false, notifications: [] as string[], mails: [] as string[], errors: [] as string[], details: [] as any[] };
  const transaction = {
    query: async (sql: string) => {
      if (sql === "COMMIT") state.committed = true;
      return { rows: sql.includes("SELECT occurrence_id") ? [{ occurrence_id: 1, ended_at: null }] : [] };
    },
    release() {},
  };
  const pool = {
    connect: async () => transaction,
    query: async (sql: string, values: any[] = []) => {
      if (sql.includes("SELECT s.patient_id")) {
        return { rows: [{ patient_id: "p", patient_name: "Fixture patient", therapist_id: "t", exercise_name: "Raise", occurrence_id: 1 }] };
      }
      if (sql.includes("prescription_snapshot")) {
        return { rows: [holdExercise ? { sets: 3, reps: 10, hold_seconds: 30, exercise_id: "ex_006" } : { sets: 3, reps: 10 }] };
      }
      if (sql.includes("SELECT set_index")) return { rows: [{ set_index: 2, reps: 4 }] };
      if (sql.includes("FROM set_events") && sql.includes("min_reached")) return { rows: [{ done: 1 }] };
      if (sql.includes("SELECT email, name")) {
        if (lookupFails) throw new Error("fixture lookup failure");
        return { rows: [{ email: `${values[0]}@example.invalid`, name: String(values[0]) }] };
      }
      throw new Error(`Unexpected fixture query: ${sql}`);
    },
  };
  const context: any = vm.createContext({
    exports: {}, pool,
    console: { error: (message: unknown) => state.errors.push(String(message)), warn() {}, log() {} },
    getEffectiveNow: async () => new Date("2026-10-15T12:00:00Z"),
    isIsometricExercise, prescriptionTargetText,
    createNotification: async (_to: string, title: string) => { state.notifications.push(title); },
    describePausedProgress: () => "paused in set 2 of 3 after 4 of 10 reps",
    sendExercisePausedEmail: (_email: string, _name: string, details: unknown, role: string) => {
      state.mails.push(role);
      state.details.push(details);
      return mail(role);
    },
  });
  vm.runInContext(production(["endSession", "getPausedProgress", "emailPainPause"]), context);
  return { endSession: context.exports.endSession as (id: number, data: any) => Promise<boolean>, state };
}

/** sendDailyTherapistDigests with one therapist, an in-memory claim table and a recording mailer. */
function digestHarness() {
  const claims = new Set<string>();
  const completions: Array<{ day: string; row: any }> = [];
  const sent: Array<{ kind: string; dayLabel: string; items: any[] }> = [];
  // The therapist's patients' occurrences by due day, for the partial-day email.
  const dueRows: Array<{ day: string; row: any }> = [];
  let now = new Date();
  let failNext = false;
  let failNextQuery = false;
  const pool = {
    query: async (sql: string, values: any[] = []) => {
      if (sql.includes("SELECT id, email, name, role")) {
        return { rows: [{ id: "t", role: "therapist", name: "Fixture therapist", email: "t@example.invalid" }] };
      }
      if (sql.includes("INSERT INTO notification_email_digests")) {
        const key = values.join("|");
        if (claims.has(key)) return { rows: [] };
        claims.add(key);
        return { rows: [{ day: values[2] }] };
      }
      if (sql.includes("DELETE FROM notification_email_digests")) {
        claims.delete(values.join("|"));
        return { rows: [] };
      }
      if (sql.includes("AS session_id")) {
        return { rows: dueRows.filter((r) => r.day === values[1]).map((r) => r.row) };
      }
      if (sql.includes("prescription_snapshot") && sql.includes("FROM sessions s")) {
        return { rows: [{ sets: 3, reps: 10, exercise_id: "ex_001" }] };
      }
      if (sql.includes("SELECT set_index")) return { rows: [{ set_index: 2, reps: 4 }] };
      // Stands in for the SQL filter on the Manila day of completed_at.
      if (sql.includes("eo.status = 'completed'")) {
        if (failNextQuery) {
          failNextQuery = false;
          throw new Error("fixture transient query failure");
        }
        return { rows: completions.filter((c) => c.day === values[1]).map((c) => c.row) };
      }
      if (sql.includes("eo.status NOT IN")) return { rows: [] };
      throw new Error(`Unexpected fixture query: ${sql}`);
    },
  };
  const context: any = vm.createContext({
    exports: {}, pool, console: { error() {} },
    emailConfigured: () => true,
    getEffectiveNow: async () => now,
    manilaDayKey, DAY_MS, prescriptionTargetText, isIsometricExercise, describePausedProgress,
    sendExerciseDigestEmail: async (_email: string, _name: string, kind: string, dayLabel: string, items: any[]) => {
      if (failNext) {
        failNext = false;
        return false;
      }
      sent.push({ kind, dayLabel, items });
      return true;
    },
    sendPartialDayEmail: async (_email: string, _name: string, dayLabel: string, patients: any[]) => {
      sent.push({ kind: "partial", dayLabel, items: patients });
      return true;
    },
  });
  vm.runInContext(production([
    "longDateLabel", "manilaHour", "sendDigestOnce", "DIGEST_HOUR_MANILA", "sendDailyTherapistDigests",
    "partialDayPatients", "getPausedProgress",
  ]), context);
  return {
    due: (day: string, row: Record<string, unknown>) => dueRows.push({
      day,
      row: { patient_id: "p", patient_name: "Fixture patient", sets: 3, reps: 10, exercise_id: "ex_001", session_id: null, ...row },
    }),
    /** Runs the hourly check at a Manila time such as "2026-10-15T20:10". */
    check: async (manila: string) => {
      now = new Date(`${manila}:00+08:00`);
      await context.exports.sendDailyTherapistDigests();
    },
    complete: (manila: string, row: Record<string, unknown> = {}) => completions.push({
      day: manila.slice(0, 10),
      row: { patient_name: "Fixture patient", exercise_name: "Raise", due_date: manila.slice(0, 10), sets: 1, reps: 4, ...row },
    }),
    failNextSend: () => { failNext = true; },
    failNextQuery: () => { failNextQuery = true; },
    sent, claims,
  };
}

/** sendExerciseReminderEmails with one patient, an in-memory claim table and a recording mailer. */
function reminderHarness() {
  const claims = new Set<string>();
  const dueRows: Array<{ day: string; name: string }> = [];
  const sent: Array<{ when: string; dayLabel: string; names: string[] }> = [];
  let now = new Date();
  let failNext = false;
  const pool = {
    query: async (sql: string, values: any[] = []) => {
      if (sql.includes("SELECT id, email, name FROM users")) {
        return { rows: [{ id: "p", name: "Fixture patient", email: "p@example.invalid" }] };
      }
      if (sql.includes("INSERT INTO notification_email_digests")) {
        const key = values.join("|");
        if (claims.has(key)) return { rows: [] };
        claims.add(key);
        return { rows: [{ day: values[2] }] };
      }
      if (sql.includes("DELETE FROM notification_email_digests")) {
        claims.delete(values.join("|"));
        return { rows: [] };
      }
      if (sql.includes("eo.status = ANY")) {
        return {
          rows: dueRows.filter((r) => r.day === values[1])
            .map((r) => ({ exercise_name: r.name, sets: 3, reps: 10, exercise_id: "ex_001" })),
        };
      }
      throw new Error(`Unexpected fixture query: ${sql}`);
    },
  };
  const context: any = vm.createContext({
    exports: {}, pool, console: { error() {} },
    emailConfigured: () => true,
    getEffectiveNow: async () => now,
    manilaDayKey, DAY_MS, prescriptionTargetText,
    sendExerciseReminderEmail: async (_email: string, _name: string, when: string, dayLabel: string, items: any[]) => {
      if (failNext) {
        failNext = false;
        return false;
      }
      sent.push({ when, dayLabel, names: items.map((i) => i.exerciseName) });
      return true;
    },
  });
  vm.runInContext(production([
    "longDateLabel", "manilaHour", "sendDigestOnce",
    "REMINDER_TOMORROW_HOUR_MANILA", "REMINDER_TODAY_HOUR_MANILA", "sendExerciseReminderEmails",
  ]), context);
  return {
    check: async (manila: string) => {
      now = new Date(`${manila}:00+08:00`);
      await context.exports.sendExerciseReminderEmails();
    },
    due: (day: string, name: string) => dueRows.push({ day, name }),
    failNextSend: () => { failNext = true; },
    sent,
  };
}

async function run() {
  console.log("\nNotification emails: never waited on, nothing skipped\n");

  await test("ending a session for pain returns while the mail server is still silent", async () => {
    const { endSession, state } = endSessionHarness(() => new Promise<boolean>(() => {}));
    const result = await Promise.race([endSession(1, { completed: false, endReason: "pain" }), timeout(500)]);
    assert.equal(result, true, "endSession must not wait for the emails");
    assert.equal(state.committed, true);
    assert.deepEqual(
      state.notifications,
      ["Exercise paused because of pain", "Exercise paused because of pain"],
      "the therapist's and the patient's in-app alerts come first",
    );
    await settle();
    assert.deepEqual([...state.mails].sort(), ["patient", "therapist"], "both emails are still sent");
  });

  await test("a failing email lookup is logged, never thrown", async () => {
    const { endSession, state } = endSessionHarness(async () => true, true);
    assert.equal(await endSession(1, { completed: false, endReason: "pain" }), true);
    await settle();
    assert.deepEqual(state.mails, []);
    assert.deepEqual([...state.errors].sort(), [
      "Failed to email pain pause to patient:",
      "Failed to email pain pause to therapist:",
    ]);
    assert.deepEqual(unhandled, [], "no unhandled rejection");
  });

  await test("a completed session sends no pain email", async () => {
    const { endSession, state } = endSessionHarness(async () => true);
    assert.equal(await endSession(1, { completed: true }), true);
    await settle();
    assert.deepEqual(state.notifications, ["Exercise Completed", "Session Completed"]);
    assert.deepEqual(state.mails, []);
  });

  await test("a completion after an evening check is in the summary sent after midnight (Codex's case)", async () => {
    const digest = digestHarness();
    await digest.check("2026-10-15T20:10");
    digest.complete("2026-10-15T21:30");
    await digest.check("2026-10-15T23:10");
    assert.equal(digest.sent.length, 0, "the day is not summarised before it ends");
    await digest.check("2026-10-16T00:10");
    assert.equal(digest.sent.length, 1);
    assert.equal(digest.sent[0].kind, "completed");
    assert.equal(digest.sent[0].dayLabel, "October 15, 2026");
    assert.deepEqual(digest.sent[0].items.map((i) => i.exerciseName), ["Raise"]);
    await digest.check("2026-10-16T08:10");
    await digest.check("2026-10-16T20:10");
    assert.equal(digest.sent.length, 1, "each day's summary goes out once");
  });

  await test("the first check after midnight claims the day that just ended, for all three summaries", async () => {
    const digest = digestHarness();
    await digest.check("2026-10-15T23:50");
    assert(!digest.claims.has("t|completed|2026-10-15"), "the day is not claimed before it ends");
    await digest.check("2026-10-16T00:05");
    assert.deepEqual([...digest.claims].filter((c) => c.endsWith("2026-10-15")).sort(), [
      "t|completed|2026-10-15", "t|missed|2026-10-15", "t|partial|2026-10-15",
    ]);
  });

  await test("a patient who did only part of a day is emailed to the therapist, with where each exercise stopped", async () => {
    const digest = digestHarness();
    digest.due("2026-10-15", { exercise_name: "Raise", status: "completed" });
    digest.due("2026-10-15", { exercise_name: "Rotation", status: "pain_stopped", session_id: 9 });
    digest.due("2026-10-15", { exercise_name: "Shrug", status: "pending" });
    digest.due("2026-10-15", { patient_id: "q", patient_name: "Done patient", exercise_name: "Raise", status: "completed" });
    digest.due("2026-10-15", { patient_id: "r", patient_name: "Absent patient", exercise_name: "Raise", status: "pending" });
    await digest.check("2026-10-16T00:10");
    const partial = digest.sent.filter((s) => s.kind === "partial");
    assert.equal(partial.length, 1, "one email for all the therapist's patients");
    // Array.from: the lists are built inside the vm context, with its own Array.
    assert.deepEqual(Array.from(partial[0].items, (p: any) => p.patientName), ["Fixture patient"], "only patients who did part of the day");
    assert.deepEqual(Array.from(partial[0].items[0].items, (i: any) => `${i.exerciseName}: ${i.status} – ${i.detail}`), [
      "Raise: Completed – 3 sets × 10 reps",
      "Rotation: Paused because of pain – 1 of 3 sets completed, paused in set 2 of 3 after 4 of 10 reps (prescribed 3 sets × 10 reps)",
      "Shrug: Not started – Prescribed 3 sets × 10 reps",
    ]);
    await digest.check("2026-10-16T01:10");
    assert.equal(digest.sent.filter((s) => s.kind === "partial").length, 1, "and it goes out once");
  });

  await test("a failed send is retried at the next hourly check", async () => {
    const digest = digestHarness();
    digest.complete("2026-10-15T18:00");
    digest.failNextSend();
    await digest.check("2026-10-16T07:10");
    assert.equal(digest.sent.length, 0);
    assert(!digest.claims.has("t|completed|2026-10-15"), "a failed send releases its claim");
    await digest.check("2026-10-16T08:10");
    assert.equal(digest.sent.length, 1);
    await digest.check("2026-10-16T09:10");
    assert.equal(digest.sent.length, 1);
  });

  // Codex review 2026-10-19, finding 4.
  await test("a summary query that fails after the claim releases it; the next hourly check sends", async () => {
    const digest = digestHarness();
    digest.complete("2026-10-15T18:00");
    digest.failNextQuery();
    await digest.check("2026-10-16T07:10");
    assert.equal(digest.sent.length, 0);
    assert(!digest.claims.has("t|completed|2026-10-15"), "the claim is released, not left to block the retry");
    await digest.check("2026-10-16T08:10");
    assert.equal(digest.sent.length, 1, "the retry sends the summary");
    assert(digest.claims.has("t|completed|2026-10-15"), "a sent summary keeps its claim");
    await digest.check("2026-10-16T09:10");
    assert.equal(digest.sent.length, 1, "and it goes out once");
  });

  // Codex review 2026-10-19, finding 3: holds are named by their time, as the app shows them.
  await test("a summary line gives a hold's time and a repetition exercise's count", async () => {
    const digest = digestHarness();
    digest.complete("2026-10-15T09:00", { exercise_name: "Arm Abduction", exercise_id: "ex_006", sets: 2, reps: 10, hold_seconds: 30 });
    digest.complete("2026-10-15T10:00", { exercise_name: "Raise", exercise_id: "ex_001", sets: 2, reps: 10, hold_seconds: 30 });
    await digest.check("2026-10-16T07:10");
    assert.deepEqual(digest.sent[0].items.map((i) => `${i.sets} sets × ${i.target}`), ["2 sets × 30s hold", "2 sets × 10 reps"]);
  });

  await test("a hold stopped for pain is described by its sets held, not repetitions", async () => {
    const { endSession, state } = endSessionHarness(async () => true, false, true);
    assert.equal(await endSession(1, { completed: false, endReason: "pain" }), true);
    await settle();
    assert.equal(state.details.length, 2);
    const details = state.details[0];
    assert.equal(details.isHold, true);
    assert.equal(details.prescribedTarget, "30s hold");
    assert.equal(details.completedSets, 1, "sets that reached their time");
    assert.equal(describePausedProgress(details), "1 of 3 sets completed before the pause");
    assert.equal(
      describePausedProgress({ ...details, completedSets: 0 }),
      "before completing any set (prescribed 3 sets × 30s hold)",
    );
    const reps = endSessionHarness(async () => true);
    await reps.endSession(1, { completed: false, endReason: "pain" });
    await settle();
    assert.equal(reps.state.details[0].prescribedTarget, "10 reps");
    assert.equal(describePausedProgress(reps.state.details[0]), "1 of 3 sets completed, paused in set 2 of 3 after 4 of 10 reps");
  });

  await test("a patient's reminders: one email per day listing every exercise, the evening before and that morning", async () => {
    const reminders = reminderHarness();
    reminders.due("2026-10-16", "Raise");
    reminders.due("2026-10-16", "Rotation");
    await reminders.check("2026-10-15T17:10");
    assert.equal(reminders.sent.length, 0, "nothing for tomorrow before 18:00, nothing due today");
    await reminders.check("2026-10-15T18:10");
    assert.deepEqual(reminders.sent, [{ when: "tomorrow", dayLabel: "October 16, 2026", names: ["Raise", "Rotation"] }]);
    await reminders.check("2026-10-15T19:10");
    await reminders.check("2026-10-16T06:10");
    assert.equal(reminders.sent.length, 1, "once per day");
    await reminders.check("2026-10-16T07:10");
    assert.deepEqual(reminders.sent[1], { when: "today", dayLabel: "October 16, 2026", names: ["Raise", "Rotation"] });
    await reminders.check("2026-10-16T08:10");
    assert.equal(reminders.sent.length, 2);
  });

  await test("a failed reminder is retried at the next hourly check", async () => {
    const reminders = reminderHarness();
    reminders.due("2026-10-16", "Raise");
    reminders.failNextSend();
    await reminders.check("2026-10-16T07:10");
    assert.equal(reminders.sent.length, 0);
    await reminders.check("2026-10-16T08:10");
    assert.equal(reminders.sent.length, 1);
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exitCode = 1;
}

void run();
