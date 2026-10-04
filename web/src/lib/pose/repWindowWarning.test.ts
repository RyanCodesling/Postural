/**
 * repWindowWarning.test.ts
 *
 * Pins the rep-window warning: judged once per repetition, per limb, while the
 * limb rises through the window; flagged only after the deviation persists;
 * held to the end of the repetition; absent between repetitions.
 *
 * USAGE
 *   npx tsx src/lib/pose/repWindowWarning.test.ts
 */

import type { CompensationMetricSpec } from "@/lib/exercises/registry";
import {
  newRepWindowState,
  repWindowCompensationWarningSignal,
  updateRepWindowSide,
  type RepCounterPhase,
  type RepWindowSideState,
} from "./repWindowWarning";

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

// A static metric, so the deviation equals the value and the tests read plainly.
const shrug: CompensationMetricSpec = { name: "scapularElevation", warningThreshold: 0.04 };
const WINDOW = { from: 20, upTo: 60, persistMs: 100 };
const LEVEL = 0.04;

/** Feeds one limb a sequence of frames 50 ms apart; returns each frame's value. */
function run(frames: { phase: RepCounterPhase | null; primary: number; deviation: number }[], window = WINDOW) {
  let state: RepWindowSideState = newRepWindowState().left;
  const values: (number | null)[] = [];
  frames.forEach((frame, i) => {
    const step = updateRepWindowSide(state, { ...frame, nowMs: i * 50 }, window, LEVEL);
    state = step.state;
    values.push(step.value);
  });
  return values;
}

console.log("\nrep-window warning\n");

test("between repetitions there is no value", () => {
  const values = run([{ phase: "WAITING_FOR_REP_START", primary: 5, deviation: 0.09 }]);
  assertEq(values[0], null, "waiting");
});

test("a repetition's first frame counts although the counter still reads waiting", () => {
  // The camera updates the counter after the warnings: on the frame the arm
  // crosses the start, the counter has not moved yet.
  const values = run([
    { phase: "WAITING_FOR_REP_START", primary: 31, deviation: 0.069 },
    { phase: "ASCENDING", primary: 60, deviation: 0.03 },
    { phase: "ASCENDING", primary: 90, deviation: 0.01 },
  ], { ...WINDOW, persistMs: 0 });
  assertEq(values[0], 0.069, "the starting frame is in the window and flags at once");
  assertEq(values[2], 0.069, "held through the repetition");
});

test("before a flag the in-window deviation passes through; outside it there is none", () => {
  const values = run([
    { phase: "ASCENDING", primary: 30, deviation: 0.02 },
    { phase: "ASCENDING", primary: 80, deviation: 0.02 },
  ]);
  assertEq(values[0], 0.02, "in the window");
  assertEq(values[1], null, "above the window, not flagged");
});

test("a deviation that persists is flagged and held to the end of the repetition", () => {
  const values = run([
    { phase: "ASCENDING", primary: 25, deviation: 0.05 }, // 0 ms: run starts
    { phase: "ASCENDING", primary: 30, deviation: 0.06 }, // 50 ms
    { phase: "ASCENDING", primary: 35, deviation: 0.07 }, // 100 ms: flagged at 0.07
    { phase: "ASCENDING", primary: 90, deviation: 0.01 }, // top: masked, still held
    { phase: "DESCENDING", primary: 40, deviation: 0.02 },
    { phase: "WAITING_FOR_REP_START", primary: 5, deviation: 0.03 },
  ]);
  assertEq(values[1], 0.06, "not yet persisted: live value");
  assertEq(values[2], 0.07, "flagged");
  assertEq(values[3], 0.07, "held at the top");
  assertEq(values[4], 0.07, "held on the way down");
  assertEq(values[5], null, "released when the repetition ends");
});

test("a spike shorter than the persistence time is not held", () => {
  const values = run([
    { phase: "ASCENDING", primary: 25, deviation: 0.09 }, // 0 ms
    { phase: "ASCENDING", primary: 30, deviation: 0.01 }, // 50 ms: run broken
    { phase: "ASCENDING", primary: 70, deviation: 0.01 }, // above the window
  ]);
  assertEq(values[2], null, "nothing held after a 50 ms spike");
});

test("each limb is judged on its own; a bilateral prescription surfaces the larger", () => {
  const frame = (phase: RepCounterPhase, value: number, primary = 30) => ({ value, primary, phase });
  let state = newRepWindowState();
  let result = repWindowCompensationWarningSignal(shrug, "both",
    { left: frame("ASCENDING", 0.05), right: frame("ASCENDING", 0.02) }, state, 0, WINDOW);
  state = result.state;
  result = repWindowCompensationWarningSignal(shrug, "both",
    { left: frame("ASCENDING", 0.05), right: frame("ASCENDING", 0.02) }, state, 150, WINDOW);
  assertEq(result.signal.side, "left", "the shrugging arm");
  assertEq(result.signal.value, 0.05, "its held value");

  const rightOnly = repWindowCompensationWarningSignal(shrug, "right",
    { left: frame("ASCENDING", 0.05), right: frame("ASCENDING", 0.02) }, result.state, 300, WINDOW);
  assertEq(rightOnly.signal.side, "right", "a right prescription reads only the right arm");
  assertEq(rightOnly.signal.value, 0.02, "right value");

  const resting = repWindowCompensationWarningSignal(shrug, "both",
    { left: frame("WAITING_FOR_REP_START", 0.05, 5), right: frame("WAITING_FOR_REP_START", 0.05, 5) }, result.state, 450, WINDOW);
  assertEq(resting.signal.value, null, "no value while both arms rest");
});

console.log(`\n  ${testsPassed} passed, ${testsFailed} failed\n`);
process.exit(testsFailed === 0 ? 0 : 1);
