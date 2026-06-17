/**
 * elbowFlexion.test.ts
 *
 * Synthetic-landmark tests for `computeElbowFlexion`.
 *
 * USAGE
 * ─────
 *   npx tsx web/src/lib/pose/elbowFlexion.test.ts
 *
 * Same minimal-deps style as `shoulderAbduction.test.ts` — no test framework,
 * just inline assertion helpers. These tests construct landmark dictionaries
 * by hand to exercise the geometry under known arm poses.
 *
 * ── CONVENTION REMINDER ──────────────────────────────────────────────────────
 * `computeElbowFlexion` uses the INTERIOR-ANGLE convention:
 *   arm straight (extended)         → 180°
 *   elbow at right angle (90° bent) → 90°
 *   fully flexed (hand near shoulder) → ~30°
 *
 * NOT the anatomical "flexion angle" (0° = straight). See the function's
 * JSDoc for why.
 *
 * ── COORDINATE NOTE ──────────────────────────────────────────────────────────
 * MediaPipe normalized coordinates: x ∈ [0,1], y ∈ [0,1], y INCREASES
 * downward. Patient-perspective "left" is image-right (larger x), per
 * MediaPipe's subject-perspective labelling convention.
 *
 *     y=0.30   left shldr ────── right shldr     (image-top)
 *              │                  │
 *     y=0.45   left elbow         right elbow
 *              │                  │
 *     y=0.60   left wrist ─────── right wrist    (arms-at-sides default)
 */

import { computeElbowFlexion } from "./poseMetrics";
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

type LM = { x: number; y: number; visibility?: number };

function makeLandmarks(opts: {
  leftShoulder?:  LM;
  rightShoulder?: LM;
  leftElbow?:     LM;
  rightElbow?:    LM;
  leftWrist?:     LM;
  rightWrist?:    LM;
}): LM[] {
  const lms: LM[] = [];
  for (let i = 0; i <= 24; i++) lms.push({ x: 0, y: 0, visibility: 0 });
  const v = (p?: LM) =>
    p ? { ...p, visibility: p.visibility ?? 1 } : { x: 0, y: 0, visibility: 0 };
  lms[11] = v(opts.leftShoulder);
  lms[12] = v(opts.rightShoulder);
  lms[13] = v(opts.leftElbow);
  lms[14] = v(opts.rightElbow);
  lms[15] = v(opts.leftWrist);
  lms[16] = v(opts.rightWrist);
  return lms;
}

/**
 * Rotate a point (x,y) around center (cx,cy) by `deg` degrees in the
 * (image-y-down) coordinate system used by MediaPipe. Used for testing
 * camera-roll invariance.
 */
function rotate(p: LM, cx: number, cy: number, deg: number): LM {
  const rad = (deg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const dx = p.x - cx;
  const dy = p.y - cy;
  return {
    x: cx + dx * c - dy * s,
    y: cy + dx * s + dy * c,
    visibility: p.visibility,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────────────────────────────

console.log("\ncomputeElbowFlexion — synthetic data tests\n");

test("LEFT arm straight at side → ~180° (extended)", () => {
  const lms = makeLandmarks({
    leftShoulder: { x: 0.62, y: 0.30 },
    leftElbow:    { x: 0.62, y: 0.45 },
    leftWrist:    { x: 0.62, y: 0.60 },
  });
  const result = computeElbowFlexion(lms, TILT_REF, "left");
  assertCloseTo(result, 180, 1, "LEFT straight");
});

test("RIGHT arm straight at side → ~180° (extended)", () => {
  const lms = makeLandmarks({
    rightShoulder: { x: 0.38, y: 0.30 },
    rightElbow:    { x: 0.38, y: 0.45 },
    rightWrist:    { x: 0.38, y: 0.60 },
  });
  const result = computeElbowFlexion(lms, TILT_REF, "right");
  assertCloseTo(result, 180, 1, "RIGHT straight");
});

test("LEFT elbow at 90° (forearm horizontal, pointing toward body midline) → ~90°", () => {
  // Upper arm straight down (-90° direction); forearm pointing horizontally
  // toward image-left (180° direction). Interior angle = 90°.
  const lms = makeLandmarks({
    leftShoulder: { x: 0.62, y: 0.30 },
    leftElbow:    { x: 0.62, y: 0.45 },
    leftWrist:    { x: 0.50, y: 0.45 },
  });
  const result = computeElbowFlexion(lms, TILT_REF, "left");
  assertCloseTo(result, 90, 1, "LEFT 90° flexion");
});

test("RIGHT elbow at 90° → ~90°", () => {
  const lms = makeLandmarks({
    rightShoulder: { x: 0.38, y: 0.30 },
    rightElbow:    { x: 0.38, y: 0.45 },
    rightWrist:    { x: 0.50, y: 0.45 },
  });
  const result = computeElbowFlexion(lms, TILT_REF, "right");
  assertCloseTo(result, 90, 1, "RIGHT 90° flexion");
});

test("LEFT full flexion (forearm 30° from anti-parallel to upper-arm) → ~30°", () => {
  // Upper arm points UP (-90°); forearm rotated 30° clockwise from
  // anti-parallel (anti-parallel = +90° in image-down coords, so
  // 30° rotation = +90° - 30° = +60° from horizontal, i.e., UP and
  // slightly outward). For LEFT side (image-right), "outward" = +x.
  // wrist relative to elbow at angle -60° (cos(-60°)=0.5, sin(-60°)=-0.866).
  // forearm length 0.15 → wrist offset (0.075, -0.13).
  const lms = makeLandmarks({
    leftShoulder: { x: 0.62, y: 0.30 },
    leftElbow:    { x: 0.62, y: 0.45 },
    leftWrist:    { x: 0.695, y: 0.32 },
  });
  const result = computeElbowFlexion(lms, TILT_REF, "left");
  assertCloseTo(result, 30, 2, "LEFT 30° flexion");
});

test("Sign-invariance: LEFT and RIGHT at 90° both return ~90°", () => {
  // Both arms simultaneously at 90° flexion. Forearms point inward (toward
  // body midline). This test pins the "no sign flip across sides" invariant.
  const lms = makeLandmarks({
    leftShoulder:  { x: 0.62, y: 0.30 },
    leftElbow:     { x: 0.62, y: 0.45 },
    leftWrist:     { x: 0.50, y: 0.45 },
    rightShoulder: { x: 0.38, y: 0.30 },
    rightElbow:    { x: 0.38, y: 0.45 },
    rightWrist:    { x: 0.50, y: 0.45 },
  });
  const left  = computeElbowFlexion(lms, TILT_REF, "left");
  const right = computeElbowFlexion(lms, TILT_REF, "right");
  assertCloseTo(left,  90, 1, "LEFT in bilateral 90°");
  assertCloseTo(right, 90, 1, "RIGHT in bilateral 90°");
});

test("Camera-roll invariance: 10° rotation of landmarks does not change flexion", () => {
  // Straight arm baseline:
  const straight: Record<string, LM> = {
    shoulder: { x: 0.62, y: 0.30 },
    elbow:    { x: 0.62, y: 0.45 },
    wrist:    { x: 0.62, y: 0.60 },
  };
  // Rotate every landmark by +10° around image center (0.5, 0.5):
  const rotatedShoulder = rotate(straight.shoulder, 0.5, 0.5, 10);
  const rotatedElbow    = rotate(straight.elbow,    0.5, 0.5, 10);
  const rotatedWrist    = rotate(straight.wrist,    0.5, 0.5, 10);
  const lms = makeLandmarks({
    leftShoulder: rotatedShoulder,
    leftElbow:    rotatedElbow,
    leftWrist:    rotatedWrist,
  });
  // tiltRef.cameraTiltDeg deliberately set to 10° to simulate a tilted camera,
  // but computeElbowFlexion ignores tiltRef — the rotation invariance must
  // come from the geometry itself, not from tilt subtraction.
  const tiltedRef: TiltReference = { cameraTiltDeg: 10, confidence: "high", divergenceDeg: 0 };
  const result = computeElbowFlexion(lms, tiltedRef, "left");
  assertCloseTo(result, 180, 1, "rotated straight arm");
});

test("±180° boundary: straight arm returns exactly 180° (not -180° or 0°)", () => {
  // Regression guard: angleDiffDeg's wrap-loop uses strict `< -180`, so a
  // result of exactly -180° stays -180° instead of folding to +180°. Math.abs
  // handles both signs naturally — both map to 180. This test pins that.
  const lms = makeLandmarks({
    leftShoulder: { x: 0.50, y: 0.20 },
    leftElbow:    { x: 0.50, y: 0.50 },
    leftWrist:    { x: 0.50, y: 0.80 },
  });
  const result = computeElbowFlexion(lms, TILT_REF, "left");
  assertCloseTo(result, 180, 0.5, "exact-anti-parallel boundary");
});

test("Missing wrist → null on that side; other side still computes", () => {
  const lms = makeLandmarks({
    leftShoulder:  { x: 0.62, y: 0.30 },
    leftElbow:     { x: 0.62, y: 0.45 },
    leftWrist:     { x: 0.62, y: 0.60, visibility: 0.1 },  // below MIN_VIS=0.5
    rightShoulder: { x: 0.38, y: 0.30 },
    rightElbow:    { x: 0.38, y: 0.45 },
    rightWrist:    { x: 0.38, y: 0.60 },
  });
  assertNull(computeElbowFlexion(lms, TILT_REF, "left"),  "left with low-vis wrist");
  assertCloseTo(computeElbowFlexion(lms, TILT_REF, "right"), 180, 1, "right unaffected");
});

test("Off-frame wrist with good visibility → null", () => {
  const lms = makeLandmarks({
    leftShoulder: { x: 0.62, y: 0.30 },
    leftElbow:    { x: 0.62, y: 0.45 },
    leftWrist:    { x: 0.62, y: -0.05, visibility: 1 }, // extrapolated above frame
  });
  assertNull(computeElbowFlexion(lms, TILT_REF, "left"), "left with off-frame wrist");
});

test("Missing elbow → null on that side", () => {
  const lms = makeLandmarks({
    leftShoulder: { x: 0.62, y: 0.30 },
    leftElbow:    { x: 0.62, y: 0.45, visibility: 0 },  // below MIN_VIS
    leftWrist:    { x: 0.62, y: 0.60 },
  });
  assertNull(computeElbowFlexion(lms, TILT_REF, "left"), "left with missing elbow");
});

test("Off-frame elbow with good visibility → null", () => {
  const lms = makeLandmarks({
    leftShoulder: { x: 0.62, y: 0.30 },
    leftElbow:    { x: 1.05, y: 0.45, visibility: 1 }, // extrapolated outside frame
    leftWrist:    { x: 0.62, y: 0.60 },
  });
  assertNull(computeElbowFlexion(lms, TILT_REF, "left"), "left with off-frame elbow");
});

// ─────────────────────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n  ${testsPassed} passed, ${testsFailed} failed\n`);
process.exit(testsFailed === 0 ? 0 : 1);
