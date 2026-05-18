/**
 * shoulderAbduction.test.ts
 *
 * Synthetic-landmark tests for `computeShoulderAbduction`.
 *
 * USAGE
 * ─────
 *   npx tsx web/src/lib/pose/shoulderAbduction.test.ts
 *
 * Same minimal-deps style as `repCounter.test.ts` — no test framework, just
 * a tiny inline assertion helper. These tests construct landmark dictionaries
 * by hand to exercise the geometry under known body poses.
 *
 * ── COORDINATE NOTE ──────────────────────────────────────────────────────────
 * MediaPipe normalized coordinates: x in [0,1], y in [0,1], y INCREASES
 * downward. We pick coordinates that look like a person facing the camera:
 *
 *     y=0.20   left ear ──── right ear        (top of frame)
 *     y=0.30   left shldr ── right shldr
 *              │              │
 *              │              │
 *     y=0.55   left hip ───── right hip       (bottom-ish)
 *
 * Patient-perspective "left" is image-right (larger x), per MediaPipe's
 * subject-perspective labelling convention.
 */

import { computeShoulderAbduction } from "./poseMetrics";
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

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const TILT_REF: TiltReference = {
  cameraTiltDeg: 0,
  confidence: "high",
  divergenceDeg: 0,
};

/** Build a sparse landmark array with only the indices the metric reads. */
function makeLandmarks(opts: {
  leftShoulder?:  { x: number; y: number; visibility?: number };
  rightShoulder?: { x: number; y: number; visibility?: number };
  leftElbow?:     { x: number; y: number; visibility?: number };
  rightElbow?:    { x: number; y: number; visibility?: number };
  leftHip?:       { x: number; y: number; visibility?: number };
  rightHip?:      { x: number; y: number; visibility?: number };
}): Array<{ x: number; y: number; visibility?: number }> {
  const lms: Array<{ x: number; y: number; visibility?: number }> = [];
  // Pad up to index 24 with placeholder zero-vis landmarks so indexing
  // doesn't return undefined for unused slots.
  for (let i = 0; i <= 24; i++) lms.push({ x: 0, y: 0, visibility: 0 });
  const v = (p?: { x: number; y: number; visibility?: number }) =>
    p ? { ...p, visibility: p.visibility ?? 1 } : { x: 0, y: 0, visibility: 0 };
  lms[11] = v(opts.leftShoulder);
  lms[12] = v(opts.rightShoulder);
  lms[13] = v(opts.leftElbow);
  lms[14] = v(opts.rightElbow);
  lms[23] = v(opts.leftHip);
  lms[24] = v(opts.rightHip);
  return lms;
}

/**
 * Build a "neutral standing" pose with arms hanging at sides.
 * Patient-perspective LEFT is image-right (larger x), per MediaPipe convention.
 */
function neutralPose() {
  return makeLandmarks({
    leftShoulder:  { x: 0.60, y: 0.30 },
    rightShoulder: { x: 0.40, y: 0.30 },
    leftHip:       { x: 0.58, y: 0.55 },
    rightHip:      { x: 0.42, y: 0.55 },
    // Arms hanging straight down: elbow directly below shoulder.
    leftElbow:     { x: 0.60, y: 0.45 },
    rightElbow:    { x: 0.40, y: 0.45 },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────────────────────────────

console.log("\ncomputeShoulderAbduction — synthetic data tests\n");

// ── REST POSITION ────────────────────────────────────────────────────────────

test("arms hanging at sides → abduction near 0° on both sides", () => {
  const lms = neutralPose();
  const left  = computeShoulderAbduction(lms, TILT_REF, "left");
  const right = computeShoulderAbduction(lms, TILT_REF, "right");
  assertCloseTo(left,  0, 1, "left abduction at rest");
  assertCloseTo(right, 0, 1, "right abduction at rest");
});

// ── HORIZONTAL ARM (90°) ─────────────────────────────────────────────────────

test("LEFT arm raised horizontally → ~90° on left, unchanged right", () => {
  const lms = neutralPose();
  // Patient's left arm horizontal: elbow at the same y as shoulder, x further
  // out to the patient's left (image-right, larger x).
  lms[13] = { x: 0.75, y: 0.30, visibility: 1 };
  const left  = computeShoulderAbduction(lms, TILT_REF, "left");
  const right = computeShoulderAbduction(lms, TILT_REF, "right");
  assertCloseTo(left,  90, 2, "left abduction at horizontal");
  assertCloseTo(right, 0,  1, "right unaffected by left arm motion");
});

test("RIGHT arm raised horizontally → ~90° on right, unchanged left", () => {
  const lms = neutralPose();
  // Patient's right arm horizontal: elbow same y as shoulder, x further out
  // to the patient's right (image-left, smaller x).
  lms[14] = { x: 0.25, y: 0.30, visibility: 1 };
  const left  = computeShoulderAbduction(lms, TILT_REF, "left");
  const right = computeShoulderAbduction(lms, TILT_REF, "right");
  assertCloseTo(left,  0,  1, "left unaffected by right arm motion");
  assertCloseTo(right, 90, 2, "right abduction at horizontal");
});

// ── PARTIAL RAISES ───────────────────────────────────────────────────────────

test("LEFT arm at 45° abduction → ~45°", () => {
  const lms = neutralPose();
  // Elbow positioned at 45° from straight-down, on the patient's left side.
  // At 45°: dx and dy from shoulder are equal in magnitude. Going 0.10 to the
  // left side and 0.10 down from shoulder (0.60, 0.30) puts elbow at (0.70, 0.40).
  lms[13] = { x: 0.70, y: 0.40, visibility: 1 };
  const left = computeShoulderAbduction(lms, TILT_REF, "left");
  assertCloseTo(left, 45, 2, "left abduction at 45°");
});

test("LEFT arm slightly abducted (~20°) → just above start threshold", () => {
  const lms = neutralPose();
  // Elbow 20° out from vertical: dx = 0.10*sin20° ≈ 0.034, dy = 0.10*cos20° ≈ 0.094
  // From shoulder (0.60, 0.30): elbow at (0.634, 0.394).
  lms[13] = { x: 0.634, y: 0.394, visibility: 1 };
  const left = computeShoulderAbduction(lms, TILT_REF, "left");
  assertCloseTo(left, 20, 2, "left abduction at 20°");
});

// ── CROSS-BODY ADDUCTION (must NOT count as abduction) ──────────────────────
//
// Regression for a bug where moving the arm INWARD across the torso registered
// the same magnitude as outward lateral abduction. With the old `Math.abs` on
// the signed angle, a patient swinging the arm from the side → across the
// chest → up past the head → back down would trip a full rep. The rep state
// machine needs cross-body motion to read as ~0° so it can't cross
// startThreshold.

test("LEFT arm crossed horizontally INWARD (cross-body) → null, not 90°", () => {
  const lms = neutralPose();
  // Patient's left arm swung ACROSS the body to the patient's right side:
  // elbow ends at same y as shoulder but on image-LEFT (smaller x) — the
  // opposite side of the trunk from where lateral abduction would place it.
  lms[13] = { x: 0.45, y: 0.30, visibility: 1 };
  const left = computeShoulderAbduction(lms, TILT_REF, "left");
  assertNull(left, "left cross-body horizontal must not register as abduction");
});

test("RIGHT arm crossed horizontally INWARD (cross-body) → null, not 90°", () => {
  const lms = neutralPose();
  // Mirror of the previous case: patient's right arm crossed to image-RIGHT.
  lms[14] = { x: 0.55, y: 0.30, visibility: 1 };
  const right = computeShoulderAbduction(lms, TILT_REF, "right");
  assertNull(right, "right cross-body horizontal must not register as abduction");
});

test("LEFT arm 45° cross-body (mid-trajectory) → null", () => {
  const lms = neutralPose();
  // 45° inward from vertical on the wrong side of the trunk: dx negative.
  lms[13] = { x: 0.50, y: 0.40, visibility: 1 };
  const left = computeShoulderAbduction(lms, TILT_REF, "left");
  assertNull(left, "left 45° cross-body must not register as abduction");
});

test("RIGHT arm 45° cross-body (mid-trajectory) → null", () => {
  const lms = neutralPose();
  lms[14] = { x: 0.50, y: 0.40, visibility: 1 };
  const right = computeShoulderAbduction(lms, TILT_REF, "right");
  assertNull(right, "right 45° cross-body must not register as abduction");
});

test("LEFT arm cross-body past head → null (full bogus-rep trajectory peak)", () => {
  const lms = neutralPose();
  // Elbow swung up and across to ABOVE the head on the opposite side of trunk.
  // Without the fix, the magnitude here is well past minimumPeakThreshold (60°)
  // and the descent back through the side would close out a false rep.
  lms[13] = { x: 0.45, y: 0.15, visibility: 1 };
  const left = computeShoulderAbduction(lms, TILT_REF, "left");
  // Cross-body past head: arm vector still on the wrong side of the trunk axis,
  // so the signed angle stays on the wrong side — function returns null.
  assertNull(left, "left arm-over-head via cross-body must not register");
});

// ── CAMERA ROLL INVARIANCE ───────────────────────────────────────────────────

test("camera-roll invariance: rotating all landmarks by 10° doesn't change result", () => {
  // Take the neutral pose with left arm at 45° and rotate every landmark
  // around the image center (0.5, 0.5) by 10°. Abduction should be unchanged
  // because both reference vectors rotate together.
  const lms = neutralPose();
  lms[13] = { x: 0.70, y: 0.40, visibility: 1 };

  const beforeLeft = computeShoulderAbduction(lms, TILT_REF, "left")!;

  const theta = (10 * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const rotate = (p: { x: number; y: number; visibility?: number }) => ({
    x: 0.5 + (p.x - 0.5) * cos - (p.y - 0.5) * sin,
    y: 0.5 + (p.x - 0.5) * sin + (p.y - 0.5) * cos,
    visibility: p.visibility,
  });

  const rotatedLms = lms.map((p) => (p.visibility ?? 0) > 0 ? rotate(p) : p);

  // Tilt ref still says cameraTiltDeg=0, deliberately — we want to prove that
  // even WITHOUT tilt correction, this metric is roll-invariant. (That's the
  // whole reason the function ignores tiltRef.)
  const afterLeft = computeShoulderAbduction(rotatedLms, TILT_REF, "left")!;

  assertCloseTo(afterLeft, beforeLeft, 0.5, "abduction unchanged under camera roll");
});

// ── VISIBILITY GATING ────────────────────────────────────────────────────────

test("missing left elbow → null for left side, right still reports", () => {
  const lms = neutralPose();
  lms[13] = { x: 0.60, y: 0.45, visibility: 0.2 }; // below MIN_VIS=0.5
  const left  = computeShoulderAbduction(lms, TILT_REF, "left");
  const right = computeShoulderAbduction(lms, TILT_REF, "right");
  assertNull(left, "left abduction with low-vis elbow");
  assertCloseTo(right, 0, 1, "right still computable");
});

test("missing one hip → null for both sides (trunk reference is shared)", () => {
  const lms = neutralPose();
  lms[24] = { x: 0.42, y: 0.55, visibility: 0.2 };
  const left  = computeShoulderAbduction(lms, TILT_REF, "left");
  const right = computeShoulderAbduction(lms, TILT_REF, "right");
  assertNull(left,  "left null when hip missing");
  assertNull(right, "right null when hip missing");
});

test("missing one shoulder → null for both sides (shoulder midpoint shared)", () => {
  const lms = neutralPose();
  lms[12] = { x: 0.40, y: 0.30, visibility: 0.2 };
  const left  = computeShoulderAbduction(lms, TILT_REF, "left");
  const right = computeShoulderAbduction(lms, TILT_REF, "right");
  assertNull(left,  "left null when other shoulder missing");
  assertNull(right, "right null when own shoulder missing");
});

// ─────────────────────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n  ${testsPassed} passed, ${testsFailed} failed\n`);
process.exit(testsFailed > 0 ? 1 : 0);