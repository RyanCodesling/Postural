/**
 * Regression tests for completed schedule-occurrence session summaries. Run:
 *
 *   npx tsx src/lib/exercises/scheduleSessionSummary.test.ts
 */

import {
  groupSessionsByOccurrence,
  isOutcomeBearingSession,
  selectCompletedOccurrenceResult,
  type ScheduleSessionRecord,
} from "./scheduleSessionSummary";

let testsPassed = 0;
let testsFailed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    testsPassed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`      ${error instanceof Error ? error.message : String(error)}`);
    testsFailed += 1;
  }
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function session(
  patch: Partial<ScheduleSessionRecord> = {}
): ScheduleSessionRecord {
  return {
    id: 1,
    occurrenceId: 10,
    exerciseKind: "dynamic",
    startedAt: "2026-07-16T09:00:00.000Z",
    endedAt: "2026-07-16T09:05:00.000Z",
    endReason: "completed",
    durationMs: 300_000,
    setCount: 2,
    totalReps: 40,
    completeReps: 40,
    completeLeftReps: 20,
    completeRightReps: 20,
    totalPairedHoldMs: null,
    ...patch,
  };
}

console.log("\nscheduleSessionSummary - completed occurrence tests\n");

test("single completed session becomes the primary result", () => {
  const result = selectCompletedOccurrenceResult([session()]);
  assertEqual(result?.primary.id, 1, "primary session id");
  assertEqual(result?.attemptCount, 1, "attempt count");
});

test("ended-early attempt is counted but not merged into the completed result", () => {
  const early = session({
    id: 173,
    startedAt: "2026-07-16T08:00:00.000Z",
    endReason: "user",
    setCount: 1,
    totalReps: 12,
    completeReps: 12,
    completeLeftReps: 6,
    completeRightReps: 6,
  });
  const completed = session({ id: 174, startedAt: "2026-07-16T09:00:00.000Z" });
  const result = selectCompletedOccurrenceResult([early, completed]);

  assertEqual(result?.primary.id, 174, "primary session id");
  assertEqual(result?.primary.totalReps, 40, "primary-only repetition count");
  assertEqual(result?.attemptCount, 2, "attempt count");
});

test("zero-output abandoned starts do not inflate attempt count", () => {
  const abandoned = session({
    id: 2,
    startedAt: "2026-07-16T08:30:00.000Z",
    endedAt: null,
    endReason: null,
    durationMs: null,
    setCount: 0,
    totalReps: 0,
    completeReps: 0,
    completeLeftReps: 0,
    completeRightReps: 0,
  });
  const completed = session({ id: 3 });
  const result = selectCompletedOccurrenceResult([abandoned, completed]);

  assertEqual(isOutcomeBearingSession(abandoned), false, "abandoned outcome-bearing flag");
  assertEqual(result?.attemptCount, 1, "attempt count");
});

test("legacy null occurrence links are not guessed into a group", () => {
  const grouped = groupSessionsByOccurrence([
    session({ id: 4, occurrenceId: null }),
    session({ id: 5, occurrenceId: 11 }),
  ]);

  assertEqual(grouped.size, 1, "group count");
  assertEqual(grouped.get(11)?.[0].id, 5, "linked session id");
});

test("isometric hold output qualifies as an outcome-bearing attempt", () => {
  const hold = session({
    exerciseKind: "isometric",
    setCount: 0,
    totalReps: 0,
    completeReps: 0,
    completeLeftReps: 0,
    completeRightReps: 0,
    totalPairedHoldMs: 45_000,
  });

  assertEqual(isOutcomeBearingSession(hold), true, "isometric outcome-bearing flag");
  assertEqual(selectCompletedOccurrenceResult([hold])?.primary.id, 1, "primary session id");
});

console.log(`\n${testsPassed} passed, ${testsFailed} failed`);
if (testsFailed > 0) process.exitCode = 1;
