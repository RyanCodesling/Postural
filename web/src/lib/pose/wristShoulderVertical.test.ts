/**
 * wristShoulderVertical.test.ts
 *
 * Synthetic-landmark tests for `computeWristShoulderVertical` — primary
 * metric for ex_007 Overhead Shoulder Press.
 *
 * USAGE
 * ─────
 *   npx tsx web/src/lib/pose/wristShoulderVertical.test.ts
 *
 * ── KEY INVARIANT THIS FILE PINS ─────────────────────────────────────────────
 * **Arms-at-sides returns a NEGATIVE value, not null.** This is unlike
 * `computeShoulderAbduction` which returns null during cross-body motion
 * (continuity-gate behavior for rep counting). For wrist-shoulder vertical,
 * negative is the LEGAL rest position — wrist below shoulder. The
 * RepCounter's `startThreshold` filter handles "below threshold" naturally.
 * A null-clamp on negatives would break rep counting for this metric.
 *
 * ── COORDINATE NOTE ──────────────────────────────────────────────────────────
 * MediaPipe normalized coordinates: x ∈ [0,1], y ∈ [0,1], y INCREASES downward.
 * Patient-perspective "left" is image-right (larger x).
 *
 *     y=0.05   wrists overhead (peak position)
 *     y=0.30   shoulders                      (reference level)
 *     y=0.55   hips                            (trunk-length denominator)
 *     y=0.60   wrists at rest (arms hanging)
 */

import { computeWristShoulderVertical } from "./poseMetrics";
import type { TiltReference } from "./poseMetrics";
import { RepCounter, type RepEvent } from "./repCounter";
import { EXERCISE_REGISTRY } from "../exercises/registry";

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

function assertNegative(actual: number | null, label: string): void {
  if (actual === null) {
    throw new Error(`${label}: expected negative number, got null`);
  }
  if (actual >= 0) {
    throw new Error(`${label}: expected negative, got ${actual}`);
  }
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
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
  leftWrist?:     LM;
  rightWrist?:    LM;
  leftHip?:       LM;
  rightHip?:      LM;
}): LM[] {
  const lms: LM[] = [];
  for (let i = 0; i <= 24; i++) lms.push({ x: 0, y: 0, visibility: 0 });
  const v = (p?: LM) =>
    p ? { ...p, visibility: p.visibility ?? 1 } : { x: 0, y: 0, visibility: 0 };
  lms[11] = v(opts.leftShoulder);
  lms[12] = v(opts.rightShoulder);
  lms[15] = v(opts.leftWrist);
  lms[16] = v(opts.rightWrist);
  lms[23] = v(opts.leftHip);
  lms[24] = v(opts.rightHip);
  return lms;
}

// ─────────────────────────────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────────────────────────────

console.log("\ncomputeWristShoulderVertical — synthetic data tests\n");

test("Arms at sides → NEGATIVE value (not null) — the critical sign-discipline invariant", () => {
  // wrist below shoulder; numerator (shoulder.y − wrist.y) is negative.
  // This must NOT return null — the rep counter relies on the negative-to-
  // positive transition to detect a rep starting.
  const lms = makeLandmarks({
    leftShoulder:  { x: 0.62, y: 0.30 },
    rightShoulder: { x: 0.38, y: 0.30 },
    leftWrist:     { x: 0.62, y: 0.60 },
    rightWrist:    { x: 0.38, y: 0.60 },
    leftHip:       { x: 0.58, y: 0.55 },
    rightHip:      { x: 0.42, y: 0.55 },
  });
  assertNegative(computeWristShoulderVertical(lms, TILT_REF, "left"),  "LEFT arms-at-sides");
  assertNegative(computeWristShoulderVertical(lms, TILT_REF, "right"), "RIGHT arms-at-sides");
});

test("Arms horizontal (wrist at shoulder level) → ~0", () => {
  const lms = makeLandmarks({
    leftShoulder:  { x: 0.62, y: 0.30 },
    rightShoulder: { x: 0.38, y: 0.30 },
    leftWrist:     { x: 0.85, y: 0.30 },
    rightWrist:    { x: 0.15, y: 0.30 },
    leftHip:       { x: 0.58, y: 0.55 },
    rightHip:      { x: 0.42, y: 0.55 },
  });
  assertCloseTo(computeWristShoulderVertical(lms, TILT_REF, "left"),  0, 0.02, "LEFT horizontal");
  assertCloseTo(computeWristShoulderVertical(lms, TILT_REF, "right"), 0, 0.02, "RIGHT horizontal");
});

test("Arms fully overhead → positive ~1.0+ trunk-length units", () => {
  // wrists well above shoulders. Trunk length here ≈ 0.25 (shoulder y=0.30,
  // hip y=0.55). Wrist y=0.05 → (0.30 − 0.05) / 0.25 = 1.0.
  const lms = makeLandmarks({
    leftShoulder:  { x: 0.62, y: 0.30 },
    rightShoulder: { x: 0.38, y: 0.30 },
    leftWrist:     { x: 0.62, y: 0.05 },
    rightWrist:    { x: 0.38, y: 0.05 },
    leftHip:       { x: 0.58, y: 0.55 },
    rightHip:      { x: 0.42, y: 0.55 },
  });
  assertCloseTo(computeWristShoulderVertical(lms, TILT_REF, "left"),  1.0, 0.1, "LEFT overhead");
  assertCloseTo(computeWristShoulderVertical(lms, TILT_REF, "right"), 1.0, 0.1, "RIGHT overhead");
});

test("Arms partially overhead → positive ~0.5 trunk-length units (ex_007 minPeak band)", () => {
  // wrist halfway between shoulder and overhead. Trunk length 0.25,
  // wrist y = 0.30 − 0.125 = 0.175 → (0.30 − 0.175) / 0.25 = 0.5.
  const lms = makeLandmarks({
    leftShoulder:  { x: 0.62, y: 0.30 },
    rightShoulder: { x: 0.38, y: 0.30 },
    leftWrist:     { x: 0.62, y: 0.175 },
    rightWrist:    { x: 0.38, y: 0.175 },
    leftHip:       { x: 0.58, y: 0.55 },
    rightHip:      { x: 0.42, y: 0.55 },
  });
  assertCloseTo(computeWristShoulderVertical(lms, TILT_REF, "left"),  0.5, 0.05, "LEFT half-overhead");
});

test("Scale invariance: 2× scaled pose → same ratio", () => {
  // Same proportional pose, doubled size. Result must be identical because
  // trunk-length normalization cancels the scale.
  const lms = makeLandmarks({
    leftShoulder:  { x: 0.62, y: 0.20 },
    rightShoulder: { x: 0.38, y: 0.20 },
    leftWrist:     { x: 0.62, y: 0.45 },
    rightWrist:    { x: 0.38, y: 0.45 },
    leftHip:       { x: 0.58, y: 0.70 },
    rightHip:      { x: 0.42, y: 0.70 },
  });
  // shoulder y=0.20, wrist y=0.45 → numerator = -0.25.
  // trunk length = sqrt((0.62-0.42)/... wait, midpoints. shoulder-mid (0.5, 0.20), hip-mid (0.5, 0.70). Trunk len = 0.50.
  // result = -0.25 / 0.50 = -0.5.
  assertCloseTo(computeWristShoulderVertical(lms, TILT_REF, "left"), -0.5, 0.01, "LEFT 2x scale");
});

test("Hip degeneracy (shoulder-mid ≈ hip-mid, below TRUNK_LEN_EPSILON) → null", () => {
  const lms = makeLandmarks({
    leftShoulder:  { x: 0.62, y: 0.50 },
    rightShoulder: { x: 0.38, y: 0.50 },
    leftWrist:     { x: 0.62, y: 0.30 },
    rightWrist:    { x: 0.38, y: 0.30 },
    leftHip:       { x: 0.58, y: 0.51 },  // shoulder-mid (0.5, 0.50), hip-mid (0.5, 0.51) → trunk len ~0.01 < 0.05 epsilon
    rightHip:      { x: 0.42, y: 0.51 },
  });
  assertNull(computeWristShoulderVertical(lms, TILT_REF, "left"),  "trunk too short");
  assertNull(computeWristShoulderVertical(lms, TILT_REF, "right"), "trunk too short");
});

test("Missing wrist → null on that side; other side still computes", () => {
  const lms = makeLandmarks({
    leftShoulder:  { x: 0.62, y: 0.30 },
    rightShoulder: { x: 0.38, y: 0.30 },
    leftWrist:     { x: 0.62, y: 0.05, visibility: 0.1 },  // below MIN_VIS
    rightWrist:    { x: 0.38, y: 0.05 },
    leftHip:       { x: 0.58, y: 0.55 },
    rightHip:      { x: 0.42, y: 0.55 },
  });
  assertNull(computeWristShoulderVertical(lms, TILT_REF, "left"), "LEFT low-vis wrist");
  assertCloseTo(computeWristShoulderVertical(lms, TILT_REF, "right"), 1.0, 0.1, "RIGHT unaffected");
});

test("Off-frame wrist with good visibility → null on that side", () => {
  const lms = makeLandmarks({
    leftShoulder:  { x: 0.62, y: 0.30 },
    rightShoulder: { x: 0.38, y: 0.30 },
    leftWrist:     { x: 0.62, y: -0.05, visibility: 1 }, // extrapolated above frame
    rightWrist:    { x: 0.38, y: 0.05 },
    leftHip:       { x: 0.58, y: 0.55 },
    rightHip:      { x: 0.42, y: 0.55 },
  });
  assertNull(computeWristShoulderVertical(lms, TILT_REF, "left"), "LEFT off-frame wrist");
  assertCloseTo(computeWristShoulderVertical(lms, TILT_REF, "right"), 1.0, 0.1, "RIGHT unaffected");
});

test("Camera-roll invariance: 30° rotated overhead pose still reports ~1.0", () => {
  // The metric projects (wrist − shoulder) onto the BODY-relative trunk-up
  // axis (hip → shoulder direction), not the image y-axis. So a camera roll
  // rotates every landmark by the same angle and the projection cancels out.
  // (The pre-2026-05-21 implementation used raw `(shoulder.y − wrist.y)` and
  // degraded by cos(roll) under any tilt; this test pins that the fix holds.)
  const rotate = (
    p: { x: number; y: number; visibility?: number },
    cx: number,
    cy: number,
    deg: number,
  ) => {
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
  };
  const baseLeftShoulder  = { x: 0.62, y: 0.30 };
  const baseRightShoulder = { x: 0.38, y: 0.30 };
  const baseLeftWrist     = { x: 0.62, y: 0.05 };
  const baseRightWrist    = { x: 0.38, y: 0.05 };
  const baseLeftHip       = { x: 0.58, y: 0.55 };
  const baseRightHip      = { x: 0.42, y: 0.55 };
  // Rotate every landmark by +30° around image center to simulate camera roll.
  const r = (p: { x: number; y: number }) => rotate(p, 0.5, 0.5, 30);
  const lms = makeLandmarks({
    leftShoulder:  r(baseLeftShoulder),
    rightShoulder: r(baseRightShoulder),
    leftWrist:     r(baseLeftWrist),
    rightWrist:    r(baseRightWrist),
    leftHip:       r(baseLeftHip),
    rightHip:      r(baseRightHip),
  });
  // Same expected ~1.0 as the un-rotated overhead test — projection along
  // trunkUp cancels the rotation.
  assertCloseTo(computeWristShoulderVertical(lms, TILT_REF, "left"),  1.0, 0.05, "LEFT rotated overhead");
  assertCloseTo(computeWristShoulderVertical(lms, TILT_REF, "right"), 1.0, 0.05, "RIGHT rotated overhead");
});

test("Missing one hip → null on BOTH sides (shared trunk reference)", () => {
  const lms = makeLandmarks({
    leftShoulder:  { x: 0.62, y: 0.30 },
    rightShoulder: { x: 0.38, y: 0.30 },
    leftWrist:     { x: 0.62, y: 0.05 },
    rightWrist:    { x: 0.38, y: 0.05 },
    leftHip:       { x: 0.58, y: 0.55, visibility: 0.2 },  // below MIN_VIS
    rightHip:      { x: 0.42, y: 0.55 },
  });
  assertNull(computeWristShoulderVertical(lms, TILT_REF, "left"),  "LEFT lost trunk");
  assertNull(computeWristShoulderVertical(lms, TILT_REF, "right"), "RIGHT lost trunk");
});

// ─────────────────────────────────────────────────────────────────────────────
// EX_007 LIVE-TUNED REP BOUNDARIES
// ─────────────────────────────────────────────────────────────────────────────

function ex007EventForPeak(peak: number): RepEvent | null {
  const definition = EXERCISE_REGISTRY.ex_007;
  if (definition.kind !== "dynamic") {
    throw new Error("ex_007 must remain a dynamic exercise");
  }
  const primary = definition.primaryMetric;
  const counter = new RepCounter(primary.thresholds, {
    descentEpsilon: primary.descentEpsilon,
  });
  const values = [-0.05, 0.11, peak, peak, peak - 0.04, 0.05];
  let event: RepEvent | null = null;
  values.forEach((value, index) => {
    event = counter.update(value, index * 100) ?? event;
  });
  return event;
}

test("ex_007 tuned boundary: low 0.18 wrist lift remains a false start", () => {
  assertNull(ex007EventForPeak(0.18), "low lift event");
});

test("ex_007 tuned boundary: medium 0.24 wrist press records a partial rep", () => {
  const event = ex007EventForPeak(0.24);
  if (event === null) throw new Error("medium partial: expected an event, got null");
  assertEqual(event.classification, "partial", "medium partial classification");
});

test("ex_007 tuned boundary: full 0.85 wrist press records a complete rep", () => {
  const event = ex007EventForPeak(0.85);
  if (event === null) throw new Error("full press: expected an event, got null");
  assertEqual(event.classification, "complete", "full press classification");
});

// ─────────────────────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n  ${testsPassed} passed, ${testsFailed} failed\n`);
process.exit(testsFailed === 0 ? 0 : 1);
