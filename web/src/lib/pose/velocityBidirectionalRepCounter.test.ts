/**
 * Synthetic velocity-profile tests for the ex_004 bidirectional segmenter.
 * Run with:
 *
 *   npx tsx src/lib/pose/velocityBidirectionalRepCounter.test.ts
 */

import {
  VelocityBidirectionalRepCounter,
} from "./velocityBidirectionalRepCounter";
import type { BidirectionalRepEvent } from "./bidirectionalRepCounter";

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
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

const NECK_THRESHOLDS = {
  startThreshold: 5,
  repCompleteThreshold: 2,
  minimumPeakThreshold: 12,
  targetROM: 30,
};

type VelocitySample = [signedAngleDeg: number, tMs: number, velocityDegPerSec: number];

function feed(
  counter: VelocityBidirectionalRepCounter,
  samples: VelocitySample[],
): BidirectionalRepEvent[] {
  const events: BidirectionalRepEvent[] = [];
  for (const [angle, t, velocity] of samples) {
    const event = counter.update(angle, t, velocity);
    if (event) events.push(event);
  }
  return events;
}

function makeCounter(): VelocityBidirectionalRepCounter {
  return new VelocityBidirectionalRepCounter(NECK_THRESHOLDS);
}

console.log("\nVelocityBidirectionalRepCounter — synthetic velocity tests\n");

test("single rep plus passive overshoot emits exactly one side-correct rep", () => {
  const events = feed(makeCounter(), [
    [0, 0, 0],
    [0, 33, 0],
    [6, 66, 90],
    [15, 99, 160],
    [20, 132, 40],
    [16, 165, -80],
    [7, 198, -110],
    [1, 231, -100],

    // Momentum carries through neutral into the opposite side. The opposite
    // peak has enough magnitude to look like a rep positionally, but there was
    // no low-velocity transition before it.
    [-6, 264, -95],
    [-14, 297, -70],
    [-16, 330, 0],
    [-8, 363, 80],
    [-1, 396, 70],
    [0, 429, 0],
  ]);

  assertEqual(events.length, 1, "event count");
  assertEqual(events[0].side, "left", "event side");
});

test("loose-neutral alternation counts at 3/5/7/8 degree residuals", () => {
  for (const residual of [3, 5, 7, 8]) {
    const events = feed(makeCounter(), [
      [0, 0, 0],
      [0, 33, 0],
      [6, 66, 90],
      [15, 99, 150],
      [20, 132, 20],
      [14, 165, -70],
      [residual, 198, 0],

      [-6, 231, -100],
      [-15, 264, -140],
      [-20, 297, -30],
      [-14, 330, 70],
      [-residual, 363, 0],
    ]);

    assertEqual(events.length, 2, `event count at residual ${residual}`);
    assertEqual(events[0].side, "left", `first side at residual ${residual}`);
    assertEqual(events[1].side, "right", `second side at residual ${residual}`);
  }
});

test("rapid deliberate alternation still counts both sides", () => {
  const events = feed(makeCounter(), [
    [0, 0, 0],
    [0, 33, 0],
    [6, 66, 100],
    [18, 99, 180],
    [24, 132, 25],
    [15, 165, -120],
    [5, 198, 0],
    [-5, 231, -80],
    [-16, 264, -170],
    [-24, 297, -25],
    [-14, 330, 120],
    [-4, 363, 0],
  ]);

  assertEqual(events.length, 2, "event count");
  assertEqual(events[0].side, "left", "first side");
  assertEqual(events[1].side, "right", "second side");
});

test("clean alternation emits each stroke with alternating sides", () => {
  const events = feed(makeCounter(), [
    [0, 0, 0],
    [0, 33, 0],
    [6, 66, 90],
    [18, 99, 160],
    [30, 132, 30],
    [18, 165, -120],
    [0, 198, 0],

    [-6, 231, -90],
    [-18, 264, -160],
    [-30, 297, -30],
    [-18, 330, 120],
    [0, 363, 0],

    [6, 396, 90],
    [18, 429, 160],
    [30, 462, 30],
    [18, 495, -120],
    [0, 528, 0],
  ]);

  assertEqual(events.length, 3, "event count");
  assertEqual(events[0].side, "left", "first side");
  assertEqual(events[1].side, "right", "second side");
  assertEqual(events[2].side, "left", "third side");
  assertEqual(events[0].event.classification, "complete", "first classification");
});

test("slow neutral drift does not launch or count a directed stroke", () => {
  const events = feed(makeCounter(), [
    [0, 0, 0],
    [2, 100, 6],
    [5, 200, 8],
    [9, 300, 10],
    [13, 400, 10],
    [11, 500, -8],
    [7, 600, -8],
    [0, 700, -8],
  ]);

  assertEqual(events.length, 0, "event count");
});

test("small live posture adjustments near neutral do not ghost count", () => {
  const events = feed(makeCounter(), [
    [6, 0, 0],
    [6, 33, 0],

    // Small corrections around the live observed 3-8 degree zone. Some samples
    // briefly touch the minimumPeakThreshold floor, but the excursion from the
    // armed rest point is too small to be a deliberate neck-flexion stroke.
    [8, 66, 32],
    [10, 99, 38],
    [12.4, 132, 26],
    [10, 165, -30],
    [6, 198, 0],

    [-8, 264, -32],
    [-10, 297, -38],
    [-12.3, 330, -26],
    [-10, 363, 30],
    [-6, 396, 0],

    [7, 462, 30],
    [11.8, 495, 34],
    [7, 528, -32],
    [6, 561, 0],
  ]);

  assertEqual(events.length, 0, "event count");
});

test("deliberate reduced-ROM rep above the original floor still counts", () => {
  const events = feed(makeCounter(), [
    [3, 0, 0],
    [3, 33, 0],
    [6, 66, 60],
    [10, 99, 80],
    [13, 132, 25],
    [9, 165, -60],
    [3, 198, 0],
  ]);

  assertEqual(events.length, 1, "event count");
  assertEqual(events[0].side, "left", "event side");
  assertEqual(events[0].event.classification, "partial", "classification");
});

console.log(`\n  ${testsPassed} passed, ${testsFailed} failed\n`);
process.exit(testsFailed > 0 ? 1 : 0);
