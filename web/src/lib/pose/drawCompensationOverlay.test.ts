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
import { computeShoulderSymmetry, type TiltReference, NO_ASPECT_CORRECTION } from "./poseMetrics";

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
    const reading = computeShoulderSymmetry(lm, LEVEL_CAMERA, NO_ASPECT_CORRECTION);
    if (reading === null) throw new Error("no shoulder reading");
    assertEq(elevatedShoulderLandmarkIndex(reading.elevatedSide), expected, `elevated ${expected}`);
    assertEq(higherShoulderLandmarkIndex(lm), expected, `higher on screen ${expected}`);
  }
  assertEq(elevatedShoulderLandmarkIndex("level"), null, "level names no shoulder");
});

test("the arrow keeps its shoulder unless the other reads above the switch-off level", () => {
  const otherHigher = seenShoulders(0.37, 0.33); // 12 higher: about 11 on the reading
  const reading = computeShoulderSymmetry(otherHigher, LEVEL_CAMERA, NO_ASPECT_CORRECTION);
  if (reading === null) throw new Error("no shoulder reading");
  assertEq(lowerArrowShoulder(null, otherHigher, null, 5), 12, "first pick: the higher shoulder");
  assertEq(lowerArrowShoulder(11, otherHigher, reading, 5), 12, "a clear reversal moves the arrow");
  assertEq(lowerArrowShoulder(11, otherHigher, reading, reading.angleDeg), 11, "at the switch-off level it stays");
  assertEq(lowerArrowShoulder(11, otherHigher, { angleDeg: 9, elevatedSide: "level" }, 5), 11, "a level reading never moves it");
  assertEq(lowerArrowShoulder(11, otherHigher, null, 5), 11, "no reading keeps it");
  const slightlyOther = seenShoulders(0.355, 0.345); // 12 higher by under 3
  const small = computeShoulderSymmetry(slightlyOther, LEVEL_CAMERA, NO_ASPECT_CORRECTION);
  assertEq(lowerArrowShoulder(11, slightlyOther, small, 5), 11, "a small reversal keeps it");
});

test("only limb-sided warnings take their arm side as the overlay direction", () => {
  assertEq(limbSideIsOverlayDirection("trunkLean"), false, "trunk lean keeps its lean direction");
  assertEq(limbSideIsOverlayDirection("neckTilt"), false, "neck tilt keeps its lean direction");
  assertEq(limbSideIsOverlayDirection("scapularElevation"), true, "a shrug is per arm");
  assertEq(limbSideIsOverlayDirection("elbowFlexion"), true, "an elbow is per arm");
});

// ─────────────────────────────────────────────────────────────────────────────
// drawCompensationOverlay — the past-shoulder-height cue is drawn on its arm
// ─────────────────────────────────────────────────────────────────────────────

/** A 2D context stand-in that records the drawing calls it gets; text widths are fixed. */
function recordingContext(): { ctx: CanvasRenderingContext2D; calls: { name: string; args: unknown[] }[] } {
  const calls: { name: string; args: unknown[] }[] = [];
  const state: Record<string | symbol, unknown> = {
    measureText: (s: string) => ({ width: s.length * 10 }),
  };
  const ctx = new Proxy(state, {
    get: (target, prop) => (prop in target ? target[prop] : (...args: unknown[]) => { calls.push({ name: String(prop), args }); }),
    set: (target, prop, value) => { target[prop] = value; return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

function assertPoint(actual: unknown[] | null | undefined, x: number, y: number, label: string): void {
  if (!actual || Math.abs(Number(actual[0]) - x) > 1e-6 || Math.abs(Number(actual[1]) - y) > 1e-6) {
    throw new Error(`${label}: expected (${x}, ${y}), got ${JSON.stringify(actual)}`);
  }
}

/** Both arms raised in a 1000 x 1000 picture: the left arm (11, 13, 15) on the image's right. */
function raisedArms(rightWristY: number): NormalizedLandmark[] {
  const at = (x: number, y: number): NormalizedLandmark => ({ x, y, z: 0, visibility: 1 });
  const lm: NormalizedLandmark[] = [];
  lm[11] = at(0.60, 0.40); lm[13] = at(0.75, 0.30); lm[15] = at(0.90, 0.20);
  lm[12] = at(0.40, 0.40); lm[14] = at(0.25, 0.30); lm[16] = at(0.10, rightWristY);
  return lm;
}

test("the past-shoulder-height cue is drawn around its own arm, wherever the other wrist goes", () => {
  const specs: CompensationMetricSpec[] = [{ name: "overRaise", warningThreshold: 115 }];
  const active = new Set<MetricName>(["overRaise"]);
  const draw = (side: "left" | "right" | undefined, rightWristY: number) => {
    const { ctx, calls } = recordingContext();
    const rendered = drawCompensationOverlay(
      ctx, raisedArms(rightWristY), 1000, 1000, specs, { overRaise: 120 },
      side === undefined ? {} : { overRaise: side }, active, { mirroredDisplay: false },
    );
    return {
      direction: rendered[0]?.direction,
      label: calls.find((c) => c.name === "fillText")?.args.slice(1),
      boxStart: calls.find((c) => c.name === "moveTo")?.args,
      arrowLines: calls.filter((c) => c.name === "lineTo").length,
    };
  };
  // The left arm spans x 600-900 and y 200-400; its box is padded 12 px each way,
  // and the label sits 4 px above the box.
  const left = draw("left", 0.15);
  assertEq(left.direction, "left", "left: the recorded side");
  assertPoint(left.label, 750, 184, "left: label centred above the left arm");
  assertPoint(left.boxStart, 598, 188, "left: box around the left arm");
  assertEq(left.arrowLines, 0, "left: no arrow");
  assertPoint(draw("left", 0.05).label, 750, 184, "left: the right wrist rising does not move it");
  // The right arm spans x 100-400 and its wrist sits at y 150.
  assertPoint(draw("right", 0.15).label, 250, 134, "right: label centred above the right arm");
  // With no side recorded, the box spans both wrists, as before.
  const none = draw(undefined, 0.15);
  assertEq(none.direction, null, "no side: none recorded");
  assertPoint(none.label, 500, 134, "no side: label between the wrists");
});

// ─────────────────────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n  ${testsPassed} passed, ${testsFailed} failed\n`);
process.exit(testsFailed === 0 ? 0 : 1);
