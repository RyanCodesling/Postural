/**
 * shoulderFlexion.test.ts
 *
 * Synthetic-landmark tests for `computeShoulderFlexion`.
 *
 * USAGE
 * ─────
 *   npx tsx web/src/lib/pose/shoulderFlexion.test.ts
 *
 * computeShoulderFlexion delegates to computeShoulderAbduction (see the
 * JSDoc on the function for rationale). This file does NOT re-prove every
 * abduction property — those live in shoulderAbduction.test.ts and would be
 * redundant here. It DOES exercise:
 *
 *   1. Smoke tests that confirm the delegation is wired correctly
 *      (rest = 0°, horizontal = 90°, missing landmark = null).
 *   2. The overhead range (150°+), which abduction tests don't cover because
 *      ex_001's clinical target is 90°. ex_002 targets 150°, and a clean rep
 *      can hit ~180°, so the function needs to behave through that range
 *      without sign flips or wraparounds.
 *   3. Cross-body null behavior at overhead height (the bogus trajectory the
 *      patient is most likely to produce when they hike one arm up across
 *      the body instead of straight up).
 *
 * Coordinate note: same as shoulderAbduction.test.ts — patient's LEFT is
 * image-RIGHT (larger x), MediaPipe subject-perspective labelling.
 */

import { computeShoulderFlexion } from "./poseMetrics";
import type { TiltReference } from "./poseMetrics";

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
  if (actual === null) throw new Error(`${label}: expected ~${expected}, got null`);
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label}: expected ~${expected} (±${tolerance}), got ${actual}`);
  }
}

function assertNull<T>(actual: T | null, label: string): void {
  if (actual !== null) throw new Error(`${label}: expected null, got ${JSON.stringify(actual)}`);
}

const TILT_REF: TiltReference = {
  cameraTiltDeg: 0,
  confidence: "high",
  divergenceDeg: 0,
};

function makeLandmarks(opts: {
  leftShoulder?:  { x: number; y: number; visibility?: number };
  rightShoulder?: { x: number; y: number; visibility?: number };
  leftElbow?:     { x: number; y: number; visibility?: number };
  rightElbow?:    { x: number; y: number; visibility?: number };
  leftHip?:       { x: number; y: number; visibility?: number };
  rightHip?:      { x: number; y: number; visibility?: number };
}): Array<{ x: number; y: number; visibility?: number }> {
  const lms: Array<{ x: number; y: number; visibility?: number }> = [];
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

function neutralPose() {
  return makeLandmarks({
    leftShoulder:  { x: 0.60, y: 0.30 },
    rightShoulder: { x: 0.40, y: 0.30 },
    leftHip:       { x: 0.58, y: 0.55 },
    rightHip:      { x: 0.42, y: 0.55 },
    leftElbow:     { x: 0.60, y: 0.45 },
    rightElbow:    { x: 0.40, y: 0.45 },
  });
}

console.log("\ncomputeShoulderFlexion — synthetic data tests\n");

// ── DELEGATION SMOKE TESTS ──────────────────────────────────────────────────

test("rest → ~0° on both sides (delegation wired correctly)", () => {
  const lms = neutralPose();
  assertCloseTo(computeShoulderFlexion(lms, TILT_REF, "left"),  0, 1, "left rest");
  assertCloseTo(computeShoulderFlexion(lms, TILT_REF, "right"), 0, 1, "right rest");
});

test("LEFT arm horizontal → ~90° (matches abduction at clinical floor of ex_002 rep)", () => {
  const lms = neutralPose();
  lms[13] = { x: 0.75, y: 0.30, visibility: 1 };
  assertCloseTo(computeShoulderFlexion(lms, TILT_REF, "left"), 90, 2, "left at 90°");
});

test("RIGHT arm horizontal → ~90°", () => {
  const lms = neutralPose();
  lms[14] = { x: 0.25, y: 0.30, visibility: 1 };
  assertCloseTo(computeShoulderFlexion(lms, TILT_REF, "right"), 90, 2, "right at 90°");
});

// ── OVERHEAD RANGE (the reason this test file exists) ───────────────────────

test("LEFT arm overhead-lateral at ~150° → ~150° (ex_002 targetROM)", () => {
  // Elbow 150° rotated from trunk-down on the LATERAL side. For LEFT (LM11 on
  // image-right), lateral means larger x. Geometry: arm vector at -60° in
  // atan2 space — that's 60° above horizontal, on the patient's left side.
  // Place elbow 0.15 from shoulder at that angle: (0.60 + 0.15·cos(-60°),
  // 0.30 + 0.15·sin(-60°)) = (0.675, 0.170).
  const lms = neutralPose();
  lms[13] = { x: 0.675, y: 0.170, visibility: 1 };
  assertCloseTo(computeShoulderFlexion(lms, TILT_REF, "left"), 150, 2, "left at 150°");
});

test("RIGHT arm overhead-lateral at ~150° → ~150°", () => {
  // Mirror geometry on the RIGHT side. Lateral for RIGHT = image-left
  // (smaller x). Arm vector at atan2 angle -120°: (cos(-120°), sin(-120°)) =
  // (-0.5, -0.866). Elbow at (0.40 + 0.15·-0.5, 0.30 + 0.15·-0.866) =
  // (0.325, 0.170).
  const lms = neutralPose();
  lms[14] = { x: 0.325, y: 0.170, visibility: 1 };
  assertCloseTo(computeShoulderFlexion(lms, TILT_REF, "right"), 150, 2, "right at 150°");
});

test("LEFT arm straight overhead (elbow directly above shoulder) → ~180°", () => {
  // Arm pointing straight UP. Elbow at same x as shoulder, y smaller (higher).
  // armAngle = atan2(-0.15, 0) = -90°. trunkDown = +90°. signed = -180°.
  // For LEFT, flip → +180°. Function returns 180.
  const lms = neutralPose();
  lms[13] = { x: 0.60, y: 0.15, visibility: 1 };
  assertCloseTo(computeShoulderFlexion(lms, TILT_REF, "left"), 180, 2, "left at 180°");
});

test("RIGHT arm straight overhead → ~180°", () => {
  const lms = neutralPose();
  lms[14] = { x: 0.40, y: 0.15, visibility: 1 };
  assertCloseTo(computeShoulderFlexion(lms, TILT_REF, "right"), 180, 2, "right at 180°");
});

test("continuous 90° → 150° → 180° on LEFT side reads monotonically", () => {
  // Three consecutive poses along a clean overhead-raise trajectory. Asserts
  // there's no sign flip or wraparound discontinuity in the overhead region
  // — this is what would break rep counting at the peak of an ex_002 rep.
  const lms = neutralPose();

  lms[13] = { x: 0.75, y: 0.30, visibility: 1 };
  const at90  = computeShoulderFlexion(lms, TILT_REF, "left")!;

  lms[13] = { x: 0.675, y: 0.170, visibility: 1 };
  const at150 = computeShoulderFlexion(lms, TILT_REF, "left")!;

  lms[13] = { x: 0.60, y: 0.15, visibility: 1 };
  const at180 = computeShoulderFlexion(lms, TILT_REF, "left")!;

  if (!(at90 < at150 && at150 < at180)) {
    throw new Error(`expected monotone increase 90→150→180, got ${at90}, ${at150}, ${at180}`);
  }
});

// ── CROSS-BODY AT OVERHEAD HEIGHT (continuity-gate dependency) ──────────────

test("LEFT arm raised on the WRONG side of the trunk (cross-body overhead) → null", () => {
  // Patient's left arm swung up and across the body so the elbow ends up
  // above and on the RIGHT side of the trunk axis. This is the bogus
  // trajectory the rep-counter continuity gate relies on rejecting via the
  // null return.
  const lms = neutralPose();
  lms[13] = { x: 0.45, y: 0.18, visibility: 1 };
  assertNull(computeShoulderFlexion(lms, TILT_REF, "left"), "left overhead cross-body");
});

test("RIGHT arm cross-body overhead → null", () => {
  const lms = neutralPose();
  lms[14] = { x: 0.55, y: 0.18, visibility: 1 };
  assertNull(computeShoulderFlexion(lms, TILT_REF, "right"), "right overhead cross-body");
});

// ── VISIBILITY GATING (delegation inherits) ─────────────────────────────────

test("missing elbow on one side → null on that side, other side still computable", () => {
  const lms = neutralPose();
  lms[13] = { x: 0.60, y: 0.45, visibility: 0.2 }; // below MIN_VIS
  assertNull(computeShoulderFlexion(lms, TILT_REF, "left"), "left null with low-vis elbow");
  assertCloseTo(computeShoulderFlexion(lms, TILT_REF, "right"), 0, 1, "right still ok");
});

console.log(`\n  ${testsPassed} passed, ${testsFailed} failed\n`);
process.exit(testsFailed > 0 ? 1 : 0);
