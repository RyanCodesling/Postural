/**
 * shoulderElbowDistance.test.ts
 *
 * Synthetic-landmark tests for `computeShoulderElbowDistance` — Wall Angels
 * (ex_008) compensation signal flagging elbow-off-wall via 2D foreshortening.
 *
 * USAGE
 * ─────
 *   npx tsx web/src/lib/pose/shoulderElbowDistance.test.ts
 *
 * ── 2D PROJECTION LIMITATION (DOCUMENTED, NOT A BUG) ─────────────────────────
 * In pure 2D x-y from a single front camera, subtle elbow-off-wall (< 15°
 * rotation toward camera) produces only ~3% ratio change (cos(15°) ≈ 0.97).
 * Significant elbow-off-wall (30–60°) DOES register (13–50% shortening).
 * Tests below cover what the metric CAN detect; subtle micro-creep cases
 * are explicitly out of scope and acknowledged as thesis limitation.
 *
 * ── COORDINATE NOTE ──────────────────────────────────────────────────────────
 * Patient against wall, arms in W-position (Wall Angels start):
 *
 *     y=0.20   wrists at ear-height
 *     y=0.30   shoulders ──────── elbows at shoulder height (extended outward)
 *     y=0.55   hips                            (trunk-length denominator)
 */

import { computeShoulderElbowDistance } from "./poseMetrics";
import type { TiltReference } from "./poseMetrics";

// ─────────────────────────────────────────────────────────────────────────────
// MICRO ASSERTION HELPER
// ─────────────────────────────────────────────────────────────────────────────

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

function assertCloseTo(actual: number | null, expected: number, tolerance: number, label: string): void {
  if (actual === null) {
    throw new Error(`${label}: expected ~${expected}, got null`);
  }
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label}: expected ~${expected} (±${tolerance}), got ${actual}`);
  }
}

function assertNull<T>(actual: T | null, label: string): void {
  if (actual !== null) {
    throw new Error(`${label}: expected null, got ${JSON.stringify(actual)}`);
  }
}

function assertLessThan(actual: number | null, threshold: number, label: string): void {
  if (actual === null) {
    throw new Error(`${label}: expected < ${threshold}, got null`);
  }
  if (actual >= threshold) {
    throw new Error(`${label}: expected < ${threshold}, got ${actual}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const TILT_REF: TiltReference = {
  cameraTiltDeg: 0,
  confidence: "high",
  divergenceDeg: 0,
};

type LM = { x: number; y: number; visibility?: number };

function makeLandmarks(opts: {
  leftShoulder?:  LM;
  rightShoulder?: LM;
  leftElbow?:     LM;
  rightElbow?:    LM;
  leftHip?:       LM;
  rightHip?:      LM;
}): LM[] {
  const lms: LM[] = [];
  for (let i = 0; i <= 24; i++) lms.push({ x: 0, y: 0, visibility: 0 });
  const v = (p?: LM) =>
    p ? { ...p, visibility: p.visibility ?? 1 } : { x: 0, y: 0, visibility: 0 };
  lms[11] = v(opts.leftShoulder);
  lms[12] = v(opts.rightShoulder);
  lms[13] = v(opts.leftElbow);
  lms[14] = v(opts.rightElbow);
  lms[23] = v(opts.leftHip);
  lms[24] = v(opts.rightHip);
  return lms;
}

// ─────────────────────────────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────────────────────────────

console.log("\ncomputeShoulderElbowDistance — synthetic data tests\n");

test("W-position against wall (elbow at shoulder height, lateral) → ratio ~0.5", () => {
  // Upper-arm horizontal in image plane, length 0.125 (a quarter of trunk
  // length on each side). Trunk length 0.25 → ratio 0.125/0.25 = 0.5.
  // Anatomically: upper-arm ≈ 0.5 × trunk for typical adult proportions.
  const lms = makeLandmarks({
    leftShoulder:  { x: 0.62, y: 0.30 },
    rightShoulder: { x: 0.38, y: 0.30 },
    leftElbow:     { x: 0.745, y: 0.30 },
    rightElbow:    { x: 0.255, y: 0.30 },
    leftHip:       { x: 0.58, y: 0.55 },
    rightHip:      { x: 0.42, y: 0.55 },
  });
  assertCloseTo(computeShoulderElbowDistance(lms, TILT_REF, "left"),  0.5, 0.02, "LEFT W-pos");
  assertCloseTo(computeShoulderElbowDistance(lms, TILT_REF, "right"), 0.5, 0.02, "RIGHT W-pos");
});

test("Elbow drop INCREASES the ratio ABOVE baseline (does NOT trigger the below-threshold warning — accepted scope limitation)", () => {
  // Pose: elbow hangs vertically below the shoulder. Upper-arm = 0.15 in
  // image units; trunk length = 0.25 → ratio = 0.60. Baseline (arm on wall,
  // horizontal) is ~0.50. So elbow-drop INCREASES the ratio (0.50 → 0.60).
  //
  // Why this matters: the ex_008 registry uses `compareDirection: "below"`
  // with `warningThreshold: 0.4` — the warning fires when the ratio DROPS
  // toward foreshortening, not when it RISES. So elbow-drop is OUTSIDE
  // the metric's flagging scope. This test pins that fact as a regression
  // guard: a future "improvement" that broadens the metric to also catch
  // elbow-drop will have to consciously break this assertion. See
  // `computeShoulderElbowDistance` JSDoc → "WHAT THIS METRIC DETECTS —
  // narrowed scope" for the rationale.
  //
  // Elbow-drop compensation IS partially caught by `elbowFlexion` (the
  // upper-arm/forearm geometry shifts when the elbow drops); that's the
  // intended cross-signal coverage in v1.
  const lms = makeLandmarks({
    leftShoulder:  { x: 0.62, y: 0.30 },
    rightShoulder: { x: 0.38, y: 0.30 },
    leftElbow:     { x: 0.62, y: 0.45 },
    rightElbow:    { x: 0.38, y: 0.45 },
    leftHip:       { x: 0.58, y: 0.55 },
    rightHip:      { x: 0.42, y: 0.55 },
  });
  // Numerical confirmation: ratio = 0.6 (> baseline 0.5, > threshold 0.4).
  // The warning would NOT fire for this pose despite the elbow being
  // visibly off the wall in y — that's the documented limitation.
  assertCloseTo(computeShoulderElbowDistance(lms, TILT_REF, "left"), 0.6, 0.02, "elbow-drop LEFT");
});

test("Severe foreshortening (elbow 'collapsed' close to shoulder in 2D) → ratio drops well below 0.4", () => {
  // Simulates significant elbow-off-wall: in 2D projection, the elbow is
  // much closer to the shoulder than at-wall baseline. (In a real 3D
  // capture this would correspond to the upper-arm rotating ~45–60° toward
  // the camera.)
  const lms = makeLandmarks({
    leftShoulder:  { x: 0.62, y: 0.30 },
    rightShoulder: { x: 0.38, y: 0.30 },
    leftElbow:     { x: 0.66, y: 0.32 },  // very close to shoulder
    rightElbow:    { x: 0.34, y: 0.32 },
    leftHip:       { x: 0.58, y: 0.55 },
    rightHip:      { x: 0.42, y: 0.55 },
  });
  // Distance LEFT: sqrt(0.04^2 + 0.02^2) ≈ 0.045. Ratio ≈ 0.045/0.25 = 0.18.
  assertLessThan(computeShoulderElbowDistance(lms, TILT_REF, "left"),  0.4, "LEFT severe foreshorten");
  assertLessThan(computeShoulderElbowDistance(lms, TILT_REF, "right"), 0.4, "RIGHT severe foreshorten");
});

test("Scale invariance: 2× scaled pose → same ratio", () => {
  // Same proportional pose, doubled scale (shoulders wider apart, hips
  // lower). Result must be identical because trunk-length normalization
  // cancels the scale.
  const lms = makeLandmarks({
    leftShoulder:  { x: 0.74, y: 0.20 },
    rightShoulder: { x: 0.26, y: 0.20 },
    leftElbow:     { x: 0.99, y: 0.20 },  // upper-arm length 0.25
    rightElbow:    { x: 0.01, y: 0.20 },
    leftHip:       { x: 0.66, y: 0.70 },
    rightHip:      { x: 0.34, y: 0.70 },
  });
  // Trunk len 0.50. Upper-arm 0.25. Ratio 0.5. Same as the W-position test
  // above despite all linear dimensions doubling.
  assertCloseTo(computeShoulderElbowDistance(lms, TILT_REF, "left"),  0.5, 0.02, "LEFT 2x scale");
  assertCloseTo(computeShoulderElbowDistance(lms, TILT_REF, "right"), 0.5, 0.02, "RIGHT 2x scale");
});

test("Hip degeneracy (trunk-mid points coincide) → null", () => {
  const lms = makeLandmarks({
    leftShoulder:  { x: 0.62, y: 0.50 },
    rightShoulder: { x: 0.38, y: 0.50 },
    leftElbow:     { x: 0.745, y: 0.50 },
    rightElbow:    { x: 0.255, y: 0.50 },
    leftHip:       { x: 0.58, y: 0.51 },  // trunk len ~0.01 < epsilon 0.05
    rightHip:      { x: 0.42, y: 0.51 },
  });
  assertNull(computeShoulderElbowDistance(lms, TILT_REF, "left"),  "trunk too short");
});

test("Missing elbow → null on that side; other side still computes", () => {
  const lms = makeLandmarks({
    leftShoulder:  { x: 0.62, y: 0.30 },
    rightShoulder: { x: 0.38, y: 0.30 },
    leftElbow:     { x: 0.745, y: 0.30, visibility: 0.1 },  // below MIN_VIS
    rightElbow:    { x: 0.255, y: 0.30 },
    leftHip:       { x: 0.58, y: 0.55 },
    rightHip:      { x: 0.42, y: 0.55 },
  });
  assertNull(computeShoulderElbowDistance(lms, TILT_REF, "left"),  "LEFT low-vis elbow");
  assertCloseTo(computeShoulderElbowDistance(lms, TILT_REF, "right"), 0.5, 0.02, "RIGHT unaffected");
});

test("Missing one hip → null on BOTH sides (shared trunk reference)", () => {
  const lms = makeLandmarks({
    leftShoulder:  { x: 0.62, y: 0.30 },
    rightShoulder: { x: 0.38, y: 0.30 },
    leftElbow:     { x: 0.745, y: 0.30 },
    rightElbow:    { x: 0.255, y: 0.30 },
    leftHip:       { x: 0.58, y: 0.55, visibility: 0.1 },  // below MIN_VIS
    rightHip:      { x: 0.42, y: 0.55 },
  });
  assertNull(computeShoulderElbowDistance(lms, TILT_REF, "left"),  "LEFT lost trunk");
  assertNull(computeShoulderElbowDistance(lms, TILT_REF, "right"), "RIGHT lost trunk");
});

// ─────────────────────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n  ${testsPassed} passed, ${testsFailed} failed\n`);
process.exit(testsFailed === 0 ? 0 : 1);
