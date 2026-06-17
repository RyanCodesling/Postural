/**
 * Synthetic-landmark tests for `computeWristShoulderLateral`, the raw ex_007
 * tuning-trace metric that measures wrist path relative to the same shoulder.
 *
 * USAGE
 *   npx tsx web/src/lib/pose/wristShoulderLateral.test.ts
 */

import { computeWristShoulderLateral } from "./poseMetrics";
import type { TiltReference } from "./poseMetrics";

let testsPassed = 0;
let testsFailed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  PASS ${name}`);
    testsPassed += 1;
  } catch (err) {
    console.log(`  FAIL ${name}`);
    console.log(`       ${err instanceof Error ? err.message : String(err)}`);
    testsFailed += 1;
  }
}

function assertCloseTo(
  actual: number | null,
  expected: number,
  tolerance: number,
  label: string,
): void {
  if (actual === null) throw new Error(`${label}: expected ~${expected}, got null`);
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label}: expected ~${expected} (+/-${tolerance}), got ${actual}`);
  }
}

function assertNull(actual: number | null, label: string): void {
  if (actual !== null) throw new Error(`${label}: expected null, got ${actual}`);
}

const TILT_REF: TiltReference = {
  cameraTiltDeg: 0,
  confidence: "high",
  divergenceDeg: 0,
};

type LM = { x: number; y: number; visibility?: number };

function makeLandmarks(opts: {
  leftShoulder?: LM;
  rightShoulder?: LM;
  leftWrist?: LM;
  rightWrist?: LM;
  leftHip?: LM;
  rightHip?: LM;
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

console.log("\ncomputeWristShoulderLateral - synthetic data tests\n");

test("Wrists vertically aligned with shoulders -> ~0 on both sides", () => {
  const lms = makeLandmarks({
    leftShoulder:  { x: 0.62, y: 0.30 },
    rightShoulder: { x: 0.38, y: 0.30 },
    leftWrist:     { x: 0.62, y: 0.05 },
    rightWrist:    { x: 0.38, y: 0.05 },
    leftHip:       { x: 0.58, y: 0.55 },
    rightHip:      { x: 0.42, y: 0.55 },
  });
  assertCloseTo(computeWristShoulderLateral(lms, TILT_REF, "left"), 0, 0.01, "left");
  assertCloseTo(computeWristShoulderLateral(lms, TILT_REF, "right"), 0, 0.01, "right");
});

test("Outward wrist drift is positive on both sides", () => {
  const lms = makeLandmarks({
    leftShoulder:  { x: 0.62, y: 0.30 },
    rightShoulder: { x: 0.38, y: 0.30 },
    leftWrist:     { x: 0.72, y: 0.05 },
    rightWrist:    { x: 0.28, y: 0.05 },
    leftHip:       { x: 0.58, y: 0.55 },
    rightHip:      { x: 0.42, y: 0.55 },
  });
  assertCloseTo(computeWristShoulderLateral(lms, TILT_REF, "left"), 0.4, 0.01, "left");
  assertCloseTo(computeWristShoulderLateral(lms, TILT_REF, "right"), 0.4, 0.01, "right");
});

test("Inward wrist drift is negative on both sides", () => {
  const lms = makeLandmarks({
    leftShoulder:  { x: 0.62, y: 0.30 },
    rightShoulder: { x: 0.38, y: 0.30 },
    leftWrist:     { x: 0.52, y: 0.05 },
    rightWrist:    { x: 0.48, y: 0.05 },
    leftHip:       { x: 0.58, y: 0.55 },
    rightHip:      { x: 0.42, y: 0.55 },
  });
  assertCloseTo(computeWristShoulderLateral(lms, TILT_REF, "left"), -0.4, 0.01, "left");
  assertCloseTo(computeWristShoulderLateral(lms, TILT_REF, "right"), -0.4, 0.01, "right");
});

test("Camera-roll invariance: rotated outward drift stays positive and equal", () => {
  const base = {
    leftShoulder:  { x: 0.62, y: 0.30 },
    rightShoulder: { x: 0.38, y: 0.30 },
    leftWrist:     { x: 0.72, y: 0.05 },
    rightWrist:    { x: 0.28, y: 0.05 },
    leftHip:       { x: 0.58, y: 0.55 },
    rightHip:      { x: 0.42, y: 0.55 },
  };
  const r = (p: LM) => rotate(p, 0.5, 0.5, 30);
  const lms = makeLandmarks({
    leftShoulder:  r(base.leftShoulder),
    rightShoulder: r(base.rightShoulder),
    leftWrist:     r(base.leftWrist),
    rightWrist:    r(base.rightWrist),
    leftHip:       r(base.leftHip),
    rightHip:      r(base.rightHip),
  });
  assertCloseTo(computeWristShoulderLateral(lms, TILT_REF, "left"), 0.4, 0.01, "left");
  assertCloseTo(computeWristShoulderLateral(lms, TILT_REF, "right"), 0.4, 0.01, "right");
});

test("Off-frame wrist -> null on that side", () => {
  const lms = makeLandmarks({
    leftShoulder:  { x: 0.62, y: 0.30 },
    rightShoulder: { x: 0.38, y: 0.30 },
    leftWrist:     { x: 1.05, y: 0.05 },
    rightWrist:    { x: 0.38, y: 0.05 },
    leftHip:       { x: 0.58, y: 0.55 },
    rightHip:      { x: 0.42, y: 0.55 },
  });
  assertNull(computeWristShoulderLateral(lms, TILT_REF, "left"), "left");
  assertCloseTo(computeWristShoulderLateral(lms, TILT_REF, "right"), 0, 0.01, "right");
});

console.log(`\n  ${testsPassed} passed, ${testsFailed} failed\n`);
process.exit(testsFailed === 0 ? 0 : 1);
