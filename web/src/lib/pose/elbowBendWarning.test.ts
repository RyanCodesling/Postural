/**
 * elbowBendWarning.test.ts
 *
 * Pins the display-only elbow check: each arm's elbow angle (180 = straight),
 * judged only while that arm is raised to `from`; on a repetition, flagged
 * after it stays below the line for `persistMs` and held until the arm is back
 * at rest; on a hold, passed through live; the more bent prescribed arm wins.
 *
 * USAGE
 *   npx tsx src/lib/pose/elbowBendWarning.test.ts
 */

import {
  newElbowBendState,
  updateElbowBend,
  type ElbowBendArm,
  type ElbowBendCheck,
  type ElbowBendState,
} from "./elbowBendWarning";

let testsPassed = 0;
let testsFailed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  PASS ${name}`);
    testsPassed += 1;
  } catch (err) {
    console.log(`  FAIL ${name}`);
    console.log(`      ${err instanceof Error ? err.message : String(err)}`);
    testsFailed += 1;
  }
}

function assertEq(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const REPETITION: ElbowBendCheck = { from: 75, persistMs: 100, hold: "repetition", restBelow: 20 };
const LIVE: ElbowBendCheck = { from: 80, persistMs: 0, hold: "live", restBelow: 0 };
const LINE = 130;
const BOTH = ["left", "right"] as const;

type Frame = { left: ElbowBendArm; right?: ElbowBendArm; sides?: readonly ("left" | "right")[] };

/** Feeds frames 50 ms apart; returns each frame's value and side, and the final state. */
function run(frames: Frame[], check = REPETITION, start: ElbowBendState = newElbowBendState()) {
  let state = start;
  const values: (number | null)[] = [];
  const sides: ("left" | "right" | null)[] = [];
  frames.forEach((frame, i) => {
    const step = updateElbowBend(state, {
      left: frame.left,
      right: frame.right ?? { primary: null, elbow: null },
      sides: frame.sides ?? BOTH,
      nowMs: i * 50,
    }, check, LINE);
    state = step.state;
    values.push(step.value);
    sides.push(step.side);
  });
  return { values, sides, state };
}

const arm = (primary: number | null, elbow: number | null): ElbowBendArm => ({ primary, elbow });
const left = (primary: number | null, elbow: number | null): Frame => ({ left: arm(primary, elbow) });

console.log("\nelbow check\n");

test("an arm below `from` is not judged", () => {
  const { values } = run([left(0, 100), left(40, 100), left(74.9, 100)]);
  assertEq(values.every((v) => v === null), true, "no value below 75");
});

test("a straight raised arm passes its live angle through and is never held", () => {
  const { values, state } = run([left(80, 170), left(90, 165), left(85, 172)]);
  assertEq(values.join(","), "170,165,172", "live angles");
  assertEq(state.left.heldValue, null, "nothing held");
});

test("a bend below the line for the persistence time is flagged and held until rest", () => {
  const { values } = run([
    left(60, 120),  //   0 ms: rising, not judged yet
    left(80, 125),  //  50 ms: judged, below the line: run starts
    left(88, 128),  // 100 ms
    left(90, 118),  // 150 ms: 100 ms below: flagged at 118
    left(90, 170),  // straightened at the top: still held
    left(50, 170),  // lowering, below `from`: still held
    left(19, 170),  // back below the repetition start: released
  ]);
  assertEq(values[0], null, "below `from`");
  assertEq(values[1], 125, "live before the flag");
  assertEq(values[3], 118, "flagged");
  assertEq(values[4], 118, "held while straight at the top");
  assertEq(values[5], 118, "held on the way down");
  assertEq(values[6], null, "released at rest");
});

test("the held value is the smallest flagged angle of the repetition", () => {
  const { values } = run([left(80, 120), left(85, 120), left(90, 125), left(90, 110), left(90, 128)]);
  assertEq(values.at(-1), 110, "smallest");
});

test("a dip shorter than the persistence time is not held", () => {
  const { values, state } = run([left(80, 120), left(85, 160), left(90, 165)]);
  assertEq(values[2], 165, "back to the live angle after a 50 ms dip");
  assertEq(state.left.heldValue, null, "nothing held");
});

test("a run broken by a frame that is not judged, or has no reading, is not flagged", () => {
  const belowFrom = run([left(80, 120), left(70, 120), left(80, 120), left(85, 160)]);
  assertEq(belowFrom.state.left.heldValue, null, "no flag across a frame below `from`");
  const missing = run([left(80, 120), left(80, null), left(80, 120), left(85, 160)]);
  assertEq(missing.state.left.heldValue, null, "no flag across a missing elbow reading");
  const unbroken = run([left(80, 120), left(80, 120), left(80, 120)]);
  assertEq(unbroken.state.left.heldValue, 120, "an unbroken 100 ms run flags");
});

test("a flagged repetition keeps its warning through a frame without a reading", () => {
  const { values } = run([left(80, 120), left(85, 120), left(90, 120), left(null, null), left(90, 170)]);
  assertEq(values[3], 120, "held through the missing frame");
  assertEq(values[4], 120, "still held");
});

test("the next repetition starts clean", () => {
  const { values } = run([left(80, 120), left(85, 120), left(90, 120), left(10, 170), left(80, 168)]);
  assertEq(values[3], null, "rest");
  assertEq(values[4], 168, "a new repetition passes its live angle");
});

test("with both arms judged the more bent arm and its side win", () => {
  const { values, sides } = run([
    { left: arm(90, 160), right: arm(90, 150) },
    { left: arm(90, 140), right: arm(90, 150) },
  ]);
  assertEq(values[0], 150, "right is more bent");
  assertEq(sides[0], "right", "right side");
  assertEq(values[1], 140, "now left");
  assertEq(sides[1], "left", "left side");
});

test("only the prescribed arm counts", () => {
  const { values, sides } = run([{ left: arm(90, 170), right: arm(90, 100), sides: ["left"] }]);
  assertEq(values[0], 170, "the bent right arm is not prescribed");
  assertEq(sides[0], "left", "left side");
  const none = run([{ left: arm(10, 170), right: arm(90, 100), sides: ["left"] }]);
  assertEq(none.values[0], null, "prescribed arm at rest");
  assertEq(none.sides[0], null, "no side");
});

test("hold mode passes the live angle while the arm is raised and never holds it", () => {
  const { values, state } = run([left(85, 120), left(90, 118), left(90, 165), left(70, 110), left(90, 125)], LIVE);
  assertEq(values.join(","), "120,118,165,,125", "live while judged, nothing below `from`");
  assertEq(state.left.heldValue, null, "never held");
});

test("the input state is not mutated", () => {
  const start = newElbowBendState();
  const frozen = JSON.stringify(start);
  updateElbowBend(start, { left: arm(90, 100), right: arm(90, 100), sides: BOTH, nowMs: 0 }, REPETITION, LINE);
  updateElbowBend(start, { left: arm(90, 100), right: arm(90, 100), sides: BOTH, nowMs: 500 }, REPETITION, LINE);
  assertEq(JSON.stringify(start), frozen, "unchanged");
});

console.log(`\n  ${testsPassed} passed, ${testsFailed} failed\n`);
process.exit(testsFailed === 0 ? 0 : 1);
