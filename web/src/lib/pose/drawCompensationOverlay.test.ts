/**
 * drawCompensationOverlay.test.ts
 *
 * Pins the two pure direction helpers behind the compensation overlay's new
 * directional correction cues. The canvas rendering itself isn't unit-tested
 * (it needs a real 2D context); these helpers carry the mirroring-sensitive
 * logic that's easy to get backwards.
 *
 * USAGE
 * ─────
 *   npx tsx web/src/lib/pose/drawCompensationOverlay.test.ts
 *
 * Same minimal-deps style as `peakRelevantGating.test.ts` — no test framework,
 * just inline assertion helpers.
 *
 * WHY THESE MATTER
 * ────────────────
 * Front-camera mirroring: MediaPipe landmark 11 sits on the patient's anatomical
 * RIGHT shoulder, landmark 12 on their LEFT. Arrows are drawn in RAW canvas
 * space and then flipped with the body by the wrapper's CSS `scaleX(-1)`, so a
 * direction expressed in raw-x stays visually correct. `anatomicalSideScreenDirX`
 * converts an anatomical side into that raw-x sign using the live landmark x of
 * 11 vs 12, so it must stay correct for BOTH possible orderings of those x's.
 */

import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { CompensationMetricSpec, MetricName } from "@/lib/exercises/registry";
import {
  anatomicalSideScreenDirX,
  drawCompensationOverlay,
  elevatedShoulderLandmarkIndex,
  higherShoulderLandmarkIndex,
  limbSideIsOverlayDirection,
  lowerArrowShoulder,
} from "./drawCompensationOverlay";
import { computeShoulderSymmetry, type TiltReference } from "./poseMetrics";

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

function assertEq(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

/** Build a sparse landmark array with only shoulder x's set (only 11/12 used). */
function shoulders(x11: number, x12: number): { x: number }[] {
  const lm: { x: number }[] = [];
  lm[11] = { x: x11 }; // patient's RIGHT shoulder
  lm[12] = { x: x12 }; // patient's LEFT shoulder
  return lm;
}

// ─────────────────────────────────────────────────────────────────────────────
// anatomicalSideScreenDirX — patient RIGHT shoulder = lm11, LEFT = lm12
// ─────────────────────────────────────────────────────────────────────────────

test("ordering A (right at smaller raw-x): toward right is −x, toward left is +x", () => {
  // lm11 (patient right) at 0.30, lm12 (patient left) at 0.70.
  const lm = shoulders(0.30, 0.70);
  assertEq(anatomicalSideScreenDirX("right", lm), -1, "toward patient right");
  assertEq(anatomicalSideScreenDirX("left", lm), 1, "toward patient left");
});

test("ordering B (right at larger raw-x): toward right is +x, toward left is −x", () => {
  // lm11 (patient right) at 0.70, lm12 (patient left) at 0.30.
  const lm = shoulders(0.70, 0.30);
  assertEq(anatomicalSideScreenDirX("right", lm), 1, "toward patient right");
  assertEq(anatomicalSideScreenDirX("left", lm), -1, "toward patient left");
});

test("missing landmarks default to 0 and resolve deterministically", () => {
  // No shoulder landmarks: both default to 0 → targetX >= otherX is true → +1.
  assertEq(anatomicalSideScreenDirX("right", []), 1, "right with no landmarks");
  assertEq(anatomicalSideScreenDirX("left", []), 1, "left with no landmarks");
});

// ─────────────────────────────────────────────────────────────────────────────
// higherShoulderLandmarkIndex — the higher-on-screen shoulder is the one to lower
// ─────────────────────────────────────────────────────────────────────────────

/** Build a sparse landmark array with only shoulder y's set (only 11/12 used). */
function shoulderYs(y11: number, y12: number): { y: number }[] {
  const lm: { y: number }[] = [];
  lm[11] = { y: y11 };
  lm[12] = { y: y12 };
  return lm;
}

test("landmark 11 higher (smaller y) → 11 is the elevated shoulder", () => {
  // y increases downward, so the smaller y is higher on screen.
  assertEq(higherShoulderLandmarkIndex(shoulderYs(0.30, 0.45)), 11, "11 higher");
});

test("landmark 12 higher (smaller y) → 12 is the elevated shoulder", () => {
  assertEq(higherShoulderLandmarkIndex(shoulderYs(0.45, 0.30)), 12, "12 higher");
});

test("missing landmarks resolve deterministically (default Infinity)", () => {
  assertEq(higherShoulderLandmarkIndex([]), 11, "both missing → 11");
});

// ─────────────────────────────────────────────────────────────────────────────
// drawCompensationOverlay — a locked shoulder keeps the LOWER cue in place
// ─────────────────────────────────────────────────────────────────────────────

/** A 2D context stand-in: every drawing call is a no-op; text widths are fixed. */
function fakeContext(): CanvasRenderingContext2D {
  const state: Record<string | symbol, unknown> = {
    measureText: (s: string) => ({ width: s.length * 10 }),
  };
  return new Proxy(state, {
    get: (target, prop) => (prop in target ? target[prop] : () => undefined),
    set: (target, prop, value) => { target[prop] = value; return true; },
  }) as unknown as CanvasRenderingContext2D;
}

test("the LOWER cue follows a locked shoulder, else the higher one", () => {
  const lm: NormalizedLandmark[] = [];
  lm[11] = { x: 0.4, y: 0.30, z: 0, visibility: 1 }; // higher on screen
  lm[12] = { x: 0.6, y: 0.45, z: 0, visibility: 1 };
  const specs: CompensationMetricSpec[] = [{ name: "shoulderSymmetry", warningThreshold: 5 }];
  const active = new Set<MetricName>(["shoulderSymmetry"]);
  const draw = (lockedIndex?: 11 | 12) => drawCompensationOverlay(
    fakeContext(), lm, 1280, 720, specs, { shoulderSymmetry: 8 }, {}, active,
    lockedIndex === undefined ? {} : { shoulderElevatedIndex: lockedIndex },
  );
  assertEq(draw()[0]?.direction, "right", "unlocked: the higher shoulder (11)");
  assertEq(draw(12)[0]?.direction, "left", "locked to 12 although 11 is higher");
  assertEq(draw(11)[0]?.direction, "right", "locked to 11");
});

// ─────────────────────────────────────────────────────────────────────────────
// lowerArrowShoulder — the LOWER arrow moves only on a clear reversal
// ─────────────────────────────────────────────────────────────────────────────

const LEVEL_CAMERA: TiltReference = { cameraTiltDeg: 0, confidence: "high", divergenceDeg: 0 };

/** Shoulders as the camera sees them: 11 on the image's right, as in the app. */
function seenShoulders(y11: number, y12: number): NormalizedLandmark[] {
  const lm: NormalizedLandmark[] = [];
  lm[11] = { x: 0.6, y: y11, z: 0, visibility: 1 };
  lm[12] = { x: 0.4, y: y12, z: 0, visibility: 1 };
  return lm;
}

test("the tilt-corrected reading names the same shoulder as raw image height", () => {
  for (const [y11, y12, expected] of [[0.33, 0.37, 11], [0.37, 0.33, 12]] as const) {
    const lm = seenShoulders(y11, y12);
    const reading = computeShoulderSymmetry(lm, LEVEL_CAMERA);
    if (reading === null) throw new Error("no shoulder reading");
    assertEq(elevatedShoulderLandmarkIndex(reading.elevatedSide), expected, `elevated ${expected}`);
    assertEq(higherShoulderLandmarkIndex(lm), expected, `higher on screen ${expected}`);
  }
  assertEq(elevatedShoulderLandmarkIndex("level"), null, "level names no shoulder");
});

test("the arrow keeps its shoulder unless the other reads above the switch-off level", () => {
  const otherHigher = seenShoulders(0.37, 0.33); // 12 higher: about 11 on the reading
  const reading = computeShoulderSymmetry(otherHigher, LEVEL_CAMERA);
  if (reading === null) throw new Error("no shoulder reading");
  assertEq(lowerArrowShoulder(null, otherHigher, null, 5), 12, "first pick: the higher shoulder");
  assertEq(lowerArrowShoulder(11, otherHigher, reading, 5), 12, "a clear reversal moves the arrow");
  assertEq(lowerArrowShoulder(11, otherHigher, reading, reading.angleDeg), 11, "at the switch-off level it stays");
  assertEq(lowerArrowShoulder(11, otherHigher, { angleDeg: 9, elevatedSide: "level" }, 5), 11, "a level reading never moves it");
  assertEq(lowerArrowShoulder(11, otherHigher, null, 5), 11, "no reading keeps it");
  const slightlyOther = seenShoulders(0.355, 0.345); // 12 higher by under 3
  const small = computeShoulderSymmetry(slightlyOther, LEVEL_CAMERA);
  assertEq(lowerArrowShoulder(11, slightlyOther, small, 5), 11, "a small reversal keeps it");
});

test("only limb-sided warnings take their arm side as the overlay direction", () => {
  assertEq(limbSideIsOverlayDirection("trunkLean"), false, "trunk lean keeps its lean direction");
  assertEq(limbSideIsOverlayDirection("neckTilt"), false, "neck tilt keeps its lean direction");
  assertEq(limbSideIsOverlayDirection("scapularElevation"), true, "a shrug is per arm");
  assertEq(limbSideIsOverlayDirection("elbowFlexion"), true, "an elbow is per arm");
});

// ─────────────────────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n  ${testsPassed} passed, ${testsFailed} failed\n`);
process.exit(testsFailed === 0 ? 0 : 1);
