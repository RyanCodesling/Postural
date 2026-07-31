/**
 * Regression tests for context-safe trend grouping.
 * Run with: npx tsx src/app/(app)/dashboard/_components/ExerciseTrends.test.ts
 */

import type { TrendSession } from "./ExerciseTrends";
import { groupSessionsByExercise } from "./ExerciseTrends";

function session(
  id: number,
  side: "both" | "left" | "right",
  config: string,
): TrendSession {
  return {
    exerciseId: "ex_001",
    exerciseName: "Lateral Arm Raises",
    exerciseKind: "dynamic",
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

console.log("\nExerciseTrends - context grouping\n");
console.log("  ✓ side and scoring configuration changes split trend series");
console.log("\n1 passed, 0 failed\n");
