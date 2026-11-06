/**
 * Tests for the arm hold's raise-or-lower hint (holdHint.ts) and its place in the hold display.
 * Run with: npx tsx src/lib/pose/holdHint.test.ts
 */

import { perArmHoldDisplay } from "../holdDisplay";
import { HOLD_HINT_WAIT_MS, holdHintDirection, newHoldHintState, updateHoldHint, type HoldHintState } from "./holdHint";

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

function assertEq(actual: unknown, expected: unknown, label: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const BAND = { lo: 84.3, hi: 95.7 };

/** Feeds the left arm's readings (one every 100 ms, the right arm in band) and returns the left hint shown. */
function leftHints(readings: (number | null)[], unsteadyAt: number[] = []) {
  let state: HoldHintState = newHoldHintState();
  return readings.map((value, i) => {
    state = updateHoldHint(state, {
      left: { value, unsteady: unsteadyAt.includes(i) },
      right: { value: 90, unsteady: false },
      nowMs: i * 100,
    }, BAND);
    return state.left.shown;
  });
}

console.log("\nholdHint - which way an arm moves back into the hold's band\n");

test("below the band is raise, above it lower, inside it and without a reading nothing", () => {
  assertEq([holdHintDirection(80, BAND), holdHintDirection(100, BAND), holdHintDirection(90, BAND), holdHintDirection(null, BAND)],
    ["raise", "lower", null, null], "directions");
  assertEq([holdHintDirection(84.3, BAND), holdHintDirection(95.7, BAND)], [null, null], "the band's edges are in it");
});

test(`the hint shows after ${HOLD_HINT_WAIT_MS} ms out on one side and goes as soon as the arm is back`, () => {
  assertEq(leftHints([100, 100, 100, 100, 100, 100, 100, 90, 100]),
    [null, null, null, null, null, "lower", "lower", null, null], "lower after 500 ms, gone in the band");
});

test("crossing from one side to the other starts the wait again", () => {
  assertEq(leftHints([80, 80, 80, 80, 80, 80, 100, 100, 100, 100, 100, 100]),
    [null, null, null, null, null, "raise", null, null, null, null, null, "lower"], "the new side waits its own 500 ms");
});

test("an unsteady arm gets no hint, and the wait starts again once it is steady", () => {
  assertEq(leftHints([100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100], [5, 6]),
    [null, null, null, null, null, null, null, null, null, null, null, null], "held back, then a fresh 500 ms");
  assertEq(leftHints([100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100], [5, 6]).at(-1), "lower", "shown after it");
});

test("the hold display shows a hint only on a paused arm that counts toward the set", () => {
  const both = { holdSeconds: 30, prescribedSide: "both" as const };
  const paused = perArmHoldDisplay({ leftSec: 5, rightSec: 6, leftInBand: false, rightInBand: true, leftHint: "lower", rightHint: "raise" }, both);
  assertEq(paused.arms.map((a) => a.hint), ["lower", null], "the counting arm shows none");
  const done = perArmHoldDisplay({ leftSec: 30, rightSec: 6, leftInBand: false, rightInBand: true, leftHint: "lower" }, both);
  assertEq(done.arms[0].hint, null, "an arm that reached the hold shows none");
  const observed = perArmHoldDisplay({ leftSec: 5, rightSec: 6, leftInBand: false, rightInBand: true, leftHint: "raise" },
    { holdSeconds: 30, prescribedSide: "right" });
  assertEq(observed.arms[0].hint, null, "an observation-only arm shows none");
  const legacy = perArmHoldDisplay({ leftSec: 5, rightSec: 6, leftInBand: false, rightInBand: true }, both);
  assertEq(legacy.arms.map((a) => a.hint), [null, null], "a hold state without hints shows none");
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
