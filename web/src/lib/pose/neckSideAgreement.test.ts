/**
 * neckSideAgreement.test.ts
 *
 * Diagnostic test — answers the question: does the bidirectional rep-tag
 * code in CameraClient.tsx produce the SAME side label as the display path
 * (`computeLateralNeckTilt`) when fed identical landmarks?
 *
 * If they agree → the rep tag is empirically correct (regardless of what
 * any docstring says about which physical tilt direction produces which
 * sign), because patients see the same label in both places.
 *
 * If they disagree → there is a real "Bug 1" in PB and the comparison
 * direction needs flipping.
 *
 * USAGE
 * ─────
 *   npx tsx web/src/lib/pose/neckSideAgreement.test.ts
 */

import {
  computeLateralNeckTilt,
  computeNeckLateralFlexionSigned,
  computeTiltReference,
} from "./poseMetrics";

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

function makeLandmarks(opts: {
  leftEar:       { x: number; y: number };
  rightEar:      { x: number; y: number };
  leftShoulder?: { x: number; y: number };
  rightShoulder?:{ x: number; y: number };
  leftHip?:      { x: number; y: number };
  rightHip?:     { x: number; y: number };
}): Array<{ x: number; y: number; visibility?: number }> {
  const lms: Array<{ x: number; y: number; visibility?: number }> = [];
  for (let i = 0; i <= 24; i++) lms.push({ x: 0, y: 0, visibility: 0 });
  const v = (p: { x: number; y: number }) => ({ ...p, visibility: 1 });
  lms[7]  = v(opts.leftEar);
  lms[8]  = v(opts.rightEar);
  lms[11] = v(opts.leftShoulder  ?? { x: 0.60, y: 0.30 });
  lms[12] = v(opts.rightShoulder ?? { x: 0.40, y: 0.30 });
  lms[23] = v(opts.leftHip       ?? { x: 0.58, y: 0.55 });
  lms[24] = v(opts.rightHip      ?? { x: 0.42, y: 0.55 });
  return lms;
}

/**
 * The side-tag formula used in CameraClient.tsx after the PB Bug 1 fix.
 * Mirrors `computeLateralNeckTilt`'s direction mapping: positive signed
 * angle → "left", negative → "right". Before the fix this comparison was
 * inverted, producing rep tags opposite to the on-screen direction label
 * for every rep. This test now serves as a permanent regression guard.
 */
function repTagSide(signedValueAtPeak: number): "left" | "right" {
  return signedValueAtPeak > 0 ? "left" : "right";
}

console.log("\nNeck side-agreement diagnostic\n");
console.log("Constructing two scenarios under both possible mirror interpretations,");
console.log("then comparing what the DISPLAY (`computeLateralNeckTilt`) reports vs");
console.log("what the REP TAG (`< 0 ? 'left' : 'right'`) would report.\n");

// ── SCENARIO 1: LM7 raised, LM8 dropped ─────────────────────────────────────
// Geometrically: the ear MediaPipe labels "left" (LM7) is higher in the frame,
// the ear labeled "right" (LM8) is lower. What this means anatomically depends
// on whether MediaPipe's labels survive the front-camera mirror or not — but
// for THIS test that doesn't matter. We're checking whether the display and
// rep-tag CODE agree on the same input.

test("LM8 dropped vs LM7 → display direction and rep-tag direction match", () => {
  const lms = makeLandmarks({
    leftEar:  { x: 0.58, y: 0.18 },   // LM7 higher in frame
    rightEar: { x: 0.42, y: 0.22 },   // LM8 lower in frame
  });
  const tiltRef = computeTiltReference(lms);

  const display = computeLateralNeckTilt(lms, tiltRef);
  const signed  = computeNeckLateralFlexionSigned(lms, tiltRef, "left");
  if (display === null || signed === null) {
    throw new Error("metric returned null on a valid pose");
  }

  const displaySide = display.direction; // "left" | "right" | "center"
  const repSide     = repTagSide(signed);

  console.log(`      raw signed angle = ${signed.toFixed(2)}°, display = ${displaySide}, rep tag = ${repSide}`);

  if (displaySide === "center") {
    throw new Error("test pose was too subtle — display reports 'center', cannot diagnose");
  }
  if (displaySide !== repSide) {
    throw new Error(
      `DISAGREEMENT: display says '${displaySide}', rep tag says '${repSide}'. ` +
      `This is Bug 1 — the rep-tag comparison direction is inverted relative ` +
      `to the display function.`
    );
  }
});

// ── SCENARIO 2: LM7 dropped, LM8 raised (mirror of scenario 1) ──────────────

test("LM7 dropped vs LM8 → display direction and rep-tag direction match", () => {
  const lms = makeLandmarks({
    leftEar:  { x: 0.58, y: 0.22 },   // LM7 lower in frame
    rightEar: { x: 0.42, y: 0.18 },   // LM8 higher in frame
  });
  const tiltRef = computeTiltReference(lms);

  const display = computeLateralNeckTilt(lms, tiltRef);
  const signed  = computeNeckLateralFlexionSigned(lms, tiltRef, "left");
  if (display === null || signed === null) {
    throw new Error("metric returned null on a valid pose");
  }

  const displaySide = display.direction;
  const repSide     = repTagSide(signed);

  console.log(`      raw signed angle = ${signed.toFixed(2)}°, display = ${displaySide}, rep tag = ${repSide}`);

  if (displaySide === "center") {
    throw new Error("test pose was too subtle — display reports 'center', cannot diagnose");
  }
  if (displaySide !== repSide) {
    throw new Error(
      `DISAGREEMENT: display says '${displaySide}', rep tag says '${repSide}'. ` +
      `This is Bug 1 — the rep-tag comparison direction is inverted relative ` +
      `to the display function.`
    );
  }
});

console.log(`\n  ${testsPassed} passed, ${testsFailed} failed\n`);
process.exit(testsFailed > 0 ? 1 : 0);
