/**
 * Regression tests for context-safe trend grouping.
 * Run with: npx tsx src/app/(app)/dashboard/_components/ExerciseTrends.test.ts
 */

import type { TrendSession } from "./ExerciseTrends";
import { ExerciseTrendCard, groupSessionsByExercise, repPointDetail } from "./ExerciseTrends";
import { strict as assert } from "node:assert";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

function session(
  id: number,
  side: "both" | "left" | "right",
  config: string,
): TrendSession {
  return {
    exerciseId: "ex_001",
    exerciseName: "Lateral Arm Raises",
    exerciseKind: "dynamic",
    endReason: "completed",
    startedAt: `2026-07-${String(20 + id).padStart(2, "0")}T08:00:00.000Z`,
    avgPeakValue: 80 + id,
    completeLeftReps: 10,
    completeRightReps: 10,
    totalPairedHoldMs: null,
    setCount: 1,
    totalReps: 20,
    prescribedSide: side,
    resistance: { type: "none", value: null, unit: null, label: null },
    exerciseConfigVersion: config,
  };
}

const groups = groupSessionsByExercise([
  session(3, "left", "sha256:a"),
  session(2, "both", "sha256:b"),
  session(1, "both", "sha256:a"),
]);

if (groups.length !== 3) {
  throw new Error(
    `expected side/config changes to form 3 trend groups, got ${groups.length}`,
  );
}

// Ending before any rep is recorded must not create a zero on the progress
// chart. Recorded partial reps with zero target-reaching reps remain outcomes.
const empty: TrendSession = {
  ...session(4, "both", "sha256:c"), id: 4, setCount: 0, totalReps: 0,
  leftReps: 0, rightReps: 0, completeLeftReps: 0, completeRightReps: 0,
  avgPeakValue: null,
};
const partial: TrendSession = {
  ...session(5, "both", "sha256:c"), id: 5, totalReps: 6,
  leftReps: 3, rightReps: 3, completeLeftReps: 0, completeRightReps: 0,
  avgPeakValue: 75, avgLeftPeakValue: 75, avgRightPeakValue: 75,
};
const later: TrendSession = { ...session(6, "both", "sha256:c"), id: 6 };
const outcomes = groupSessionsByExercise([later, partial, empty]);
assert.deepEqual(groupSessionsByExercise([empty]), [], "an empty attempt is excluded");
assert.deepEqual(outcomes[0].sessions.map((s) => s.id), [5, 6],
  "zero target-reaching reps remain when partial reps were recorded");
assert.equal(repPointDetail(partial, "left"), "Left: 0/3 met full-ROM target");
const html = renderToStaticMarkup(createElement(ExerciseTrendCard, { group: outcomes[0] }));
assert.ok(html.includes("Reps reaching the target — left vs right"));
assert.ok(html.includes("Zero here means no reps reached the target."));
assert.ok(html.includes("Left: 0/3 met full-ROM target"), "the zero retains its recorded-rep denominator");

// Eligibility is based on the replaced lifecycle state, never on a low count.
const replacedPartial = { ...partial, endReason: "superseded" };
const replacedFull = { ...later, endReason: "superseded" };
assert.deepEqual(groupSessionsByExercise([replacedFull, replacedPartial]), [],
  "all replaced attempts are omitted, even when they contain full-target reps");
assert.deepEqual(groupSessionsByExercise([replacedFull, later, replacedPartial, partial])[0].sessions.map((s) => s.id), [5, 6]);
for (const endReason of ["user", "pain", null, undefined]) {
  assert.equal(groupSessionsByExercise([{ ...partial, endReason }])[0].sessions.length, 1,
    `recorded outcomes remain for ${endReason ?? "legacy/unknown"} status`);
}
const hold = { ...later, exerciseId: "ex_006", exerciseKind: "isometric" as const,
  totalReps: 0, totalPairedHoldMs: 1000 };
assert.deepEqual(groupSessionsByExercise([{ ...hold, endReason: "superseded" }]), [],
  "the replaced-attempt rule also covers hold exercises");
assert.equal(groupSessionsByExercise([hold])[0].sessions.length, 1);
assert.ok(html.includes("Replaced attempts stay in session history"));

console.log("\nExerciseTrends: context grouping, lifecycle exclusions and partial-rep presentation passed.\n");
