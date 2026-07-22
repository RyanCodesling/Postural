/**
 * Regression tests for schedule/assignment rollups. Run with:
 *
 *   npx tsx src/lib/exercises/occurrences.test.ts
 */

import {
  classifyScheduleOccurrence,
  deriveAssignmentStatus,
  isOccurrenceActionable,
  type OccurrenceLite,
} from "./occurrences";

let testsPassed = 0;
let testsFailed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    testsPassed += 1;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`      ${err instanceof Error ? err.message : String(err)}`);
    testsFailed += 1;
  }
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function occ(
  dueDate: string,
  makeupUntil: string,
  status: OccurrenceLite["status"]
): OccurrenceLite {
  return { dueDate, makeupUntil, status };
}

console.log("\noccurrences - assignment status rollup tests\n");

test("completed current occurrence ignores future pending dates", () => {
  const status = deriveAssignmentStatus(
    [
      occ("2026-06-12", "2026-06-12", "completed"),
      occ("2026-06-13", "2026-06-13", "pending"),
    ],
    "2026-06-12",
    "pending"
  );

  assertEqual(status, "completed", "assignment status");
});

test("in-progress current occurrence remains in progress", () => {
  const status = deriveAssignmentStatus(
    [
      occ("2026-06-11", "2026-06-11", "completed"),
      occ("2026-06-12", "2026-06-12", "in_progress"),
      occ("2026-06-13", "2026-06-13", "pending"),
    ],
    "2026-06-12",
    "pending"
  );

  assertEqual(status, "in_progress", "assignment status");
});

test("future-only assignment is still pending", () => {
  const status = deriveAssignmentStatus(
    [occ("2026-06-13", "2026-06-13", "pending")],
    "2026-06-12",
    "completed"
  );

  assertEqual(status, "pending", "assignment status");
});

test("completed due history ignores future pending dates", () => {
  const status = deriveAssignmentStatus(
    [
      occ("2026-06-10", "2026-06-10", "completed"),
      occ("2026-06-13", "2026-06-13", "pending"),
    ],
    "2026-06-12",
    "pending"
  );

  assertEqual(status, "completed", "assignment status");
});

test("mixed due history remains in progress", () => {
  const status = deriveAssignmentStatus(
    [
      occ("2026-06-10", "2026-06-10", "completed"),
      occ("2026-06-11", "2026-06-11", "pending"),
      occ("2026-06-13", "2026-06-13", "pending"),
    ],
    "2026-06-12",
    "pending"
  );

  assertEqual(status, "in_progress", "assignment status");
});

test("empty occurrence list falls back to stored assignment status", () => {
  const status = deriveAssignmentStatus([], "2026-06-12", "completed");

  assertEqual(status, "completed", "assignment status");
});

test("expired mixed history is not actionable today", () => {
  const occurrences = [
    occ("2026-06-12", "2026-06-12", "completed"),
    occ("2026-06-13", "2026-06-13", "pending"),
    occ("2026-06-14", "2026-06-14", "pending"),
    occ("2026-06-15", "2026-06-15", "pending"),
    occ("2026-06-16", "2026-06-16", "pending"),
    occ("2026-06-17", "2026-06-17", "pending"),
    occ("2026-06-18", "2026-06-18", "pending"),
    occ("2026-06-19", "2026-06-19", "pending"),
  ];

  const actionable = occurrences.filter((item) =>
    isOccurrenceActionable(item, "2026-07-16")
  );

  assertEqual(actionable.length, 0, "actionable occurrence count");
});

test("due and open make-up occurrences remain actionable", () => {
  assertEqual(
    isOccurrenceActionable(occ("2026-07-16", "2026-07-16", "pending"), "2026-07-16"),
    true,
    "due-today occurrence"
  );
  assertEqual(
    isOccurrenceActionable(occ("2026-07-14", "2026-07-17", "pending"), "2026-07-16"),
    true,
    "open make-up occurrence"
  );
  assertEqual(
    isOccurrenceActionable(occ("2026-07-16", "2026-07-16", "completed"), "2026-07-16"),
    false,
    "completed occurrence"
  );
});

test("schedule buckets keep only current work expanded", () => {
  assertEqual(
    classifyScheduleOccurrence(occ("2026-07-16", "2026-07-16", "completed"), "2026-07-16"),
    "current",
    "completed-today occurrence"
  );
  assertEqual(
    classifyScheduleOccurrence(occ("2026-07-14", "2026-07-17", "pending"), "2026-07-16"),
    "current",
    "open make-up occurrence"
  );
  assertEqual(
    classifyScheduleOccurrence(occ("2026-07-20", "2026-07-20", "pending"), "2026-07-16"),
    "upcoming",
    "future occurrence"
  );
  assertEqual(
    classifyScheduleOccurrence(occ("2026-07-10", "2026-07-12", "pending"), "2026-07-16"),
    "history",
    "expired occurrence"
  );
});

console.log(`\n${testsPassed} passed, ${testsFailed} failed`);
if (testsFailed > 0) {
  process.exitCode = 1;
}
