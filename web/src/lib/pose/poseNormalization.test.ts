/**
 * poseNormalization.test.ts
 *
 * CHARACTERIZATION tests for how frame aspect ratio affects every clinical
 * angle in `poseMetrics.ts`.
 *
 * USAGE
 * ─────
 *   npx tsx web/src/lib/pose/poseNormalization.test.ts
 *
 * ── WHY THIS SUITE EXISTS ────────────────────────────────────────────────────
 * MediaPipe Pose Landmarker returns landmarks normalized as x/frameWidth and
 * y/frameHeight. On a non-square frame those divisors differ, so the coordinate
 * space is anisotropically scaled and an angle measured with `atan2` in it is
 * NOT the angle in real space. `lineAngleDeg` is exactly such an `atan2`, and
 * this file applies no aspect correction, so every angle below inherits the
 * distortion. Near-horizontal lines are amplified by k = W/H; near-vertical
 * ones are compressed by 1/k.
 *
 * There is an offline evidence model for this under `ml/comparison/` that pins
 * the same mathematics in Python. It is a HAND PORT: it can drift from this
 * file without failing, and it does not model the `inFrame01` guard at all.
 * These tests exist so the PRODUCT implementation is pinned directly, and so a
 * change to the coordinate handling shows up here as a diff rather than being
 * inferred from a document.
 *
 * ── WHAT THESE TESTS ASSERT ──────────────────────────────────────────────────
 * They assert CURRENT behaviour, including behaviour that is undesirable. They
 * are not a specification of what the metrics should read. A test failing after
 * an intentional coordinate change is the suite doing its job: update the
 * expectation deliberately and record why.
 *
 * ── FIXTURE DISCIPLINE ───────────────────────────────────────────────────────
 * Bodies are built in ISOTROPIC PIXEL space, where every `*Deg` argument is
 * true BY CONSTRUCTION, and only then normalized the way MediaPipe does. A
 * SQUARE frame is the control and MUST reproduce truth. If a control ever
 * fails, the fixture is wrong and every other number in this file must be
 * discarded until it is fixed — that has already happened twice during this
 * investigation, once because a lean fixture rotated the pelvis along with the
 * trunk so the hip-line tilt reference silently absorbed the whole lean.
 *
 * ── READING THE NUMBERS ──────────────────────────────────────────────────────
 * The public metric wrappers return `angleDeg` as an ABSOLUTE value rounded to
 * one decimal, with the sign carried separately in `direction` / `elevatedSide`.
 * So a signed geometric value of -11.7385 reaches a threshold comparison as
 * 11.7. `computeShoulderAbduction` is the exception and returns unrounded.
 */

import {
  computeTiltReference,
  computeLateralNeckTilt,
  computeShoulderSymmetry,
  computeTrunkLateralLean,
  computeShoulderAbduction,
  computeElbowFlexion,
  computeScapularElevation,
  computeWristShoulderVertical,
  computeWristShoulderLateral,
  computeShoulderElbowDistance,
  computePoseMetricsForExercise,
  frameAspectOf,
} from "./poseMetrics";
import { getExerciseDefinition } from "@/lib/exercises/registry";

// ─────────────────────────────────────────────────────────────────────────────
// MICRO ASSERTION HELPER — same minimal-deps style as the sibling suites
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

/**
 * NON-FINITE VALUES MUST BE REJECTED EXPLICITLY.
 *
 * The obvious form of this helper — `if (Math.abs(actual - expected) > tolerance) throw` —
 * silently PASSES when `actual` is NaN, because `Math.abs(NaN - x)` is NaN and
 * `NaN > tolerance` is false. Every assertion in this file routes through here,
 * so that one missing check made the whole suite unable to see a metric that
 * had started returning NaN. Found by mutation testing on review, 2026-09-06:
 * making the corrected `shoulderElbowDistance` return NaN still produced a
 * fully green run.
 */
function assertCloseTo(
  actual: number | null,
  expected: number,
  tolerance: number,
  label: string,
): void {
  if (actual === null) {
    throw new Error(`${label}: expected ~${expected}, got null`);
  }
  if (typeof actual !== "number" || !Number.isFinite(actual)) {
    throw new Error(`${label}: expected a finite number near ${expected}, got ${actual}`);
  }
  if (!Number.isFinite(expected)) {
    throw new Error(`${label}: the EXPECTED value is not finite (${expected}) — the test itself is wrong`);
  }
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(
      `${label}: expected ~${expected} (±${tolerance}), got ${actual}`,
    );
  }
}

/** Returns the value, or throws — so a null can never be silently skipped. */
function requireFinite(actual: number | null, label: string): number {
  if (actual === null || !Number.isFinite(actual)) {
    throw new Error(`${label}: expected a finite value, got ${actual}`);
  }
  return actual;
}

function assertNull(actual: unknown, label: string): void {
  if (actual !== null) {
    throw new Error(`${label}: expected null, got ${JSON.stringify(actual)}`);
  }
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PIXEL-SPACE FIXTURES
// ─────────────────────────────────────────────────────────────────────────────

type Pt = { x: number; y: number };
type LMArr = Array<{ x: number; y: number; visibility?: number }>;

/** Segment lengths in pixels. Chosen to sit inside a 720-high frame. */
const SHOULDER_W = 200;
const HIP_W = 150;
const EAR_W = 150;
const TRUNK_LEN = 300;
const UPPER_ARM = 170;
const FOREARM = 160;
const HEAD_UP = 90;

const rad = (d: number) => (d * Math.PI) / 180;

type Body = {
  leftShoulder: Pt; rightShoulder: Pt;
  leftHip: Pt;      rightHip: Pt;
  leftEar: Pt;      rightEar: Pt;
  leftElbow: Pt;    rightElbow: Pt;
  leftWrist: Pt;    rightWrist: Pt;
};

/**
 * A whole body in pixel space, girdles perpendicular to the trunk axis.
 *
 * NOTE: `trunkLeanDeg` here leans the WHOLE body including the pelvis, which
 * the hip-line tilt reference then absorbs. Use `buildTrunkLean` for the
 * clinical case where the ribcage shifts over a level pelvis.
 */
function buildBody(
  W: number,
  H: number,
  opts: {
    neckTiltDeg?: number;
    shoulderTiltDeg?: number;
    trunkLeanDeg?: number;
    armElevDeg?: number;
    elbowFlexDeg?: number;
    cameraRollDeg?: number;
  } = {},
): Body {
  const {
    neckTiltDeg = 0,
    shoulderTiltDeg = 0,
    trunkLeanDeg = 0,
    armElevDeg = 90,
    elbowFlexDeg = 180,
    cameraRollDeg = 0,
  } = opts;

  const cx = W / 2;
  const cy = H * 0.32;
  const t = rad(90 + trunkLeanDeg);

  const sm: Pt = { x: cx, y: cy };
  const hm: Pt = { x: cx + TRUNK_LEN * Math.cos(t), y: cy + TRUNK_LEN * Math.sin(t) };

  const pair = (mid: Pt, width: number, extraDeg: number): [Pt, Pt] => {
    const a = t - rad(90) + rad(extraDeg);
    return [
      { x: mid.x + (width / 2) * Math.cos(a), y: mid.y + (width / 2) * Math.sin(a) },
      { x: mid.x - (width / 2) * Math.cos(a), y: mid.y - (width / 2) * Math.sin(a) },
    ];
  };

  const [ls, rs] = pair(sm, SHOULDER_W, shoulderTiltDeg);
  const [lh, rh] = pair(hm, HIP_W, 0);
  const head: Pt = { x: sm.x - HEAD_UP * Math.cos(t), y: sm.y - HEAD_UP * Math.sin(t) };
  const [le, re] = pair(head, EAR_W, neckTiltDeg);

  const aL = t - rad(armElevDeg);
  const aR = t + rad(armElevDeg);
  const lel: Pt = { x: ls.x + UPPER_ARM * Math.cos(aL), y: ls.y + UPPER_ARM * Math.sin(aL) };
  const rel: Pt = { x: rs.x + UPPER_ARM * Math.cos(aR), y: rs.y + UPPER_ARM * Math.sin(aR) };

  const bend = rad(180 - elbowFlexDeg);
  const lwr: Pt = { x: lel.x + FOREARM * Math.cos(aL - bend), y: lel.y + FOREARM * Math.sin(aL - bend) };
  const rwr: Pt = { x: rel.x + FOREARM * Math.cos(aR + bend), y: rel.y + FOREARM * Math.sin(aR + bend) };

  let body: Body = {
    leftShoulder: ls, rightShoulder: rs,
    leftHip: lh,      rightHip: rh,
    leftEar: le,      rightEar: re,
    leftElbow: lel,   rightElbow: rel,
    leftWrist: lwr,   rightWrist: rwr,
  };

  if (cameraRollDeg !== 0) {
    const c = Math.cos(rad(cameraRollDeg));
    const s = Math.sin(rad(cameraRollDeg));
    const roll = (p: Pt): Pt => ({
      x: cx + (p.x - cx) * c - (p.y - cy) * s,
      y: cy + (p.x - cx) * s + (p.y - cy) * c,
    });
    body = Object.fromEntries(
      Object.entries(body).map(([k, p]) => [k, roll(p as Pt)]),
    ) as unknown as Body;
  }

  return body;
}

/**
 * Trunk lean with a LEVEL PELVIS — the clinical case.
 *
 * The first version of this fixture rotated the pelvis with the trunk. The
 * hip-line tilt reference then absorbed the entire lean and the square control
 * read 0.00 at every angle, which is how the error was caught. Any fixture
 * whose control does not reproduce truth is wrong.
 */
function buildTrunkLean(W: number, H: number, leanDeg: number): Body {
  const cx = W / 2;
  const cy = H * 0.32;
  const t = rad(90 + leanDeg);

  const sm: Pt = { x: cx, y: cy };
  const hm: Pt = { x: cx + TRUNK_LEN * Math.cos(t), y: cy + TRUNK_LEN * Math.sin(t) };
  const headX = sm.x - HEAD_UP * Math.cos(t);
  const headY = sm.y - HEAD_UP * Math.sin(t);

  // Arms are irrelevant to the lean metrics; park them below the shoulders so
  // the array is well-formed and every landmark stays inside the frame.
  return {
    leftHip:  { x: hm.x + HIP_W / 2, y: hm.y },
    rightHip: { x: hm.x - HIP_W / 2, y: hm.y },
    leftShoulder:  { x: sm.x + SHOULDER_W / 2, y: sm.y },
    rightShoulder: { x: sm.x - SHOULDER_W / 2, y: sm.y },
    leftEar:  { x: headX + EAR_W / 2, y: headY },
    rightEar: { x: headX - EAR_W / 2, y: headY },
    leftElbow:  { x: sm.x + SHOULDER_W / 2, y: sm.y + UPPER_ARM },
    rightElbow: { x: sm.x - SHOULDER_W / 2, y: sm.y + UPPER_ARM },
    leftWrist:  { x: sm.x + SHOULDER_W / 2, y: sm.y + UPPER_ARM + FOREARM },
    rightWrist: { x: sm.x - SHOULDER_W / 2, y: sm.y + UPPER_ARM + FOREARM },
  };
}

/** Exactly what MediaPipe hands the application: x/W, y/H, into a 33-slot array. */
function toLandmarks(body: Body, W: number, H: number): LMArr {
  const lms: LMArr = [];
  for (let i = 0; i < 33; i++) lms.push({ x: 0, y: 0, visibility: 0 });
  const put = (i: number, p: Pt) => {
    lms[i] = { x: p.x / W, y: p.y / H, visibility: 1 };
  };
  put(7,  body.leftEar);
  put(8,  body.rightEar);
  put(11, body.leftShoulder);
  put(12, body.rightShoulder);
  put(13, body.leftElbow);
  put(14, body.rightElbow);
  put(15, body.leftWrist);
  put(16, body.rightWrist);
  put(23, body.leftHip);
  put(24, body.rightHip);
  return lms;
}

const FRAMES = {
  wide: { label: "16:9 1280x720", W: 1280, H: 720 },
  standard: { label: "4:3 640x480", W: 640, H: 480 },
  square: { label: "1:1 720x720 CONTROL", W: 720, H: 720 },
  /**
   * A roomier square control, needed only where the fixture's WRIST
   * participates.
   *
   * The body above spans SHOULDER_W/2 + UPPER_ARM + FOREARM = 430 px from the
   * midline, so a T-pose wrist lands at x = 1.0675 in a 720-wide square frame
   * — genuinely outside it, and `computeElbowFlexion` correctly returns null.
   * The offline Python model has no frame guard, so it silently computes elbow
   * angles from that out-of-frame wrist; this frame is what lets the product be
   * controlled at k = 1 without hitting the guard.
   */
  squareRoomy: { label: "1:1 1000x1000 CONTROL", W: 1000, H: 1000 },
} as const;

/**
 * Slides every landmark horizontally by `dx` in normalized units.
 *
 * A pure translation preserves every angle and every trunk-relative
 * projection, so it moves the body across the frame without changing a single
 * expected reading. That makes it the honest way to probe where the
 * `inFrame01` boundary actually bites: changing one landmark's x instead would
 * also change the geometry, and can trip an unrelated guard.
 */
function shiftX(lms: LMArr, dx: number): LMArr {
  return lms.map((p, i) =>
    p.visibility === 0 && i !== 0 ? p : { ...p, x: p.x + dx },
  );
}

/** Reading of a metric, with the tilt reference resolved from the same frame. */
function readNeckTilt(lms: LMArr): number | null {
  const r = computeLateralNeckTilt(lms, computeTiltReference(lms));
  return r ? r.angleDeg : null;
}
function readShoulderSymmetry(lms: LMArr): number | null {
  const r = computeShoulderSymmetry(lms, computeTiltReference(lms));
  return r ? r.angleDeg : null;
}
function readTrunkLean(lms: LMArr): number | null {
  const r = computeTrunkLateralLean(lms, computeTiltReference(lms));
  return r ? r.angleDeg : null;
}

console.log("\nposeMetrics — aspect-ratio characterization\n");

// ─────────────────────────────────────────────────────────────────────────────
// A — SQUARE-FRAME CONTROLS. These validate the fixtures. If one fails,
//     discard every other number in this file until it is fixed.
// ─────────────────────────────────────────────────────────────────────────────

console.log("A — square-frame controls (fixtures must reproduce truth)");

test("control: shoulder tilt reads true on a square frame", () => {
  const { W, H } = FRAMES.square;
  for (const trueDeg of [3, 5, 8]) {
    const lms = toLandmarks(buildBody(W, H, { shoulderTiltDeg: trueDeg }), W, H);
    assertCloseTo(readShoulderSymmetry(lms), trueDeg, 0.06, `square shoulderSymmetry @ true ${trueDeg}`);
  }
});

test("control: trunk lean reads true on a square frame (level pelvis)", () => {
  const { W, H } = FRAMES.square;
  for (const trueDeg of [2, 5, 8, 12]) {
    const lms = toLandmarks(buildTrunkLean(W, H, trueDeg), W, H);
    assertCloseTo(readTrunkLean(lms), trueDeg, 0.06, `square trunkLean @ true ${trueDeg}`);
  }
});

test("control: arm elevation reads true on a square frame", () => {
  const { W, H } = FRAMES.square;
  for (const trueDeg of [60, 80, 90, 100]) {
    const lms = toLandmarks(buildBody(W, H, { armElevDeg: trueDeg }), W, H);
    assertCloseTo(
      computeShoulderAbduction(lms, computeTiltReference(lms), "left"),
      trueDeg, 0.06, `square abduction @ true ${trueDeg}`,
    );
  }
});

test("control: camera roll is fully cancelled on a square frame", () => {
  const { W, H } = FRAMES.square;
  for (const roll of [3, 6, 10]) {
    const lms = toLandmarks(buildBody(W, H, { cameraRollDeg: roll }), W, H);
    assertCloseTo(readTrunkLean(lms), 0, 0.06, `square trunkLean @ roll ${roll}`);
    assertCloseTo(readShoulderSymmetry(lms), 0, 0.06, `square shoulderSymmetry @ roll ${roll}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// B — THE DISTORTION. Two metrics declaring the SAME 5° threshold fire at
//     true angles a factor of k² apart.
// ─────────────────────────────────────────────────────────────────────────────

console.log("\nB — anisotropic distortion of the line-angle metrics");

test("shoulderSymmetry (near-horizontal) is AMPLIFIED by k", () => {
  // A declared 5° threshold is reached by a smaller true angle.
  const { W, H } = FRAMES.wide;
  const lms = toLandmarks(buildBody(W, H, { shoulderTiltDeg: 2.8236 }), W, H);
  assertCloseTo(readShoulderSymmetry(lms), 5.0, 0.06, "16:9 shoulderSymmetry @ true 2.82");
});

test("trunkLean (near-vertical) is COMPRESSED by 1/k", () => {
  // The same declared 5° threshold needs a much larger true angle.
  const { W, H } = FRAMES.wide;
  const lms = toLandmarks(buildTrunkLean(W, H, 8.8407), W, H);
  assertCloseTo(readTrunkLean(lms), 5.0, 0.06, "16:9 trunkLean @ true 8.84");
});

test("ex_004's 3° trunkLean threshold needs true 5.32° on 16:9", () => {
  const { W, H } = FRAMES.wide;
  const lms = toLandmarks(buildTrunkLean(W, H, 5.3182), W, H);
  assertCloseTo(readTrunkLean(lms), 3.0, 0.06, "16:9 trunkLean @ true 5.32");
});

test("trunk lean readings compress across the clinical range on 16:9", () => {
  const { W, H } = FRAMES.wide;
  const expected: Array<[number, number]> = [
    [2, 1.1], [3, 1.7], [5, 2.8], [8, 4.5], [12, 6.8],
  ];
  for (const [trueDeg, reading] of expected) {
    const lms = toLandmarks(buildTrunkLean(W, H, trueDeg), W, H);
    assertCloseTo(readTrunkLean(lms), reading, 0.06, `16:9 trunkLean @ true ${trueDeg}`);
  }
});

test("4:3 sits between 16:9 and the square control, as k predicts", () => {
  const { W, H } = FRAMES.standard;
  const lmsSym = toLandmarks(buildBody(W, H, { shoulderTiltDeg: 3.75 }), W, H);
  assertCloseTo(readShoulderSymmetry(lmsSym), 5.0, 0.08, "4:3 shoulderSymmetry @ true 3.75");
  const lmsLean = toLandmarks(buildTrunkLean(W, H, 6.6462), W, H);
  assertCloseTo(readTrunkLean(lmsLean), 5.0, 0.08, "4:3 trunkLean @ true 6.65");
});

// ─────────────────────────────────────────────────────────────────────────────
// C — ex_006 HOLD BAND. The declared ±10° admits far less true range.
// ─────────────────────────────────────────────────────────────────────────────

console.log("\nC — ex_006 90° ± 10° hold band");

/** Sweeps true elevation and returns the true range whose READING is in band. */
function bandTrueSpan(W: number, H: number, lo: number, hi: number): [number, number] {
  let foundLo: number | null = null;
  let foundHi: number | null = null;
  for (let t = 20; t < 160; t += 0.05) {
    const lms = toLandmarks(buildBody(W, H, { armElevDeg: t }), W, H);
    const v = computeShoulderAbduction(lms, computeTiltReference(lms), "left");
    if (v !== null && v >= lo && v <= hi) {
      if (foundLo === null) foundLo = t;
      foundHi = t;
    }
  }
  if (foundLo === null || foundHi === null) throw new Error("band never entered");
  return [foundLo, foundHi];
}

test("16:9 band admits true 84.35–95.65 (±5.65, not ±10)", () => {
  const [lo, hi] = bandTrueSpan(FRAMES.wide.W, FRAMES.wide.H, 80, 100);
  assertCloseTo(lo, 84.35, 0.06, "16:9 band lower");
  assertCloseTo(hi, 95.65, 0.06, "16:9 band upper");
});

test("4:3 band admits true 82.50–97.50 (±7.5)", () => {
  const [lo, hi] = bandTrueSpan(FRAMES.standard.W, FRAMES.standard.H, 80, 100);
  assertCloseTo(lo, 82.5, 0.06, "4:3 band lower");
  assertCloseTo(hi, 97.5, 0.06, "4:3 band upper");
});

test("control: square band admits very nearly the full ±10", () => {
  const [lo, hi] = bandTrueSpan(FRAMES.square.W, FRAMES.square.H, 80, 100);
  assertCloseTo(lo, 80.05, 0.06, "square band lower");
  assertCloseTo(hi, 100.0, 0.06, "square band upper");
});

test("90° is the only exact point — arm-horizontal and trunk-vertical align", () => {
  const { W, H } = FRAMES.wide;
  const at90 = toLandmarks(buildBody(W, H, { armElevDeg: 90 }), W, H);
  assertCloseTo(
    computeShoulderAbduction(at90, computeTiltReference(at90), "left"),
    90, 0.02, "16:9 abduction @ true 90",
  );
  const at80 = toLandmarks(buildBody(W, H, { armElevDeg: 80 }), W, H);
  assertCloseTo(
    computeShoulderAbduction(at80, computeTiltReference(at80), "left"),
    72.6, 0.06, "16:9 abduction @ true 80",
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// D — CAMERA ROLL. The tilt reference is horizontal-class and the trunk line
//     is vertical-class, so the correction over-corrects on a wide frame.
// ─────────────────────────────────────────────────────────────────────────────

console.log("\nD — camera roll is not cancelled for trunkLean on a wide frame");

test("10° of roll leaks 11.7° into trunkLean while symmetry stays 0", () => {
  const { W, H } = FRAMES.wide;
  const lms = toLandmarks(buildBody(W, H, { cameraRollDeg: 10 }), W, H);
  assertCloseTo(readTrunkLean(lms), 11.7, 0.06, "16:9 trunkLean @ roll 10");
  assertCloseTo(readShoulderSymmetry(lms), 0, 0.06, "16:9 shoulderSymmetry @ roll 10");
});

test("a shelf-propped webcam (3–6° roll) already crosses the 5° threshold", () => {
  const { W, H } = FRAMES.wide;
  const expected: Array<[number, number]> = [[3, 3.6], [6, 7.2]];
  for (const [roll, reading] of expected) {
    const lms = toLandmarks(buildBody(W, H, { cameraRollDeg: roll }), W, H);
    assertCloseTo(readTrunkLean(lms), reading, 0.06, `16:9 trunkLean @ roll ${roll}`);
  }
});

test("the leaked lean is reported as a direction, not merely a magnitude", () => {
  const { W, H } = FRAMES.wide;
  const lms = toLandmarks(buildBody(W, H, { cameraRollDeg: 10 }), W, H);
  const r = computeTrunkLateralLean(lms, computeTiltReference(lms));
  if (!r) throw new Error("expected a trunk-lean result");
  assertEqual(r.direction, "left", "leaked lean direction");
  assertEqual(r.severity !== "normal", true, "leaked lean is above the noise floor");
});

// ─────────────────────────────────────────────────────────────────────────────
// E — neckTilt HALVING. Not an aspect effect: it reproduces in the control.
// ─────────────────────────────────────────────────────────────────────────────

console.log("\nE — neckTilt halving inside the tilt-reference agreement window");

test("control: neckTilt reads HALF its true value below the 3° agreement bound", () => {
  const { W, H } = FRAMES.square;
  const expected: Array<[number, number]> = [[1, 0.5], [2, 1.0], [3, 1.5]];
  for (const [trueDeg, reading] of expected) {
    const lms = toLandmarks(buildBody(W, H, { neckTiltDeg: trueDeg }), W, H);
    assertCloseTo(readNeckTilt(lms), reading, 0.06, `square neckTilt @ true ${trueDeg}`);
  }
});

test("control: the transfer function is DISCONTINUOUS at the boundary", () => {
  const { W, H } = FRAMES.square;
  const below = toLandmarks(buildBody(W, H, { neckTiltDeg: 3.0 }), W, H);
  const above = toLandmarks(buildBody(W, H, { neckTiltDeg: 3.01 }), W, H);
  assertCloseTo(readNeckTilt(below), 1.5, 0.06, "square neckTilt @ true 3.00");
  assertCloseTo(readNeckTilt(above), 3.0, 0.06, "square neckTilt @ true 3.01");
});

test("control: above the boundary the reading is correct again", () => {
  const { W, H } = FRAMES.square;
  for (const trueDeg of [5, 8]) {
    const lms = toLandmarks(buildBody(W, H, { neckTiltDeg: trueDeg }), W, H);
    assertCloseTo(readNeckTilt(lms), trueDeg, 0.06, `square neckTilt @ true ${trueDeg}`);
  }
});

test("the tilt reference reports which regime it is in", () => {
  const { W, H } = FRAMES.square;
  const below = toLandmarks(buildBody(W, H, { neckTiltDeg: 2 }), W, H);
  const above = toLandmarks(buildBody(W, H, { neckTiltDeg: 5 }), W, H);
  assertEqual(computeTiltReference(below).confidence, "high", "confidence inside window");
  assertEqual(computeTiltReference(above).confidence, "low", "confidence outside window");
});

// ─────────────────────────────────────────────────────────────────────────────
// F — elbowFlexion. Both segments are distorted, so the effect is
//     orientation-dependent rather than a fixed factor.
// ─────────────────────────────────────────────────────────────────────────────

console.log("\nF — elbowFlexion, both segments distorted");

test("a declared 'warn below 150' fires well above true 150 on 16:9", () => {
  const { W, H } = FRAMES.wide;
  const lms = toLandmarks(buildBody(W, H, { armElevDeg: 90, elbowFlexDeg: 150 }), W, H);
  assertCloseTo(
    computeElbowFlexion(lms, computeTiltReference(lms), "left"),
    134.2, 0.15, "16:9 elbowFlexion @ true 150",
  );
});

test("control: elbowFlexion reads true on a square frame", () => {
  // squareRoomy, not square: see the FRAMES comment — a T-pose wrist does not
  // fit inside a 720-wide square frame and the guard correctly rejects it.
  const { W, H } = FRAMES.squareRoomy;
  for (const trueDeg of [150, 170]) {
    const lms = toLandmarks(buildBody(W, H, { armElevDeg: 90, elbowFlexDeg: trueDeg }), W, H);
    assertCloseTo(
      computeElbowFlexion(lms, computeTiltReference(lms), "left"),
      trueDeg, 0.15, `square elbowFlexion @ true ${trueDeg}`,
    );
  }
});

test("a T-pose wrist genuinely leaves a 720-wide square frame", () => {
  // Pins the fixture limitation above rather than leaving it as a comment: the
  // null here is the product being correct, not a defect.
  const { W, H } = FRAMES.square;
  const lms = toLandmarks(buildBody(W, H, { armElevDeg: 90, elbowFlexDeg: 150 }), W, H);
  assertCloseTo(lms[15]!.x, 1.0675, 0.001, "square T-pose wrist x");
  assertNull(
    computeElbowFlexion(lms, computeTiltReference(lms), "left"),
    "square elbowFlexion nulled by out-of-frame wrist",
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// G — scapularElevation. A projection in trunk-length units, not an angle.
// ─────────────────────────────────────────────────────────────────────────────

console.log("\nG — scapularElevation, invariant only while the trunk is vertical");

test("scapularElevation matches the square control when the trunk is vertical", () => {
  for (const neckTiltDeg of [0, 3, 6]) {
    const sq = FRAMES.square;
    const wd = FRAMES.wide;
    const sqLms = toLandmarks(buildBody(sq.W, sq.H, { neckTiltDeg }), sq.W, sq.H);
    const wdLms = toLandmarks(buildBody(wd.W, wd.H, { neckTiltDeg }), wd.W, wd.H);
    const sqVal = computeScapularElevation(sqLms, computeTiltReference(sqLms), "left");
    const wdVal = computeScapularElevation(wdLms, computeTiltReference(wdLms), "left");
    if (sqVal === null || wdVal === null) throw new Error("expected a scapular value");
    assertCloseTo(wdVal, sqVal, 1e-9, `scapularElevation aspect invariance @ neckTilt ${neckTiltDeg}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// H — THE FRAME GUARD. `inFrame01` tests the normalized coordinate against
//     [0,1]. It is the constraint any coordinate change has to respect, and
//     the offline Python model does not represent it at all.
// ─────────────────────────────────────────────────────────────────────────────

console.log("\nH — the inFrame01 guard, which any coordinate change must respect");

test("a T-pose elbow is well inside the frame today on 16:9", () => {
  const { W, H } = FRAMES.wide;
  const lms = toLandmarks(buildBody(W, H, { armElevDeg: 90 }), W, H);
  // Subject-perspective LEFT is image-right, so it carries the larger x.
  assertCloseTo(lms[13]!.x, 0.7109, 0.001, "T-pose left elbow x");
  const v = computeShoulderAbduction(lms, computeTiltReference(lms), "left");
  assertCloseTo(v, 90, 0.02, "T-pose left abduction is measured, not nulled");
});

test("an elbow past x = 1 nulls the primary, on every aspect", () => {
  for (const f of [FRAMES.wide, FRAMES.standard, FRAMES.square]) {
    const lms = toLandmarks(buildBody(f.W, f.H, { armElevDeg: 90 }), f.W, f.H);
    lms[13] = { x: 1.0001, y: lms[13]!.y, visibility: 1 };
    assertNull(
      computeShoulderAbduction(lms, computeTiltReference(lms), "left"),
      `${f.label}: abduction nulled by out-of-frame elbow`,
    );
  }
});

test("the guard is shared by elbowFlexion and gates on the wrist too", () => {
  const { W, H } = FRAMES.wide;
  const lms = toLandmarks(buildBody(W, H, { armElevDeg: 90, elbowFlexDeg: 150 }), W, H);
  const baseline = computeElbowFlexion(lms, computeTiltReference(lms), "left");
  if (baseline === null) throw new Error("expected a baseline elbow angle");
  lms[15] = { x: 1.0001, y: lms[15]!.y, visibility: 1 };
  assertNull(
    computeElbowFlexion(lms, computeTiltReference(lms), "left"),
    "elbowFlexion nulled by out-of-frame wrist",
  );
});

test("the whole normalized width is currently usable — nothing is rejected below x = 1", () => {
  // Pins the guard's PRESENT BUDGET, by sliding an unchanged body across the
  // frame so the geometry — and therefore the expected reading — is identical
  // at every position. A T-pose left elbow sits natively at x = 0.7109 on 16:9;
  // every placement below x = 1 must still measure 90°.
  //
  // This is the constraint a coordinate change has to respect. Rescaling x by
  // k = W/H without rescaling this bound would leave only x_true <= 1/k =
  // 0.5625 usable on 16:9, discarding the rightmost 43.8% of the frame — and
  // because MediaPipe labels are subject-perspective, the landmarks with the
  // largest x are the subject's LEFT ones, so the loss would be one-sided.
  const { W, H } = FRAMES.wide;
  const NATIVE_ELBOW_X = 0.7109;
  const base = toLandmarks(buildBody(W, H, { armElevDeg: 90 }), W, H);
  for (const targetX of [0.5625, 0.7109, 0.85, 0.9999]) {
    const probe = shiftX(base, targetX - NATIVE_ELBOW_X);
    assertCloseTo(probe[13]!.x, targetX, 0.001, `elbow placed at x=${targetX}`);
    assertCloseTo(
      computeShoulderAbduction(probe, computeTiltReference(probe), "left"),
      90, 0.02, `abduction measured with elbow at x=${targetX}`,
    );
  }
});

test("the guard bites exactly at x = 1, not before", () => {
  const { W, H } = FRAMES.wide;
  const base = toLandmarks(buildBody(W, H, { armElevDeg: 90 }), W, H);
  // Take the native x from the array rather than the rounded literal above —
  // at this tolerance the 0.7109 / 0.7109375 difference is what decides the
  // assertion.
  const nativeElbowX = base[13]!.x;
  const justInside = shiftX(base, 0.99999 - nativeElbowX);
  const justOutside = shiftX(base, 1.00001 - nativeElbowX);
  assertCloseTo(
    computeShoulderAbduction(justInside, computeTiltReference(justInside), "left"),
    90, 0.02, "elbow just inside x = 1 is measured",
  );
  assertNull(
    computeShoulderAbduction(justOutside, computeTiltReference(justOutside), "left"),
    "elbow just outside x = 1 is nulled",
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// I — THE CORRECTION, when a caller opts in by passing the real frame aspect.
//     Everything above measures the DEFAULT path, which is unchanged.
// ─────────────────────────────────────────────────────────────────────────────

console.log("\nI — the aspect correction, opted into by passing frameAspect");

const K_WIDE = frameAspectOf(FRAMES.wide.W, FRAMES.wide.H);
const K_STD = frameAspectOf(FRAMES.standard.W, FRAMES.standard.H);

function correctedNeckTilt(lms: LMArr, k: number): number | null {
  const r = computeLateralNeckTilt(lms, computeTiltReference(lms, k), k);
  return r ? r.angleDeg : null;
}
function correctedSymmetry(lms: LMArr, k: number): number | null {
  const r = computeShoulderSymmetry(lms, computeTiltReference(lms, k), k);
  return r ? r.angleDeg : null;
}
function correctedTrunkLean(lms: LMArr, k: number): number | null {
  const r = computeTrunkLateralLean(lms, computeTiltReference(lms, k), k);
  return r ? r.angleDeg : null;
}
function correctedAbduction(lms: LMArr, k: number): number | null {
  return computeShoulderAbduction(lms, computeTiltReference(lms, k), "left", k);
}

test("frameAspectOf returns W/H, and 1 for a degenerate frame", () => {
  assertCloseTo(K_WIDE, 1.7778, 0.0001, "16:9 aspect");
  assertCloseTo(K_STD, 1.3333, 0.0001, "4:3 aspect");
  assertCloseTo(frameAspectOf(720, 720), 1, 1e-12, "square aspect");
  assertCloseTo(frameAspectOf(0, 720), 1, 1e-12, "zero width falls back to 1");
  assertCloseTo(frameAspectOf(1280, 0), 1, 1e-12, "zero height falls back to 1");
  assertCloseTo(frameAspectOf(NaN, 720), 1, 1e-12, "NaN falls back to 1");
});

test("corrected shoulderSymmetry reads TRUE on 16:9", () => {
  const { W, H } = FRAMES.wide;
  for (const trueDeg of [3, 5, 8]) {
    const lms = toLandmarks(buildBody(W, H, { shoulderTiltDeg: trueDeg }), W, H);
    assertCloseTo(correctedSymmetry(lms, K_WIDE), trueDeg, 0.06, `corrected symmetry @ true ${trueDeg}`);
  }
});

test("corrected trunkLean reads TRUE on 16:9 — the k² gap closes", () => {
  const { W, H } = FRAMES.wide;
  for (const trueDeg of [2, 5, 8, 12]) {
    const lms = toLandmarks(buildTrunkLean(W, H, trueDeg), W, H);
    assertCloseTo(correctedTrunkLean(lms, K_WIDE), trueDeg, 0.06, `corrected lean @ true ${trueDeg}`);
  }
});

test("a declared 5° now means the same true angle for BOTH metrics", () => {
  // This is the whole point: uncorrected, 5° meant true 2.82 on the shoulder
  // line and true 8.84 on the trunk line. Corrected, both mean true 5.
  const { W, H } = FRAMES.wide;
  const sym = toLandmarks(buildBody(W, H, { shoulderTiltDeg: 5 }), W, H);
  const lean = toLandmarks(buildTrunkLean(W, H, 5), W, H);
  assertCloseTo(correctedSymmetry(sym, K_WIDE), 5, 0.06, "corrected symmetry @ true 5");
  assertCloseTo(correctedTrunkLean(lean, K_WIDE), 5, 0.06, "corrected lean @ true 5");
});

test("corrected abduction reads TRUE away from 90°, where it used to bend", () => {
  const { W, H } = FRAMES.wide;
  for (const trueDeg of [60, 80, 90, 100, 120]) {
    const lms = toLandmarks(buildBody(W, H, { armElevDeg: trueDeg }), W, H);
    assertCloseTo(correctedAbduction(lms, K_WIDE), trueDeg, 0.06, `corrected abduction @ true ${trueDeg}`);
  }
});

test("the corrected ex_006 band finally admits the full true ±10", () => {
  let lo: number | null = null;
  let hi: number | null = null;
  const { W, H } = FRAMES.wide;
  for (let t = 20; t < 160; t += 0.05) {
    const lms = toLandmarks(buildBody(W, H, { armElevDeg: t }), W, H);
    const v = correctedAbduction(lms, K_WIDE);
    if (v !== null && v >= 80 && v <= 100) {
      if (lo === null) lo = t;
      hi = t;
    }
  }
  assertCloseTo(lo, 80.05, 0.06, "corrected band lower");
  assertCloseTo(hi, 100.0, 0.06, "corrected band upper");
});

test("corrected camera roll is fully cancelled for trunkLean", () => {
  const { W, H } = FRAMES.wide;
  for (const roll of [3, 6, 10]) {
    const lms = toLandmarks(buildBody(W, H, { cameraRollDeg: roll }), W, H);
    assertCloseTo(correctedTrunkLean(lms, K_WIDE), 0, 0.06, `corrected lean @ roll ${roll}`);
    assertCloseTo(correctedSymmetry(lms, K_WIDE), 0, 0.06, `corrected symmetry @ roll ${roll}`);
  }
});

test("corrected elbowFlexion reads TRUE on 16:9", () => {
  const { W, H } = FRAMES.wide;
  for (const trueDeg of [150, 170]) {
    const lms = toLandmarks(buildBody(W, H, { armElevDeg: 90, elbowFlexDeg: trueDeg }), W, H);
    assertCloseTo(
      computeElbowFlexion(lms, computeTiltReference(lms, K_WIDE), "left", K_WIDE),
      trueDeg, 0.15, `corrected elbowFlexion @ true ${trueDeg}`,
    );
  }
});

test("4:3 is corrected too, so the two aspects finally agree", () => {
  const wide = toLandmarks(buildTrunkLean(FRAMES.wide.W, FRAMES.wide.H, 7), FRAMES.wide.W, FRAMES.wide.H);
  const std = toLandmarks(buildTrunkLean(FRAMES.standard.W, FRAMES.standard.H, 7), FRAMES.standard.W, FRAMES.standard.H);
  const a = correctedTrunkLean(wide, K_WIDE);
  const b = correctedTrunkLean(std, K_STD);
  assertCloseTo(a, 7, 0.06, "corrected lean on 16:9");
  assertCloseTo(b, 7, 0.06, "corrected lean on 4:3");
  // Cross-device comparability, which is what the uncorrected path cannot give.
  assertCloseTo(a! - b!, 0, 0.06, "16:9 and 4:3 agree once corrected");
});

test("the correction is a mathematical no-op on a square frame", () => {
  const { W, H } = FRAMES.square;
  for (const trueDeg of [3, 8]) {
    const lms = toLandmarks(buildBody(W, H, { shoulderTiltDeg: trueDeg }), W, H);
    const plain = readShoulderSymmetry(lms);
    const corrected = correctedSymmetry(lms, frameAspectOf(W, H));
    assertCloseTo(corrected, plain!, 1e-12, `square no-op @ true ${trueDeg}`);
  }
});

test("REGRESSION: correcting the geometry must NOT shrink the usable frame", () => {
  // The defect this suite was written to prevent. A naive implementation
  // rescales the landmark array, after which `inFrame01`'s [0,1] test admits
  // only x <= 1/k = 0.5625 on 16:9 and the subject's LEFT-side primary nulls
  // for most of its range — an ex_001 side that silently stops counting, and an
  // ex_006 hold that never accrues.
  //
  // Correction lives in the geometry, so the guard's budget is unchanged: every
  // elbow position that was measurable uncorrected must still be measurable.
  const { W, H } = FRAMES.wide;
  const base = toLandmarks(buildBody(W, H, { armElevDeg: 90 }), W, H);
  const nativeElbowX = base[13]!.x;
  for (const targetX of [0.5625, 0.7109, 0.85, 0.9999]) {
    const probe = shiftX(base, targetX - nativeElbowX);
    const plain = computeShoulderAbduction(probe, computeTiltReference(probe), "left");
    const corrected = correctedAbduction(probe, K_WIDE);
    if (plain === null) throw new Error(`fixture broken: uncorrected nulled at x=${targetX}`);
    if (corrected === null) {
      throw new Error(
        `elbow at x=${targetX} is inside the frame and measurable uncorrected, ` +
        `but the corrected path nulled it — the guard budget shrank`,
      );
    }
  }
});

test("REGRESSION: a resting arm on 16:9 still measures under correction", () => {
  // The naive rescale fails here too, and this is the worse case: 10° is a
  // patient standing still, not an end-of-range pose.
  const { W, H } = FRAMES.wide;
  const lms = toLandmarks(buildBody(W, H, { armElevDeg: 10 }), W, H);
  assertCloseTo(lms[13]!.x, 0.6012, 0.001, "resting left elbow x");
  assertCloseTo(correctedAbduction(lms, K_WIDE), 10, 0.06, "resting arm measured under correction");
});

test("the guard still rejects genuinely out-of-frame landmarks under correction", () => {
  const { W, H } = FRAMES.wide;
  const lms = toLandmarks(buildBody(W, H, { armElevDeg: 90 }), W, H);
  lms[13] = { x: 1.0001, y: lms[13]!.y, visibility: 1 };
  assertNull(correctedAbduction(lms, K_WIDE), "out-of-frame elbow still nulled under correction");
});

test("the correction does NOT fix the neckTilt halving — that is a separate defect", () => {
  // Recorded so nobody reads the fix as having addressed it. The halving comes
  // from `computeTiltReference` averaging the hip and ear lines, and it
  // reproduces in the square control, so it is not an aspect effect at all.
  const { W, H } = FRAMES.wide;
  const lms = toLandmarks(buildBody(W, H, { neckTiltDeg: 2 }), W, H);
  assertCloseTo(correctedNeckTilt(lms, K_WIDE), 1.0, 0.06, "corrected neckTilt @ true 2 still halved");
});

test("scapularElevation stays invariant under correction with a vertical trunk", () => {
  const sq = FRAMES.square;
  const wd = FRAMES.wide;
  const sqLms = toLandmarks(buildBody(sq.W, sq.H, { neckTiltDeg: 3 }), sq.W, sq.H);
  const wdLms = toLandmarks(buildBody(wd.W, wd.H, { neckTiltDeg: 3 }), wd.W, wd.H);
  const sqVal = computeScapularElevation(sqLms, computeTiltReference(sqLms), "left");
  const wdVal = computeScapularElevation(wdLms, computeTiltReference(wdLms, K_WIDE), "left", K_WIDE);
  if (sqVal === null || wdVal === null) throw new Error("expected a scapular value");
  assertCloseTo(wdVal, sqVal, 1e-9, "corrected scapularElevation matches the square control");
});

// ─────────────────────────────────────────────────────────────────────────────
// J — THE REST OF THE CHANGED SURFACE.
//
//     Sections A–I cover the line-angle metrics and one vertical-trunk scapular
//     case. The correction also touches three further trunk-projection metrics
//     and the registry-aware entry point, and the eventual live switch depends
//     on the frozen-tilt override staying consistent. Those are exercised here
//     so no corrected branch ships untested.
// ─────────────────────────────────────────────────────────────────────────────

console.log("\nJ — remaining corrected paths: projections, entry point, frozen tilt");

// A LEAN is deliberate in the two tests below. With a perfectly vertical trunk
// the trunk-up axis has no x-component, so the x-scaling the correction applies
// cancels out of the projection entirely and the test cannot tell a corrected
// implementation from an uncorrected one. Leaning the body gives the axis an
// x-component, which is what makes `frameAspect` observable at all here.
//
// The arm angles are also chosen to keep every landmark inside [0,1] on BOTH
// frames, because a null would otherwise be the thing under test rather than
// the value. Nulls are now failures, never skips.

test("wristShoulderVertical: corrected path matches the square control UNDER LEAN", () => {
  const { W, H } = FRAMES.wide;
  // squareRoomy, not square: a leaning body puts the wrist outside a 720-wide
  // square frame, and a null control would fail rather than silently skip.
  const sq = FRAMES.squareRoomy;
  for (const trunkLeanDeg of [0, 8, -8]) {
    for (const armElevDeg of [10, 45]) {
      const wd = toLandmarks(buildBody(W, H, { armElevDeg, trunkLeanDeg }), W, H);
      const sqL = toLandmarks(buildBody(sq.W, sq.H, { armElevDeg, trunkLeanDeg }), sq.W, sq.H);
      const a = requireFinite(
        computeWristShoulderVertical(wd, computeTiltReference(wd, K_WIDE), "left", K_WIDE),
        `corrected wristShoulderVertical @ arm ${armElevDeg}, lean ${trunkLeanDeg}`,
      );
      const b = requireFinite(
        computeWristShoulderVertical(sqL, computeTiltReference(sqL), "left"),
        `square control wristShoulderVertical @ arm ${armElevDeg}, lean ${trunkLeanDeg}`,
      );
      assertCloseTo(a, b, 1e-9, `wristShoulderVertical @ arm ${armElevDeg}, lean ${trunkLeanDeg}`);
    }
  }
});

test("wristShoulderVertical: the UNCORRECTED wide reading differs under lean", () => {
  // Guards the test above against being vacuous: if corrected and uncorrected
  // agreed here, matching the square control would prove nothing.
  const { W, H } = FRAMES.wide;
  const lms = toLandmarks(buildBody(W, H, { armElevDeg: 45, trunkLeanDeg: 8 }), W, H);
  const plain = requireFinite(
    computeWristShoulderVertical(lms, computeTiltReference(lms), "left"),
    "uncorrected wristShoulderVertical",
  );
  const fixed = requireFinite(
    computeWristShoulderVertical(lms, computeTiltReference(lms, K_WIDE), "left", K_WIDE),
    "corrected wristShoulderVertical",
  );
  assertEqual(
    Math.abs(plain - fixed) > 1e-6,
    true,
    `frameAspect must change the result under lean (plain ${plain}, fixed ${fixed})`,
  );
});

test("wristShoulderLateral: corrected path matches the square control UNDER LEAN", () => {
  const { W, H } = FRAMES.wide;
  const sq = FRAMES.squareRoomy;
  for (const trunkLeanDeg of [0, 8]) {
    const wd = toLandmarks(buildBody(W, H, { armElevDeg: 30, trunkLeanDeg }), W, H);
    const sqL = toLandmarks(buildBody(sq.W, sq.H, { armElevDeg: 30, trunkLeanDeg }), sq.W, sq.H);
    const a = requireFinite(
      computeWristShoulderLateral(wd, computeTiltReference(wd, K_WIDE), "left", K_WIDE),
      `corrected wristShoulderLateral @ lean ${trunkLeanDeg}`,
    );
    const b = requireFinite(
      computeWristShoulderLateral(sqL, computeTiltReference(sqL), "left"),
      `square control wristShoulderLateral @ lean ${trunkLeanDeg}`,
    );
    assertCloseTo(a, b, 1e-9, `wristShoulderLateral @ lean ${trunkLeanDeg}`);
  }
  // Non-vacuity: uncorrected must differ.
  const lms = toLandmarks(buildBody(W, H, { armElevDeg: 30, trunkLeanDeg: 8 }), W, H);
  const plain = requireFinite(
    computeWristShoulderLateral(lms, computeTiltReference(lms), "left"),
    "uncorrected wristShoulderLateral",
  );
  const fixed = requireFinite(
    computeWristShoulderLateral(lms, computeTiltReference(lms, K_WIDE), "left", K_WIDE),
    "corrected wristShoulderLateral",
  );
  assertEqual(Math.abs(plain - fixed) > 1e-6, true, "frameAspect must change wristShoulderLateral under lean");
});

test("shoulderElbowDistance: uncorrected reads SHORT on a wide frame, corrected does not", () => {
  // The upper arm is near-horizontal at a T-pose, so the uncorrected normalized
  // length is squashed by 1/k. This is the one projection metric where the
  // correction changes the answer materially even with a vertical trunk.
  const { W, H } = FRAMES.wide;
  const sq = FRAMES.square;
  const wd = toLandmarks(buildBody(W, H, { armElevDeg: 90 }), W, H);
  const sqL = toLandmarks(buildBody(sq.W, sq.H, { armElevDeg: 90 }), sq.W, sq.H);
  const plain = computeShoulderElbowDistance(wd, computeTiltReference(wd), "left");
  const fixed = computeShoulderElbowDistance(wd, computeTiltReference(wd, K_WIDE), "left", K_WIDE);
  const control = computeShoulderElbowDistance(sqL, computeTiltReference(sqL), "left");
  if (plain === null || fixed === null || control === null) throw new Error("expected distances");
  assertEqual(plain < control, true, "uncorrected wide reads shorter than the square control");
  assertCloseTo(fixed, control, 1e-9, "corrected wide matches the square control");
});

test("computePoseMetricsForExercise threads the aspect to every metric it dispatches", () => {
  const def = getExerciseDefinition("ex_001");
  if (!def) throw new Error("ex_001 must exist in the registry");
  const { W, H } = FRAMES.wide;
  const lms = toLandmarks(buildBody(W, H, { armElevDeg: 80, shoulderTiltDeg: 4 }), W, H);

  const plain = computePoseMetricsForExercise(lms, def);
  const fixed = computePoseMetricsForExercise(lms, def, undefined, K_WIDE);

  // The primary is shoulderAbduction: true 80 reads 72.6 uncorrected, 80 corrected.
  assertCloseTo(plain.perSideMetrics?.left ?? null, 72.6, 0.06, "entry point, uncorrected primary");
  assertCloseTo(fixed.perSideMetrics?.left ?? null, 80.0, 0.06, "entry point, corrected primary");
  // And the tilt reference it resolved must itself be in the corrected space.
  assertCloseTo(
    fixed.tiltReference.cameraTiltDeg,
    computeTiltReference(lms, K_WIDE).cameraTiltDeg,
    1e-9,
    "entry point resolves its own tilt at the same aspect",
  );
});

test("ENTRY POINT: COMPENSATIONS are corrected too, not just the primary", () => {
  // Asserting only the primary let a mutation that dropped `frameAspect` from
  // all three compensation-dispatch calls pass the whole suite (found by review
  // mutation testing, 2026-09-06). A corrected primary alongside uncorrected
  // compensations is exactly the mixed-channel state the live switch must not
  // reach, so each compensation is now pinned against an independent
  // square-frame control computed through the metric functions directly.
  const def = getExerciseDefinition("ex_001");
  if (!def) throw new Error("ex_001 must exist in the registry");
  const sq = FRAMES.square;
  const { W, H } = FRAMES.wide;
  // Non-zero on every ex_001 compensation channel: shoulder tilt, a leaning
  // trunk, and a neck tilt that moves scapular elevation.
  const shape = { armElevDeg: 80, shoulderTiltDeg: 5, trunkLeanDeg: 7, neckTiltDeg: 6 };

  const wide = toLandmarks(buildBody(W, H, shape), W, H);
  const square = toLandmarks(buildBody(sq.W, sq.H, shape), sq.W, sq.H);

  const fixed = computePoseMetricsForExercise(wide, def, undefined, K_WIDE);
  const control = computePoseMetricsForExercise(square, def);
  const plain = computePoseMetricsForExercise(wide, def);

  let checked = 0;
  for (const comp of def.compensationMetrics) {
    const got = fixed.metrics[comp.name];
    const want = control.metrics[comp.name];
    const uncorrected = plain.metrics[comp.name];
    if (typeof want !== "number") continue; // channel unavailable in this pose
    checked += 1;
    assertCloseTo(
      typeof got === "number" ? got : null,
      want,
      0.06,
      `corrected ${comp.name} must match the square control`,
    );
    // And it must actually have been corrected — otherwise the assertion above
    // could pass on an implementation that ignores frameAspect entirely.
    if (typeof uncorrected === "number" && Math.abs(uncorrected - want) < 1e-6) {
      throw new Error(
        `${comp.name}: uncorrected already equals the control, so this fixture cannot detect a dropped frameAspect`,
      );
    }
  }
  assertEqual(checked >= 2, true, `expected at least 2 comparable compensation channels, checked ${checked}`);
});

test("ENTRY POINT: the isometric and bidirectional dispatch branches are corrected", () => {
  // Three different code paths inside computePoseMetricsForExercise pick the
  // primary — dynamic per-limb, isometric per-limb, and bidirectional. Only the
  // first was covered.
  const { W, H } = FRAMES.wide;
  const sq = FRAMES.square;

  // ex_006: isometric, per-limb, primary shoulderHorizAbduction.
  const iso = getExerciseDefinition("ex_006");
  if (!iso) throw new Error("ex_006 must exist in the registry");
  const isoShape = { armElevDeg: 80 };
  const isoFixed = computePoseMetricsForExercise(
    toLandmarks(buildBody(W, H, isoShape), W, H), iso, undefined, K_WIDE,
  );
  const isoControl = computePoseMetricsForExercise(
    toLandmarks(buildBody(sq.W, sq.H, isoShape), sq.W, sq.H), iso,
  );
  assertCloseTo(
    isoFixed.perSideMetrics?.left ?? null,
    requireFinite(isoControl.perSideMetrics?.left ?? null, "ex_006 square control"),
    0.06,
    "ex_006 isometric primary corrected",
  );

  // ex_005: bidirectional-alternating, primary trunkLateralFlexion.
  const bidi = getExerciseDefinition("ex_005");
  if (!bidi) throw new Error("ex_005 must exist in the registry");
  const bidiShape = { trunkLeanDeg: 10 };
  const bidiFixed = computePoseMetricsForExercise(
    toLandmarks(buildBody(W, H, bidiShape), W, H), bidi, undefined, K_WIDE,
  );
  const bidiControl = computePoseMetricsForExercise(
    toLandmarks(buildBody(sq.W, sq.H, bidiShape), sq.W, sq.H), bidi,
  );
  const bidiPlain = computePoseMetricsForExercise(
    toLandmarks(buildBody(W, H, bidiShape), W, H), bidi,
  );
  const want = requireFinite(bidiControl.metrics.trunkLateralFlexion ?? null, "ex_005 square control");
  assertCloseTo(
    bidiFixed.metrics.trunkLateralFlexion ?? null, want, 0.06,
    "ex_005 bidirectional primary corrected",
  );
  const plainVal = requireFinite(bidiPlain.metrics.trunkLateralFlexion ?? null, "ex_005 uncorrected");
  assertEqual(
    Math.abs(plainVal - want) > 1e-6, true,
    "the ex_005 fixture must distinguish corrected from uncorrected",
  );
});

test("a frozen tilt override is used verbatim and is NOT re-derived", () => {
  // The camera freezes a neutral tilt at calibration and passes it back in. The
  // entry point must honour it exactly, because re-deriving per frame is the
  // behaviour the frozen-neutral contract exists to prevent.
  const def = getExerciseDefinition("ex_001");
  if (!def) throw new Error("ex_001 must exist in the registry");
  const { W, H } = FRAMES.wide;
  const lms = toLandmarks(buildBody(W, H, { armElevDeg: 80, cameraRollDeg: 6 }), W, H);
  const frozen = { cameraTiltDeg: 1.234, confidence: "high" as const, divergenceDeg: null };
  const out = computePoseMetricsForExercise(lms, def, frozen, K_WIDE);
  assertCloseTo(out.tiltReference.cameraTiltDeg, 1.234, 1e-12, "override passed through untouched");
});

test("SWITCH-OVER HAZARD: a tilt frozen at aspect 1 does not match corrected geometry", () => {
  // Pins the trap rather than fixing it. The live loop currently computes its
  // neutral tilt with no aspect. If the correction is enabled for the metrics
  // but that frozen tilt is still captured uncorrected, a horizontal-reference
  // tilt is subtracted from corrected geometry and the two disagree. The live
  // switch has to move BOTH together; this test fails loudly if someone wires
  // only one side.
  const { W, H } = FRAMES.wide;
  const lms = toLandmarks(buildBody(W, H, { cameraRollDeg: 6 }), W, H);
  const staleTilt = computeTiltReference(lms);            // captured uncorrected
  const properTilt = computeTiltReference(lms, K_WIDE);   // captured corrected
  const gap = Math.abs(staleTilt.cameraTiltDeg - properTilt.cameraTiltDeg);
  assertEqual(
    gap > 1,
    true,
    `a stale uncorrected tilt differs from the corrected one by ${gap.toFixed(2)}deg — ` +
      `they are not interchangeable and must be switched together`,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n  ${testsPassed} passed, ${testsFailed} failed\n`);
process.exit(testsFailed > 0 ? 1 : 0);
