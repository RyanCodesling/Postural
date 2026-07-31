/**
 * Source/schema regressions for immutable clinical context and audit actions.
 * Run with: npx tsx src/lib/clinicalContextContracts.test.ts
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`      ${error instanceof Error ? error.message : String(error)}`);
    failed += 1;
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function source(relativeUrl: string): string {
  return readFileSync(fileURLToPath(new URL(relativeUrl, import.meta.url)), "utf8");
}

console.log("\nclinicalContextContracts - schema and lifecycle contracts\n");

test("prescriptions use typed side and resistance columns", () => {
  const sql = source("../../../scripts/patient_exercises_pg.sql");
  for (const column of [
    "prescribed_side",
    "resistance_type",
    "resistance_value",
    "resistance_unit",
    "resistance_label",
  ]) {
    assert(sql.includes(column), `missing ${column}`);
  }
  assert(
    /prescribed_side\s+IN\s+\('both',\s*'left',\s*'right'\)/i.test(sql),
    "prescribed side check constraint is required",
  );
});

test("session schema records immutable context, pain, versions, and reviews", () => {
  const sql = source("../../../scripts/sessions_pg.sql");
  for (const column of [
    "context_snapshot",
    "context_snapshot_version",
    "registry_version",
    "exercise_config_version",
    "app_revision",
    "pain_report_status",
    "pain_score",
    "pain_timing",
    "end_reason",
  ]) {
    assert(sql.includes(column), `missing ${column}`);
  }
  assert(sql.includes("CREATE TABLE IF NOT EXISTS session_reviews"), "review table required");
  assert(
    !/UPDATE\s+session_reviews/i.test(sql),
    "review migration must not rewrite audit rows",
  );
});

test("prescription edits cannot rewrite started or terminal occurrence context", () => {
  const db = source("./db.ts");
  const assignmentStart = db.indexOf(
    "export async function assignExercisesToPatient",
  );
  const assignmentEnd = db.indexOf(
    "export async function archivePatientExercises",
    assignmentStart,
  );
  const section = db.slice(assignmentStart, assignmentEnd);
  assert(
    section.includes("WHERE exercise_occurrences.status = 'pending'"),
    "occurrence snapshot upsert must be restricted to unstarted rows",
  );
});

test("pain stop is terminal and excluded from missed reminder candidates", () => {
  const db = source("./db.ts");
  const setEventsRoute = source(
    "../app/api/sessions/[id]/set-events/route.ts",
  );
  assert(
    db.includes("status = 'pain_stopped', pain_stopped_at = NOW()"),
    "pain stop must mark its occurrence",
  );
  assert(
    db.includes("eo.status NOT IN ('completed', 'pain_stopped')"),
    "pain-stopped occurrences must be excluded from missed reminders",
  );
  assert(
    db.includes(
      "SELECT occurrence_id, ended_at FROM sessions WHERE id = $1 FOR UPDATE",
    ) && db.includes("if (session.rows[0].ended_at)"),
    "session terminal transition must lock and reject an existing terminal state",
  );
  assert(
    setEventsRoute.includes('"pain"'),
    "pain-terminated partial sets must pass API validation",
  );
});

test("clinician reviews append instead of updating prior decisions", () => {
  const db = source("./db.ts");
  const start = db.indexOf("export async function appendSessionReview");
  const end = db.indexOf("export async function insertRepEvents", start);
  const section = db.slice(start, end);
  assert(section.includes("INSERT INTO session_reviews"), "review insert is required");
  assert(!/UPDATE\s+session_reviews/i.test(section), "review history must be append-only");
  assert(
    section.includes("coveragePct')::numeric >= 80"),
    "dynamic clinician review must enforce raw-rule coverage",
  );
  assert(
    section.includes("AND s.ended_at IS NOT NULL"),
    "clinician review must wait for a terminal session score",
  );
});

test("permanent account deletion is archived-only and blocks durable history", () => {
  const db = source("./db.ts");
  const route = source("../app/api/users/[id]/route.ts");
  const deletionStart = db.indexOf("export async function deleteUser");
  const deletionEnd = db.indexOf("export async function archiveUser", deletionStart);
  const deletion = db.slice(deletionStart, deletionEnd);

  assert(deletion.includes("FOR UPDATE"), "deletion eligibility must lock the target row");
  assert(deletion.includes("id === actorId"), "self-deletion must be rejected");
  assert(
    deletion.includes("target.rows[0].is_archived !== true"),
    "active accounts must not be permanently deleted",
  );
  for (const relationship of [
    "patient_exercises WHERE patient_id",
    "sessions WHERE patient_id",
    "users WHERE therapist_id",
    "exercise_programs WHERE therapist_id",
    "exercises WHERE owner_therapist_id",
    "session_reviews WHERE therapist_id",
  ]) {
    assert(
      deletion.includes(relationship),
      `missing durable relationship guard: ${relationship}`,
    );
  }
  const permanentBranch = route.indexOf("if (isPermanent)");
  assert(
    route.indexOf("await deleteUser", permanentBranch) <
      route.indexOf("sendAccountDeletedUserEmail", permanentBranch),
    "deletion email must be scheduled only after a successful guarded delete",
  );
});

test("durable user history uses RESTRICT while audit actors remain nullable", () => {
  const durableFiles = [
    "../../../scripts/exercises_pg.sql",
    "../../../scripts/patient_exercises_pg.sql",
    "../../../scripts/exercise_programs_pg.sql",
    "../../../scripts/sessions_pg.sql",
    "../../../scripts/patient_therapist_pg.sql",
  ].map(source);
  const combined = durableFiles.join("\n");

  for (const constraint of [
    "exercises_owner_therapist_id_fkey",
    "patient_exercises_patient_id_fkey",
    "exercise_programs_therapist_id_fkey",
    "sessions_patient_id_fkey",
    "session_reviews_therapist_id_fkey",
    "fk_therapist_id",
  ]) {
    const start = combined.indexOf(`ADD CONSTRAINT ${constraint}`);
    assert(start >= 0, `missing durable foreign key ${constraint}`);
    assert(
      combined.slice(start, start + 220).includes("ON DELETE RESTRICT"),
      `${constraint} must use ON DELETE RESTRICT`,
    );
  }
  assert(
    combined.includes("archived_by") && combined.includes("ON DELETE SET NULL"),
    "audit actor references should remain nullable",
  );
});

test("set and rep retries are protected by unique indexes and ON CONFLICT", () => {
  const sql = source("../../../scripts/sessions_pg.sql");
  const db = source("./db.ts");

  for (const index of [
    "uq_set_events_session_set_index",
    "uq_rep_events_session_rep_index",
  ]) {
    assert(sql.includes(index), `missing unique event index ${index}`);
  }
  assert(
    sql.includes("HAVING COUNT(*) > 1"),
    "migration must detect duplicates before adding unique indexes",
  );
  assert(
    db.includes("ON CONFLICT (session_id, set_index) DO NOTHING") &&
      db.includes("ON CONFLICT (session_id, rep_index) DO NOTHING"),
    "event inserts must use concurrency-safe ON CONFLICT handling",
  );
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exitCode = 1;
