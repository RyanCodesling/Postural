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

test("template doses accept the supported bounds and remain optional", () => {
  for (const [sets, reps] of [[1, 1], [4, 20]]) {
    const [parsed] = parseProgramExerciseInputs([{ ...input(), sets, reps }]);
    assert(parsed.sets === sets && parsed.reps === reps, "supported dose must survive unchanged");
  }
  const [blank] = parseProgramExerciseInputs([input()]);
  assert(blank.sets === undefined && blank.reps === undefined, "templates may leave the dose for assignment");
});

test("template doses reject out-of-range, fractional and non-numeric values", () => {
  for (const sets of [0, -1, 5, 1.5, Infinity, NaN, "3"]) {
    assertThrows(() => parseProgramExerciseInputs([{ ...input(), sets, reps: 10 }]), `invalid sets ${sets} must fail`);
  }
  for (const reps of [0, -1, 21, 1.5, Infinity, NaN, "10"]) {
    assertThrows(() => parseProgramExerciseInputs([{ ...input(), sets: 3, reps }]), `invalid reps ${reps} must fail`);
  }
});

test("hold templates take up to 10 sets; repetition exercises and custom tasks stay at 4", () => {
  const [hold] = parseProgramExerciseInputs([{ ...input(), exerciseId: "ex_006", sets: 10 }]);
  assert(hold.sets === 10, "a hold template must keep 10 sets");
  assertThrows(
    () => parseProgramExerciseInputs([{ ...input(), exerciseId: "ex_006", sets: 11 }]),
    "a hold template must refuse 11 sets",
  );
  assertThrows(
    () => parseProgramExerciseInputs([{ ...input(), exerciseId: "ex_001", sets: 5 }]),
    "a repetition template must still refuse 5 sets",
  );
  assertThrows(
    () => parseProgramExerciseInputs([{ ...input(), exerciseId: undefined, isCustom: true, sets: 5 }]),
    "a custom task must still refuse 5 sets",
  );
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exitCode = 1;
