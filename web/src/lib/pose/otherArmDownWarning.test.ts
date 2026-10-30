/**
 * The arm hold's "Raise this arm" check (otherArmDownWarning.ts).
 * Run with: npx tsx src/lib/pose/otherArmDownWarning.test.ts
 */
import assert from "node:assert/strict";
import { newOtherArmDownState, updateOtherArmDown, updateArmAboveHold } from "./otherArmDownWarning";

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

const CHECK = { persistMs: 700, low: 84.3, high: 95.7 };
type Frame = {
  left: number | null; right: number | null; timed?: boolean;
  unsteadyLeft?: boolean; unsteadyRight?: boolean; doneLeft?: boolean; doneRight?: boolean;
};

/** Frames 100 ms apart from one state; the result of each. */
function run(frames: Frame[], above = false) {
  let state = newOtherArmDownState();
  return frames.map((f, i) => {
    const result = (above ? updateArmAboveHold : updateOtherArmDown)(
      state,
      {
        left: { value: f.left, unsteady: f.unsteadyLeft ?? false, done: f.doneLeft ?? false },
        right: { value: f.right, unsteady: f.unsteadyRight ?? false, done: f.doneRight ?? false },
        timed: f.timed ?? true,
        nowMs: 1000 + 100 * i,
      },
      CHECK,
    );
    state = result.state;
    return result;
  });
}
const repeat = (n: number, frame: Frame) => Array.from({ length: n }, () => frame);

console.log("\nThe arm hold's raise-this-arm check\n");

test("an arm left down while the other is held is flagged after the wait, with its own reading", () => {
  const out = run(repeat(10, { left: 90, right: 20 }));
  assert.equal(out[6].side, null, "not before 700 ms");
  assert.equal(out[7].side, "right", "at 700 ms");
  assert.equal(out[7].value, 20, "the lowered arm's reading");
  const left = run(repeat(8, { left: 30, right: 88 }));
  assert.equal(left[7].side, "left");
  assert.equal(left[7].value, 30);
});

test("both low arms are monitored independently and correction hands the cue to the other without restarting its wait", () => {
  const out = run([...repeat(8, { left: 20, right: 30 }), { left: 90, right: 30 }]);
  assert.equal(out[7].side, "left", "furthest below the band first");
  assert.equal(out[8].side, "right", "the other arm already waited long enough");
});

test("both arms up is not flagged, nor an arm above the band beside one in it", () => {
  assert(run(repeat(12, { left: 90, right: 100 })).every((r) => r.side === null));
  assert(run(repeat(12, { left: 84.3, right: 95.7 })).every((r) => r.side === null), "the band's edges count as in it");
});

test("an opposite arm above the band alone is not evidence of a tilted body", () => {
  assert.equal(run(repeat(8, { left: 98, right: 81 }))[7].side, "right", "posture gating belongs to the actual camera caller");
  assert.equal(run(repeat(8, { left: 110, right: 15 }))[7].side, "right", "the opposite arm need not be in band");
  assert.equal(run(repeat(8, { left: 95.7, right: 15 }))[7].side, "right", "at the band's top edge it is held");
});

test("each unfinished arm is checked even if the other arm is just below the band or already done", () => {
  assert.equal(run(repeat(8, { left: 83, right: 10 }))[7].side, "right", "a lower left reading cannot hide a lowered right arm");
  assert.equal(run(repeat(8, { left: 10, right: 83 }))[7].side, "left", "same rule the other way");
  assert.equal(run(repeat(8, { left: 10, right: 20, doneLeft: true }))[7].side, "right", "the finished arm can rest while the other is guided");
});

test("nothing while the hold is not being timed, and the wait starts over when it is", () => {
  const out = run([...repeat(10, { left: 90, right: 20, timed: false }), ...repeat(8, { left: 90, right: 20 })]);
  assert(out.slice(0, 10).every((r) => r.side === null), "not timed");
  assert.equal(out[16].side, null, "600 ms into the timed hold");
  assert.equal(out[17].side, "right", "700 ms into it");
});

test("an arm that has reached its hold may rest: not cued, while the other arm still is", () => {
  assert(run(repeat(12, { left: 20, right: 90, doneLeft: true })).every((r) => r.side === null), "the finished left arm rests");
  assert.equal(run(repeat(8, { left: 90, right: 20, doneLeft: true }))[7].side, "right", "the right arm still owes time");
});

test("held back while either arm is unsteady", () => {
  assert(run(repeat(12, { left: 90, right: 20, unsteadyRight: true })).every((r) => r.side === null), "the lowered arm");
  assert(run(repeat(12, { left: 90, right: 20, unsteadyLeft: true })).every((r) => r.side === null), "the held arm");
});

test("a missing reading clears it, and the wait starts over", () => {
  const out = run([...repeat(8, { left: 90, right: 20 }), { left: null, right: 20 }, ...repeat(8, { left: 90, right: 20 })]);
  assert.equal(out[7].side, "right");
  assert.equal(out[8].side, null, "no reading");
  assert.equal(out[15].side, null, "600 ms after");
  assert.equal(out[16].side, "right", "700 ms after");
});

test("the other arm going down instead restarts the wait", () => {
  const out = run([...repeat(5, { left: 90, right: 20 }), ...repeat(8, { left: 20, right: 90 })]);
  assert(out.slice(0, 12).every((r) => r.side === null), "no flag before 700 ms on either side");
  assert.equal(out[12].side, "left");
});

test("the upper-band cue uses the same per-arm wait, exact band edges and finished/tracking guards", () => {
  const out = run([...repeat(8, { left: 110, right: 100 }), { left: 90, right: 100 }, { left: 90, right: 90 }], true);
  assert.equal(out[6].side, null, "not before the existing wait");
  assert.equal(out[7].side, "left", "the higher arm first");
  assert.equal(out[8].side, "right", "the other arm already qualified");
  assert.equal(out[9].value, null, "cleared at shoulder height");
  assert(run(repeat(9, { left: 84.3, right: 95.7 }), true).every(r => r.value === null), "band edges are accepted");
  assert(run(repeat(9, { left: 110, right: 90, doneLeft: true }), true).every(r => r.value === null), "finished arm can rest");
  assert(run(repeat(9, { left: 110, right: 90, unsteadyLeft: true }), true).every(r => r.value === null), "unsteady tracking");
  assert(run(repeat(9, { left: 90, right: 110, timed: false }), true).every(r => r.value === null), "not during rest");
});

// The review of 2026-10-28: with both arms out of the band, the arm furthest out was re-chosen on every frame, so
// about a degree of reading noise between two lowered arms moved the cue from arm to arm.
const sideSwitches = (out: { side: string | null }[]) =>
  out.filter((r, i) => i > 0 && r.side !== null && out[i - 1].side !== null && r.side !== out[i - 1].side).length;

test("two arms about equally far below keep the cue on the arm it went to first", () => {
  const out = run(Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? { left: 20, right: 21 } : { left: 21, right: 20 })));
  assert.equal(out[6].side, null, "not before the wait");
  assert.equal(out[7].side, "right", "furthest below the band first");
  assert(out.slice(7).every((r) => r.side === "right"), `kept: ${out.map((r) => r.side).join(" ")}`);
  assert.equal(out[8].value, 21, "with that arm's own reading");
  assert.equal(sideSwitches(out), 0);
});

test("the cued arm keeps the cue while it still qualifies; it moves when that arm is corrected or finished", () => {
  const out = run([
    ...repeat(8, { left: 20, right: 30 }),
    ...repeat(4, { left: 30, right: 20 }),
    { left: 90, right: 20 },
    ...repeat(8, { left: 10, right: 20 }),
    { left: 10, right: 20, doneRight: true },
  ]);
  assert.equal(out[7].side, "left", "furthest below first");
  assert(out.slice(8, 12).every((r) => r.side === "left" && r.value === 30), "still left once the right arm is further down");
  assert.equal(out[12].side, "right", "left corrected: the right arm, already waited, takes it");
  assert(out.slice(13, 21).every((r) => r.side === "right"), "the left arm going further down again does not take it back");
  assert.equal(out[21].side, "left", "right finished: the left arm, waited again, takes it");
});

test("the upper-band cue keeps its arm the same way", () => {
  const out = run(Array.from({ length: 16 }, (_, i) => (i % 2 === 0 ? { left: 101, right: 100 } : { left: 100, right: 101 })), true);
  assert.equal(out[7].side, "right", "the higher arm first");
  assert(out.slice(7).every((r) => r.side === "right"), `kept: ${out.map((r) => r.side).join(" ")}`);
});

test("a reset forgets the cued arm, so the next cue again goes to the arm furthest out", () => {
  const out = run([
    ...repeat(8, { left: 20, right: 30 }),
    ...repeat(2, { left: 30, right: 20 }),
    { left: 30, right: 20, timed: false },
    ...repeat(8, { left: 30, right: 20 }),
  ]);
  assert.equal(out[9].side, "left", "kept before the reset");
  assert.equal(out[10].side, null, "not timed");
  assert.equal(out[17].side, null, "600 ms after");
  assert.equal(out[18].side, "right", "700 ms after: the arm furthest below");
});

test("the input state is not mutated", () => {
  const state = newOtherArmDownState();
  updateOtherArmDown(state, { left: { value: 90, unsteady: false, done: false }, right: { value: 20, unsteady: false, done: false }, timed: true, nowMs: 5000 }, CHECK);
  assert.deepEqual(state, { leftSinceMs: null, rightSinceMs: null, side: null });
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exitCode = 1;
