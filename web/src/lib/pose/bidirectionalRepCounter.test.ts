/**
 * Synthetic tests for the signed bidirectional wrapper used by exercises such
 * as Neck Lateral Flexion. Run with:
 *
 *   npx tsx src/lib/pose/bidirectionalRepCounter.test.ts
 */

import {
  BidirectionalRepCounter,
  type BidirectionalRepEvent,
} from "./bidirectionalRepCounter";

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

const NECK_THRESHOLDS = {
  startThreshold: 5,
  repCompleteThreshold: 2,
  minimumPeakThreshold: 12,
  targetROM: 30,
};

function feed(
  counter: BidirectionalRepCounter,
  samples: Array<[number, number]>,
): BidirectionalRepEvent[] {
  const events: BidirectionalRepEvent[] = [];
  for (const [angle, t] of samples) {
    const event = counter.update(angle, t);
    if (event) events.push(event);
  }
  return events;
}

console.log("\nBidirectionalRepCounter — synthetic data tests\n");

test("positive signed peak emits a left-side rep", () => {
  const counter = new BidirectionalRepCounter(NECK_THRESHOLDS);
  const events = feed(counter, [
    [0, 0],
    [0, 33],
    [6, 66],
    [15, 99],
    [20, 132],
    [10, 165],
    [1, 198],
  ]);

  assertEqual(events.length, 1, "event count");
  assertEqual(events[0].side, "left", "side");
});

test("negative signed peak emits a right-side rep", () => {
  const counter = new BidirectionalRepCounter(NECK_THRESHOLDS);
  const events = feed(counter, [
    [0, 0],
    [0, 33],
    [-6, 66],
    [-15, 99],
    [-20, 132],
    [-10, 165],
    [-1, 198],
  ]);

  assertEqual(events.length, 1, "event count");
  assertEqual(events[0].side, "right", "side");
});

test("opposite-side return-stroke overshoot before neutral settle is suppressed", () => {
  const counter = new BidirectionalRepCounter(NECK_THRESHOLDS);
  const events = feed(counter, [
    [0, 0],
    [0, 33],
    [6, 66],
    [15, 99],
    [20, 132],
    [10, 165],
    [1, 198],

    // Immediate post-rep overshoot to the opposite sign. Without the
    // neutral-settle gate, this |angle| arc satisfies the generic counter and
    // emits a right-side phantom rep.
    [-6, 231],
    [-14, 264],
    [-16, 297],
    [-8, 330],
    [-1, 363],

    // Back at neutral long enough to release the gate.
    [0, 396],
    [0, 429],
    [0, 462],
    [0, 495],
    [0, 528],
    [0, 561],
    [0, 594],
    [0, 627],
    [0, 660],
    [0, 693],
  ]);

  assertEqual(events.length, 1, "event count");
  assertEqual(events[0].side, "left", "first event side");
});

test("deliberate opposite-side rep after neutral settle still counts", () => {
  const counter = new BidirectionalRepCounter(NECK_THRESHOLDS);
  const events = feed(counter, [
    [0, 0],
    [0, 33],
    [6, 66],
    [15, 99],
    [20, 132],
    [10, 165],
    [1, 198],

    // Exact neutral dwell gives the wrapper enough stable center evidence to
    // allow the next signed-side rep.
    [0, 231],
    [0, 264],
    [0, 297],
    [0, 330],
    [0, 363],
    [0, 396],
    [0, 429],
    [0, 462],
    [0, 495],
    [0, 528],

    [-6, 561],
    [-15, 594],
    [-20, 627],
    [-10, 660],
    [-1, 693],
  ]);

  assertEqual(events.length, 2, "event count");
  assertEqual(events[0].side, "left", "first side");
  assertEqual(events[1].side, "right", "second side");
});

test("deliberate opposite-side rep after loose neutral still counts", () => {
  const counter = new BidirectionalRepCounter(NECK_THRESHOLDS);
  const events = feed(counter, [
    [0, 0],
    [0, 33],
    [6, 66],
    [15, 99],
    [20, 132],
    [10, 165],
    [1, 198],

    // Realistic between-rep neutral for neck flexion: close to center but not
    // perfectly within the 2° repCompleteThreshold. PF iteration 1 incorrectly
    // kept the gate closed here forever; PF iteration 2 uses restSettleBand.
    [3.8, 231],
    [4.1, 264],
    [3.6, 297],
    [3.9, 330],
    [4.0, 363],

    [-6, 396],
    [-15, 429],
    [-20, 462],
    [-10, 495],
    [-1, 528],
  ]);

  assertEqual(events.length, 2, "event count");
  assertEqual(events[0].side, "left", "first side");
  assertEqual(events[1].side, "right", "second side");
});

test("immediate deliberate opposite-side rep after refractory still counts", () => {
  const counter = new BidirectionalRepCounter(NECK_THRESHOLDS);
  const events = feed(counter, [
    [0, 0],
    [0, 33],
    [6, 66],
    [15, 99],
    [20, 132],
    [10, 165],
    [1, 198],

    // The patient starts the next side immediately after the first rep
    // completes. PF iteration 2 swallowed this entire rep while waiting for
    // neutral dwell; the post-rep gate should only cover the short refractory
    // interval, then let the underlying RepCounter see the ascent.
    [-4, 231],
    [-10, 264],
    [-16, 297],
    [-20, 330],
    [-24, 363],
    [-30, 396],
    [-24, 429],
    [-10, 462],
    [-1, 495],
  ]);

  assertEqual(events.length, 2, "event count");
  assertEqual(events[0].side, "left", "first side");
  assertEqual(events[1].side, "right", "second side");
});

test("post-refractory limited-ROM opposite-side partial still counts", () => {
  const counter = new BidirectionalRepCounter(NECK_THRESHOLDS);
  const events = feed(counter, [
    [0, 0],
    [0, 33],
    [6, 66],
    [15, 99],
    [20, 132],
    [10, 165],
    [1, 198],

    // Limited ROM on the opposite side: this lasts beyond the short
    // refractory window and peaks above minimumPeakThreshold but below
    // targetROM. It is clinically meaningful and should count as partial.
    [-4, 231],
    [-8, 264],
    [-13, 363],
    [-18, 396],
    [-10, 429],
    [-1, 462],
  ]);

  assertEqual(events.length, 2, "event count");
  assertEqual(events[0].side, "left", "first side");
  assertEqual(events[0].event.index, 1, "first visible event index");
  assertEqual(events[1].side, "right", "second side");
  assertEqual(events[1].event.classification, "partial", "second classification");
  assertEqual(events[1].event.index, 2, "second visible event index");
});

test("near-neutral sign crossing splits opposite-side reps", () => {
  const counter = new BidirectionalRepCounter(NECK_THRESHOLDS);
  const events = feed(counter, [
    [0, 0],
    [-6, 33],
    [-20, 66],
    [-48, 99],
    [-30, 132],
    [-5.9, 165],
    [-2.9, 198],

    // Crosses to the next side without ever reaching the strict 2° complete
    // threshold. The bidirectional counter should still finish the right rep
    // inside the neutral settle band instead of merging it into the left rep.
    [2.3, 231],
    [5.9, 264],
    [22.9, 330],
    [50.9, 363],
    [62.7, 396],
    [57.8, 429],
    [24.1, 462],
    [1.3, 495],
  ]);

  assertEqual(events.length, 2, "event count");
  assertEqual(events[0].side, "right", "first side");
  assertEqual(events[0].event.classification, "complete", "first classification");
  assertEqual(events[1].side, "left", "second side");
  assertEqual(events[1].event.classification, "complete", "second classification");
});

test("missed-neutral sign crossing while descending completes the current side", () => {
  const counter = new BidirectionalRepCounter(NECK_THRESHOLDS);
  const events = feed(counter, [
    [0, 0],
    [-6, 33],
    [-20, 66],
    [-43.8, 99],
    [-42.7, 132],
    [-22.3, 165],
    [-10.9, 198],
    [-7.5, 231],

    // The true path crossed neutral between frames, but the sampled values
    // jumped from -7.5 to +7.5. This should finish the right rep instead of
    // merging it into the following stronger left rep.
    [7.5, 264],
    [11.1, 297],
    [23.3, 330],
    [30.9, 429],
    [44.7, 462],
    [57.3, 495],
    [56.3, 528],
    [13.5, 561],
    [0, 594],
  ]);

  assertEqual(events.length, 2, "event count");
  assertEqual(events[0].side, "right", "first side");
  assertEqual(events[0].event.classification, "complete", "first classification");
  assertEqual(events[1].side, "left", "second side");
  assertEqual(events[1].event.classification, "complete", "second classification");
});

test("post-refractory complete rep with early dip still counts", () => {
  const counter = new BidirectionalRepCounter(NECK_THRESHOLDS);
  const events = feed(counter, [
    [0, 0],
    [0, 33],
    [-6, 66],
    [-35, 99],
    [-10, 132],
    [-1, 165],

    // Mirrors Console_Logs4: after the short refractory release, the next
    // movement has a tiny early dip but then reaches complete ROM.
    [3.4, 198],
    [7.5, 231],
    [12.3, 264],
    [17.8, 330],
    [17.0, 363],
    [19.8, 396],
    [25.8, 429],
    [34.8, 462],
    [42.5, 495],
    [57.2, 528],
    [64.3, 561],
    [63.3, 594],
    [57.9, 627],
    [43.0, 660],
    [27.2, 693],
    [13.2, 726],
    [5.5, 759],
    [1.0, 792],
  ]);

  assertEqual(events.length, 2, "event count");
  assertEqual(events[0].side, "right", "first side");
  assertEqual(events[1].side, "left", "second side");
  assertEqual(events[1].event.classification, "complete", "second classification");
  assertEqual(events[1].event.index, 2, "second visible event index");
});

test("refused high-angle frame does not stale-tag the next rep", () => {
  const counter = new BidirectionalRepCounter(NECK_THRESHOLDS);
  const events = feed(counter, [
    // Simulates returning from a short capture dropout mid-rep: the counter
    // sees a high angle without prior rest evidence and must refuse it.
    [35, 0],
    [30, 33],
    [10, 66],
    [0, 99],

    // The next real rep is negative/right. A refused positive frame must not
    // remain in peak-sign tracking and relabel this as left.
    [-6, 132],
    [-15, 165],
    [-25, 198],
    [-18, 231],
    [-8, 264],
    [-1, 297],
  ]);

  assertEqual(events.length, 1, "event count");
  assertEqual(events[0].side, "right", "side");
});

test("restSettleBand must remain below minimumPeakThreshold", () => {
  let threw = false;
  try {
    new BidirectionalRepCounter(NECK_THRESHOLDS, {
      restSettleBand: NECK_THRESHOLDS.minimumPeakThreshold,
    });
  } catch {
    threw = true;
  }
  assertEqual(threw, true, "expected constructor to throw");
});

console.log(`\n  ${testsPassed} passed, ${testsFailed} failed\n`);
process.exit(testsFailed > 0 ? 1 : 0);
