/**
 * Source-contract regressions for archive/end semantics.
 * Run with: npx tsx src/lib/dataPreservation.test.ts
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

console.log("\ndataPreservation - archive and ownership contracts\n");

test("application code contains no hard delete for prescriptions or exercises", () => {
  const db = source("./db.ts");
  assert(!/DELETE\s+FROM\s+patient_exercises/i.test(db), "patient exercises must archive, not delete");
  // The one exercise delete is deleteArchivedExercise: an archived custom
  // exercise that was never prescribed and has no sessions.
  const exerciseDeletes = db.match(/DELETE\s+FROM\s+exercises\b/gi) ?? [];
  assert(exerciseDeletes.length <= 1, "exercises must archive, not delete");
  if (exerciseDeletes.length === 1) {
    const start = db.indexOf("export async function deleteArchivedExercise");
    const end = db.indexOf("\nexport ", start + 1);
    const body = start >= 0 ? db.slice(start, end) : "";
    assert(/DELETE\s+FROM\s+exercises\b/i.test(body), "only deleteArchivedExercise may delete an exercise");
    assert(body.includes("is_custom = TRUE AND archived_at IS NOT NULL"), "only archived custom exercises may be deleted");
    assert(/FROM patient_exercises WHERE exercise_id/.test(body), "a prescribed exercise must not be deleted");
    assert(/FROM sessions WHERE exercise_id/.test(body), "an exercise with sessions must not be deleted");
  }
  assert(db.includes("export async function archivePatientExercises"), "archivePatientExercises is required");
  assert(db.includes("export async function archiveExercise"), "archiveExercise is required");
});

test("session evidence foreign keys restrict prescription/catalog deletion", () => {
  const sessionsSql = source("../../../scripts/sessions_pg.sql");
  assert(
    /patient_exercise_id[\s\S]*REFERENCES patient_exercises\(id\)[\s\S]*ON DELETE RESTRICT/i.test(sessionsSql),
    "sessions.patient_exercise_id must use ON DELETE RESTRICT",
  );
  assert(
    /exercise_id[\s\S]*REFERENCES exercises\(id\)[\s\S]*ON DELETE RESTRICT/i.test(sessionsSql),
    "sessions.exercise_id must use ON DELETE RESTRICT",
  );
});

test("custom exercises have owner, manual mode, and archive columns", () => {
  const exercisesSql = source("../../../scripts/exercises_pg.sql");
  for (const column of ["owner_therapist_id", "monitoring_mode", "archived_at"]) {
    assert(exercisesSql.includes(column), `missing ${column} schema contract`);
  }
  assert(
    exercisesSql.includes("WHERE is_custom = TRUE AND monitoring_mode <> 'manual'"),
    "custom exercises must migrate to manual-only mode",
  );
});

test("archived prescriptions can be reassigned as a new snapshot", () => {
  const prescriptionSql = source("../../../scripts/patient_exercises_pg.sql");
  assert(
    /UNIQUE INDEX[\s\S]*\(exercise_id, patient_id\)[\s\S]*WHERE archived_at IS NULL/i.test(prescriptionSql),
    "active-only unique index is required",
  );
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exitCode = 1;
