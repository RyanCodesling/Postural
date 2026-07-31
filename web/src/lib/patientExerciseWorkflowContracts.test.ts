/**
 * Source-contract regressions for the occurrence-driven patient camera queue.
 * Run with: npx tsx src/lib/patientExerciseWorkflowContracts.test.ts
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

console.log("\npatientExerciseWorkflowContracts - queue and sequence contracts\n");

test("programs and prescriptions persist validated workflow order", () => {
  const programsSql = source("../../../scripts/exercise_programs_pg.sql");
  const prescriptionsSql = source("../../../scripts/patient_exercises_pg.sql");
  for (const sql of [programsSql, prescriptionsSql]) {
    assert(sql.includes("sequence_index"), "sequence_index column is required");
    assert(sql.includes("sequence_index_check"), "positive sequence constraint is required");
  }
});

test("new occurrence snapshots carry versioned sequence context", () => {
  const occurrencesSql = source("../../../scripts/exercise_occurrences_pg.sql");
  const context = source("./prescriptionContext.ts");
  assert(occurrencesSql.includes("'sequenceIndex', pe.sequence_index"), "snapshot must carry order");
  assert(occurrencesSql.includes("prescription_snapshot_version = 2"), "snapshot V2 migration is required");
  assert(context.includes("export const PRESCRIPTION_SNAPSHOT_VERSION = 2"), "new writes must use V2");
  assert(context.includes("sequenceIndex: number"), "typed snapshot order is required");
});

test("dashboard and session creation pass one exact occurrence id", () => {
  const dashboard = source("../app/(app)/dashboard/patient/page.tsx");
  const camera = source("../app/(app)/camera/CameraClient.tsx");
  const route = source("../app/api/sessions/route.ts");
  const db = source("./db.ts");
  assert(dashboard.includes("/camera?occurrenceId="), "dashboard link must identify the occurrence");
  assert(
    dashboard.includes("const actionableCameraOccurrences =") &&
      dashboard.includes('occurrence.monitoring_mode === "camera"'),
    "dashboard camera shortcut must exclude manual tasks",
  );
  assert(route.includes("const occurrenceId = Number(body?.occurrenceId)"), "session API must require occurrence id");
  assert(
    route.includes("patientExerciseId < 1") && route.includes("occurrenceId < 1"),
    "session API must reject missing/null serial identifiers before database lookup",
  );
  assert(db.includes("WHERE eo.id = $1"), "session lock must target the requested occurrence");
  assert(
    camera.includes("exactOccurrenceWasRequested && !exactOccurrence") &&
      camera.includes('router.replace("/dashboard/patient?tab=session")'),
    "a stale explicit occurrence must fail closed to the schedule",
  );
  assert(
    db.includes('occurrence.status === "pending"') &&
      db.includes("shouldPersistPrescriptionSnapshot"),
    "session start must not rewrite a snapshot after the occurrence has started",
  );
});

test("camera queue uses only actionable occurrences and clears old telemetry", () => {
  const camera = source("../app/(app)/camera/CameraClient.tsx");
  assert(
    camera.includes('recordsField(data, "occurrences")') &&
      camera.includes("isOccurrenceActionable("),
    "camera must build its queue from actionable occurrences",
  );
  assert(camera.includes("Exercise ${selectedExerciseIndex + 1} of ${assignedExercises.length} today"), "today queue label is required");
  assert(camera.includes('router.push("/dashboard/patient?tab=session")'), "finished queue must return to schedule");
  assert(
    camera.includes("removeActionableOccurrence(") &&
      camera.includes('terminalOutcome === "completed" && shouldShowCompletionRecap') &&
      camera.includes("setPendingCompletionNavigation({ remaining, next })") &&
      camera.includes('setSessionState("ended")'),
    "completed work must hold its recap before leaving the current occurrence",
  );
  assert(
    camera.includes('const continueFromCompletionRecap = (destination: "next" | "schedule")') &&
      camera.includes('continueFromCompletionRecap("next")') &&
      camera.includes('continueFromCompletionRecap("schedule")'),
    "the patient must explicitly choose the next exercise or schedule after the recap",
  );
  assert(
    camera.includes("!pendingCompletionNavigation") &&
      camera.includes(">Redo</button>"),
    "a terminal patient recap must not offer Redo for the completed occurrence",
  );
  assert(
    camera.includes("useLayoutEffect(() => {") &&
      camera.includes("Clear every displayed value synchronously with the selected exercise"),
    "exercise telemetry must clear before the browser paints the new selection",
  );
  for (const reset of [
    "lastMetricsUpdateRef.current = 0",
    "setDisplayPerSidePrimary(null)",
    "setFrameMetrics(emptyFrameMetrics())",
    "setNearPeak(false)",
  ]) {
    assert(camera.includes(reset), `exercise change must run ${reset}`);
  }
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exitCode = 1;
