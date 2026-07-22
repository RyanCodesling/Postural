/**
 * Regression tests for therapist prescription lifecycle/adherence summaries.
 * Run with: npx tsx src/lib/exercises/prescriptionStatus.test.ts
 */

import {
  summarizePrescription,
  type PrescriptionOccurrenceLite,
} from "./prescriptionStatus";

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

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function occ(
  dueDate: string,
  status: PrescriptionOccurrenceLite["status"],
  cancelledAt: string | null = null,
): PrescriptionOccurrenceLite {
  return { dueDate, makeupUntil: dueDate, status, cancelledAt };
}

console.log("\nprescriptionStatus - lifecycle/adherence tests\n");

test("expired mixed history is ended and partially completed", () => {
  const summary = summarizePrescription({
    occurrences: [
      occ("2026-06-12", "completed"),
      occ("2026-06-13", "pending"),
      occ("2026-06-14", "pending"),
    ],
    startDate: "2026-06-12",
    endDate: "2026-06-14",
    todayKey: "2026-07-18",
  });

  assertEqual(summary.prescriptionState, "ended", "prescription state");
  assertEqual(summary.adherenceState, "partially_completed", "adherence state");
  assertEqual(summary.completedCount, 1, "completed count");
  assertEqual(summary.missedCount, 2, "missed count");
});

test("all completed occurrences produce a completed adherence outcome", () => {
  const summary = summarizePrescription({
    occurrences: [occ("2026-06-12", "completed"), occ("2026-06-13", "completed")],
    endDate: "2026-06-13",
    todayKey: "2026-07-18",
  });

  assertEqual(summary.prescriptionState, "ended", "prescription state");
  assertEqual(summary.adherenceState, "completed", "adherence state");
});

test("archived prescription retains outcomes but excludes cancelled future work", () => {
  const summary = summarizePrescription({
    occurrences: [
      occ("2026-07-17", "completed"),
      occ("2026-07-19", "pending", "2026-07-18T10:00:00Z"),
    ],
    archivedAt: "2026-07-18T10:00:00Z",
    todayKey: "2026-07-18",
  });

  assertEqual(summary.prescriptionState, "archived", "prescription state");
  assertEqual(summary.adherenceState, "completed", "adherence state");
  assertEqual(summary.scheduledCount, 1, "scheduled count");
  assertEqual(summary.cancelledCount, 1, "cancelled count");
});

test("future prescription is upcoming and not started", () => {
  const summary = summarizePrescription({
    occurrences: [occ("2026-07-20", "pending")],
    startDate: "2026-07-20",
    endDate: "2026-07-20",
    todayKey: "2026-07-18",
  });

  assertEqual(summary.prescriptionState, "upcoming", "prescription state");
  assertEqual(summary.adherenceState, "not_started", "adherence state");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exitCode = 1;
