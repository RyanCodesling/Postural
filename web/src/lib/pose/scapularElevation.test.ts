/**
 * scapularElevation.test.ts
 *
 * Synthetic-landmark tests for `computeScapularElevation`.
 *
 * USAGE
 * ─────
 *   npx tsx web/src/lib/pose/scapularElevation.test.ts
 *
 * The metric returns the RAW projection — baseline subtraction and sign
 * inversion happen in the camera loop. Tests therefore assert relative
 * comparisons (shrug produces SMALLER projection than rest) rather than
 * absolute values, because absolute values aren't clinically meaningful
 * without a baseline.
 */

import { computeScapularElevation } from "./poseMetrics";
import type { TiltReference } from "./poseMetrics";
import { RepCounter } from "./repCounter";
import { EXERCISE_REGISTRY } from "../exercises/registry";

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

function assertNotNull(actual: number | null, label: string): asserts actual is number {
  if (actual === null) throw new Error(`${label}: expected a number, got null`);
}

function assertNull(actual: number | null, label: string): void {
  if (actual !== null) throw new Error(`${label}: expected null, got ${actual}`);
}

function assertLessThan(actual: number, bound: number, label: string): void {
  if (!(actual < bound)) throw new Error(`${label}: expected < ${bound}, got ${actual}`);
}

function assertCloseTo(actual: number, expected: number, tol: number, label: string): void {
  if (Math.abs(actual - expected) > tol) {
    throw new Error(`${label}: expected ~${expected} (±${tol}), got ${actual}`);
  }
}

const TILT_REF: TiltReference = {
  cameraTiltDeg: 0,
  confidence: "high",
  divergenceDeg: 0,
};

function makeLandmarks(opts: {
  leftEar?:       { x: number; y: number; visibility?: number };
  rightEar?:      { x: number; y: number; visibility?: number };
  leftShoulder?:  { x: number; y: number; visibility?: number };
  rightShoulder?: { x: number; y: number; visibility?: number };
  leftHip?:       { x: number; y: number; visibility?: number };
  rightHip?:      { x: number; y: number; visibility?: number };
}): Array<{ x: number; y: number; visibility?: number }> {
  const lms: Array<{ x: number; y: number; visibility?: number }> = [];
  for (let i = 0; i <= 24; i++) lms.push({ x: 0, y: 0, visibility: 0 });
  const v = (p?: { x: number; y: number; visibility?: number }) =>
    p ? { ...p, visibility: p.visibility ?? 1 } : { x: 0, y: 0, visibility: 0 };
  lms[7]  = v(opts.leftEar);
  lms[8]  = v(opts.rightEar);
  lms[11] = v(opts.leftShoulder);
  lms[12] = v(opts.rightShoulder);
  lms[23] = v(opts.leftHip);
  lms[24] = v(opts.rightHip);
  return lms;
}

/** Standing neutral, patient facing camera. Ear above shoulder above hip. */
function neutralPose() {
  return makeLandmarks({
    leftEar:       { x: 0.58, y: 0.18 },
    rightEar:      { x: 0.42, y: 0.18 },
    leftShoulder:  { x: 0.60, y: 0.30 },
    rightShoulder: { x: 0.40, y: 0.30 },
    leftHip:       { x: 0.58, y: 0.55 },
    rightHip:      { x: 0.42, y: 0.55 },
  });
}

console.log("\ncomputeScapularElevation — synthetic data tests\n");

// ── REST ────────────────────────────────────────────────────────────────────

test("rest pose → finite positive value on both sides (ear above shoulder along trunk axis)", () => {
  const lms = neutralPose();
  const left  = computeScapularElevation(lms, TILT_REF, "left");
  const right = computeScapularElevation(lms, TILT_REF, "right");
  assertNotNull(left,  "left rest");
  assertNotNull(right, "right rest");
  if (left  <= 0) throw new Error(`left rest projection should be positive, got ${left}`);
  if (right <= 0) throw new Error(`right rest projection should be positive, got ${right}`);
});

// ── SHRUG ───────────────────────────────────────────────────────────────────

test("left shoulder hiked up toward ear → smaller projection than rest", () => {
  const rest = neutralPose();
  const restLeft = computeScapularElevation(rest, TILT_REF, "left");
  assertNotNull(restLeft, "rest left");

  // Hike: move left shoulder UP (smaller y) by ~one third of the rest
  // ear-to-shoulder gap. Don't move the ear.
  const shrug = neutralPose();
  shrug[11] = { x: 0.60, y: 0.26, visibility: 1 };
  const shrugLeft = computeScapularElevation(shrug, TILT_REF, "left");
  assertNotNull(shrugLeft, "shrug left");

  assertLessThan(shrugLeft, restLeft, "shrug should reduce projection vs rest");
});

test("only LEFT shoulder hikes → right side projection essentially unchanged", () => {
  const rest = neutralPose();
  const restRight = computeScapularElevation(rest, TILT_REF, "right");
  assertNotNull(restRight, "rest right");

  const asymShrug = neutralPose();
  asymShrug[11] = { x: 0.60, y: 0.26, visibility: 1 };
  const asymRight = computeScapularElevation(asymShrug, TILT_REF, "right");
  assertNotNull(asymRight, "asym right");

  // Right side uses RIGHT shoulder for its ear-offset, so moving the LEFT
  // shoulder should barely move the right-side reading. There IS a second-
  // order effect: the shoulder midpoint (which defines the trunk axis) shifts
  // by ~hike/2, so trunk length and the projection's normalization both drift
  // by ~hike/trunkLen. With a 0.04 hike on a 0.25 trunk that's ~8% drift,
  // even though the right-side ear-from-shoulder geometry is unchanged.
  // 10% tolerance covers this while still being tight enough that any real
  // cross-contamination of the asymmetry signal would fail the test.
  assertCloseTo(asymRight, restRight, restRight * 0.10, "right side under unilateral hike");
});

// ── FORWARD LEAN (proper lateral-raise form) ────────────────────────────────
//
// This is the headline test. Naïve image-vertical scapular elevation would
// register a forward lean as a shrug; trunk-axis projection should not.

test("symmetric forward lean → projection roughly preserved (no false shrug)", () => {
  // Construct a forward-leaning pose by rotating the upper body forward AROUND
  // the hip line. In 2D image space, this looks like the shoulders moving
  // slightly UP and SLIGHTLY closer in x to where they were (because forward
  // lean foreshortens the trunk in the image), with the ears moving with them.
  //
  // We approximate by SHORTENING the trunk in image-vertical (shoulders move
  // DOWN toward the hips), and ALSO shortening the ear-to-shoulder distance
  // by the same fraction (the head leans WITH the trunk).
  const rest = neutralPose();
  const restLeft = computeScapularElevation(rest, TILT_REF, "left");
  assertNotNull(restLeft, "rest left");

  const leanFactor = 0.7; // trunk and head both foreshorten by 30%
  const lean = makeLandmarks({
    // Shoulders move DOWN (larger y) toward hips by 30% of rest trunk length
    leftShoulder:  { x: 0.60, y: 0.30 + (0.55 - 0.30) * (1 - leanFactor) },
    rightShoulder: { x: 0.40, y: 0.30 + (0.55 - 0.30) * (1 - leanFactor) },
    // Ears stay the SAME distance above the new shoulder position as they
    // were above the old one, scaled by the same lean factor.
    leftEar:       { x: 0.58, y: (0.30 + (0.55 - 0.30) * (1 - leanFactor)) - (0.30 - 0.18) * leanFactor },
    rightEar:      { x: 0.42, y: (0.30 + (0.55 - 0.30) * (1 - leanFactor)) - (0.30 - 0.18) * leanFactor },
    leftHip:       { x: 0.58, y: 0.55 },
    rightHip:      { x: 0.42, y: 0.55 },
  });
  const leanLeft = computeScapularElevation(lean, TILT_REF, "left");
  assertNotNull(leanLeft, "lean left");

  // The whole point: the projection should be roughly preserved despite the
  // image-vertical distances all changing. Allow generous tolerance because
  // a 2D foreshortening approximation isn't perfect.
  assertCloseTo(leanLeft, restLeft, restLeft * 0.20, "forward lean must not look like a shrug");
});

// ── SCALE INVARIANCE ────────────────────────────────────────────────────────

test("scaled-up patient (further from camera) → same projection value", () => {
  // Patient further from camera: all landmarks compress toward image center.
  // Trunk-length normalization should make this invariant.
  const rest = neutralPose();
  const restLeft = computeScapularElevation(rest, TILT_REF, "left");
  assertNotNull(restLeft, "rest left");

  const scaled = makeLandmarks({
    leftEar:       { x: 0.54, y: 0.28 },
    rightEar:      { x: 0.46, y: 0.28 },
    leftShoulder:  { x: 0.55, y: 0.34 },
    rightShoulder: { x: 0.45, y: 0.34 },
    leftHip:       { x: 0.54, y: 0.46 },
    rightHip:      { x: 0.46, y: 0.46 },
  });
  const scaledLeft = computeScapularElevation(scaled, TILT_REF, "left");
  assertNotNull(scaledLeft, "scaled left");

  assertCloseTo(scaledLeft, restLeft, 0.05, "projection should be scale-invariant");
});

// ── VISIBILITY GATING ───────────────────────────────────────────────────────

test("low-vis left ear → left null, right still computable", () => {
  const lms = neutralPose();
  lms[7] = { x: 0.58, y: 0.18, visibility: 0.2 };
  const left  = computeScapularElevation(lms, TILT_REF, "left");
  const right = computeScapularElevation(lms, TILT_REF, "right");
  assertNull(left, "left with low-vis ear");
  assertNotNull(right, "right unaffected");
});

test("low-vis hip → both sides null (trunk axis broken)", () => {
  const lms = neutralPose();
  lms[24] = { x: 0.42, y: 0.55, visibility: 0.2 };
  const left  = computeScapularElevation(lms, TILT_REF, "left");
  const right = computeScapularElevation(lms, TILT_REF, "right");
  assertNull(left,  "left null with low-vis hip");
  assertNull(right, "right null with low-vis hip");
});

// ── EX_003 END-TO-END PIPELINE ──────────────────────────────────────────────
//
// Drives the same RepCounter the camera loop uses, with the same per-exercise
// descentEpsilon override, over a synthetic shrug-up-then-down sequence.
// Validates that the bug cascade described in the planning doc is actually
// fixed: baseline subtraction produces a positive delta, descentEpsilon at
// 0.005 lets descent fire, the state machine reaches DESCENDING and then
// emits a rep.

console.log("\nex_003 full pipeline — synthetic shrug ends in 1 rep per side\n");

test("synthetic single shrug counts as 1 rep on each side after baseline capture", () => {
  const ex003 = EXERCISE_REGISTRY.ex_003;
  if (ex003.kind !== "dynamic") {
    throw new Error("ex_003 should be dynamic in the registry");
  }
  if (!ex003.primaryMetric.requiresBaselineCapture) {
    throw new Error("ex_003 should declare requiresBaselineCapture");
  }
  const eps = ex003.primaryMetric.descentEpsilon;
  if (eps === undefined) {
    throw new Error("ex_003 should declare descentEpsilon");
  }

  const leftCounter  = new RepCounter(ex003.primaryMetric.thresholds, { descentEpsilon: eps });
  const rightCounter = new RepCounter(ex003.primaryMetric.thresholds, { descentEpsilon: eps });

  // Frame timeline at 30 fps:
  //   0–59    rest (baseline capture, 2 s)
  //   60–104  ascend (shrug up, 1.5 s)
  //   105–113 peak hold (0.3 s)
  //   114–158 descend (release, 1.5 s)
  //   159–173 post-rest (0.5 s)
  const REST_Y = 0.30;
  const PEAK_Y = 0.27;  // shoulders move up by 0.03 image-vertical
  const TOTAL_FRAMES = 174;

  const shoulderYAtFrame = (i: number): number => {
    if (i < 60)  return REST_Y;
    if (i < 105) return REST_Y - ((REST_Y - PEAK_Y) * (i - 60)) / 45;
    if (i < 114) return PEAK_Y;
    if (i < 159) return PEAK_Y + ((REST_Y - PEAK_Y) * (i - 114)) / 45;
    return REST_Y;
  };

  const frameLandmarks = (i: number) => {
    const y = shoulderYAtFrame(i);
    return makeLandmarks({
      leftEar:       { x: 0.58, y: 0.18 },
      rightEar:      { x: 0.42, y: 0.18 },
      leftShoulder:  { x: 0.60, y },
      rightShoulder: { x: 0.40, y },
      leftHip:       { x: 0.58, y: 0.55 },
      rightHip:      { x: 0.42, y: 0.55 },
    });
  };

  // Step 1: collect 60 rest samples as baseline (mirrors camera-loop logic).
  const leftSamples: number[] = [];
  const rightSamples: number[] = [];
  for (let i = 0; i < 60; i++) {
    const lms = frameLandmarks(i);
    const l = computeScapularElevation(lms, TILT_REF, "left");
    const r = computeScapularElevation(lms, TILT_REF, "right");
    if (l !== null) leftSamples.push(l);
    if (r !== null) rightSamples.push(r);
  }
  if (leftSamples.length < 60 || rightSamples.length < 60) {
    throw new Error("baseline collection failed: not enough valid samples");
  }
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const leftBaseline  = mean(leftSamples);
  const rightBaseline = mean(rightSamples);

  // Step 2: feed the rest of the timeline through the counters with the
  // (baseline − raw) transform that the camera loop applies.
  let leftReps  = 0;
  let rightReps = 0;
  let leftPeakValue:  number | null = null;
  let rightPeakValue: number | null = null;

  for (let i = 60; i < TOTAL_FRAMES; i++) {
    const tMs = i * (1000 / 30);
    const lms = frameLandmarks(i);
    const l = computeScapularElevation(lms, TILT_REF, "left");
    const r = computeScapularElevation(lms, TILT_REF, "right");

    if (l !== null) {
      const adjusted = leftBaseline - l;
      const evt = leftCounter.update(adjusted, tMs);
      if (evt) { leftReps += 1; leftPeakValue = evt.peakValue; }
    }
    if (r !== null) {
      const adjusted = rightBaseline - r;
      const evt = rightCounter.update(adjusted, tMs);
      if (evt) { rightReps += 1; rightPeakValue = evt.peakValue; }
    }
  }

  if (leftReps  !== 1) throw new Error(`expected 1 left rep, got ${leftReps}`);
  if (rightReps !== 1) throw new Error(`expected 1 right rep, got ${rightReps}`);
  if (leftPeakValue  === null || leftPeakValue  < ex003.primaryMetric.thresholds.minimumPeakThreshold) {
    throw new Error(`left peak ${leftPeakValue} must be ≥ minimumPeakThreshold`);
  }
  if (rightPeakValue === null || rightPeakValue < ex003.primaryMetric.thresholds.minimumPeakThreshold) {
    throw new Error(`right peak ${rightPeakValue} must be ≥ minimumPeakThreshold`);
  }
});

test("with no baseline subtraction (raw projection fed in directly), rep counter cannot fire on shrugs", () => {
  // Regression guard: this confirms the bug we just fixed actually was real.
  // If a future change removes the baseline transform, this test should still
  // pass — i.e., we should observe zero reps when the raw projection is fed
  // directly with the default descentEpsilon.
  const ex003 = EXERCISE_REGISTRY.ex_003;
  if (ex003.kind !== "dynamic") throw new Error("ex_003 should be dynamic");

  // Note: explicitly NOT passing descentEpsilon, so the counter uses the
  // default 0.5 — the original pre-fix state.
  const counter = new RepCounter(ex003.primaryMetric.thresholds);

  for (let i = 60; i < 174; i++) {
    const tMs = i * (1000 / 30);
    const y =
      i < 105 ? 0.30 - ((0.30 - 0.27) * (i - 60)) / 45 :
      i < 114 ? 0.27 :
      i < 159 ? 0.27 + ((0.30 - 0.27) * (i - 114)) / 45 :
      0.30;
    const lms = makeLandmarks({
      leftEar:      { x: 0.58, y: 0.18 },
      rightEar:     { x: 0.42, y: 0.18 },
      leftShoulder: { x: 0.60, y },
      rightShoulder:{ x: 0.40, y },
      leftHip:      { x: 0.58, y: 0.55 },
      rightHip:     { x: 0.42, y: 0.55 },
    });
    const raw = computeScapularElevation(lms, TILT_REF, "left");
    if (raw !== null) counter.update(raw, tMs);
  }
  if (counter.getRepCount() !== 0) {
    throw new Error(`without baseline subtraction the counter must produce 0 reps, got ${counter.getRepCount()}`);
  }
});

console.log(`\n  ${testsPassed} passed, ${testsFailed} failed\n`);
process.exit(testsFailed > 0 ? 1 : 0);
