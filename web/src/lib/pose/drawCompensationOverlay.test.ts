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

import {
  anatomicalSideScreenDirX,
  higherShoulderLandmarkIndex,
} from "./drawCompensationOverlay";

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
// SUMMARY
// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n  ${testsPassed} passed, ${testsFailed} failed\n`);
process.exit(testsFailed === 0 ? 0 : 1);
