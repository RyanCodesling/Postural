/**
 * The patient's in-app notifications name every exercise in one message, and an
 * edit shows each changed field's old and new value.
 *
 *   npx tsx src/lib/notificationText.test.ts
 */
import assert from "node:assert/strict";
import type { PrescriptionDetail } from "./email";
import {
  assignedExercisesMessage,
  changedExercisesMessage,
  joinNames,
  removedExercisesMessage,
} from "./notificationText";

const detail = (overrides: Partial<PrescriptionDetail>): PrescriptionDetail => ({
  exerciseName: "Shoulder Raise", sets: 4, metricLabel: "Reps", metricValue: "12", restSeconds: 30,
  order: 1, side: "Both", resistance: "None", repeat: "Every day",
  startLabel: "Oct 20, 2026", endLabel: "Oct 30, 2026", ...overrides,
});

assert.equal(joinNames(["A"]), "A");
assert.equal(joinNames(["A", "B"]), "A and B");
assert.equal(joinNames(["A", "B", "C"]), "A, B, and C");

assert.equal(
  assignedExercisesMessage("Dr. Cruz", ["Shoulder Raise", "Neck Tilt"]),
  "Dr. Cruz assigned you 2 exercises: Shoulder Raise and Neck Tilt.",
);
assert.equal(
  removedExercisesMessage("Dr. Cruz", ["Neck Tilt"]),
  "Dr. Cruz removed 1 exercise from your program: Neck Tilt.",
);
assert.equal(
  changedExercisesMessage("Dr. Cruz", [
    detail({ changed: { Sets: "3", Reps: "10", Schedule: "Oct 19, 2026 to Oct 29, 2026" } }),
    detail({ exerciseName: "Plank", metricLabel: "Hold", metricValue: "45s", changed: { Hold: "30s" } }),
  ]),
  "Dr. Cruz edited 2 exercises:\n" +
    "• Shoulder Raise: Sets 3 → 4, Reps 10 → 12, Schedule Oct 19, 2026 to Oct 29, 2026 → Oct 20, 2026 to Oct 30, 2026\n" +
    "• Plank: Hold 30s → 45s",
);

console.log("Notification text passed: names joined, one message per request, edits show old → new.");
