/**
 * Regression tests for therapist-controlled program sequencing.
 * Run with: npx tsx src/lib/programExerciseInput.test.ts
 */

import {
  nextExerciseSequenceIndex,
  parseProgramExerciseInputs,
} from "./programExerciseInput";

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

function assertThrows(fn: () => void, message: string): void {
  try {
    fn();
  } catch {
    return;
  }
  throw new Error(message);
}

function input(sequenceIndex?: number) {
  return {
    exerciseId: `ex_00${sequenceIndex ?? 1}`,
    name: "Exercise",
    isCustom: false,
    sequenceIndex,
    prescribedSide: "both",
    resistanceType: "none",
  };
}

console.log("\nprogramExerciseInput - sequence validation\n");

test("missing order follows the therapist's submitted list", () => {
  const parsed = parseProgramExerciseInputs([input(), input()]);
  assert(parsed[0].sequenceIndex === 1, "first item should default to order 1");
  assert(parsed[1].sequenceIndex === 2, "second item should default to order 2");
});

test("explicit unique order is preserved", () => {
  const parsed = parseProgramExerciseInputs([input(2), input(1)]);
  assert(parsed[0].sequenceIndex === 2, "first explicit order should survive");
  assert(parsed[1].sequenceIndex === 1, "second explicit order should survive");
});

test("duplicate or non-positive order is rejected", () => {
  assertThrows(
    () => parseProgramExerciseInputs([input(1), input(1)]),
    "duplicate sequence should fail",
  );
  assertThrows(
    () => parseProgramExerciseInputs([input(0)]),
    "zero sequence should fail",
  );
});

test("new exercise order follows the highest retained order instead of set size", () => {
  assert(
    nextExerciseSequenceIndex([1, 3]) === 4,
    "a gap must not cause a duplicate order 3",
  );
  assert(
    nextExerciseSequenceIndex([undefined, null, 2]) === 3,
    "missing values should be ignored",
  );
  assert(nextExerciseSequenceIndex([]) === 1, "an empty program should start at 1");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exitCode = 1;
