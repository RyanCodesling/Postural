/**
 * Regression tests for the assigned-exercise email details. Run with:
 *
 *   npx tsx src/lib/exercises/prescriptionEmail.test.ts
 */

import assert from "node:assert/strict";
import { diffAssignedExercises, toPrescriptionDetail, type PrescriptionRow } from "./prescriptionEmail";

const row = (overrides: Partial<PrescriptionRow> = {}): PrescriptionRow => ({
  exercise_id: "ex_001",
  name: "Standing Side Bends",
  sets: 2,
  reps: 2,
  rest_seconds: 60,
  sequence_index: 3,
  prescribed_side: "both",
  resistance_type: "none",
  recurrence: "interval",
  interval_days: 1,
  weekdays: [],
  start_date: "2026-10-14",
  end_date: "2026-10-16",
  ...overrides,
});

assert.deepEqual(toPrescriptionDetail(row()), {
  exerciseName: "Standing Side Bends",
  sets: 2,
  reps: 2,
  restSeconds: 60,
  order: 3,
  side: "both",
  resistance: "No resistance",
  repeat: "Every day",
  startLabel: "Oct 14, 2026",
  endLabel: "Oct 16, 2026",
});

// A new exercise is "assigned"; an unchanged one is in neither list.
let result = diffAssignedExercises([], [row()], ["ex_001"]);
assert.equal(result.assigned.length, 1);
assert.equal(result.changed.length, 0);
result = diffAssignedExercises([row()], [row()], ["ex_001"]);
assert.equal(result.assigned.length + result.changed.length, 0);

// Changed sets, reps and schedule are reported with their previous values.
result = diffAssignedExercises(
  [row()],
  [row({ sets: 3, reps: 10, end_date: "2026-10-20" })],
  ["ex_001"],
);
assert.equal(result.assigned.length, 0);
assert.deepEqual(result.changed[0].changed, {
  Sets: "2",
  Reps: "2",
  Schedule: "Oct 14, 2026 to Oct 16, 2026",
});

// Exercises outside the request are ignored.
result = diffAssignedExercises([row()], [row({ sets: 9 })], ["ex_999"]);
assert.equal(result.assigned.length + result.changed.length, 0);

console.log("prescriptionEmail tests passed");
