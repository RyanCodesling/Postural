/**
 * trunkSideAgreement.test.ts
 *
 * Diagnostic + regression test for ex_005 Standing Side Bends.
 *
 * ex_005's primary metric is `computeTrunkLateralFlexionSigned`, which measures
 * the HEAD's lateral lean relative to the hips (hip-midpoint → ear-midpoint line
 * vs vertical). This test pins:
 *
 *   1. SIGN/SIDE: the bidirectional rep tag (sign at peak, `> 0 ? "left" :
 *      "right"`) reflects the direction the patient bent. Cross-checked against
 *      `computeShoulderSymmetry` for a realistic bend (head + shoulders both
 *      move): the rep side must equal the side opposite the elevated shoulder.
 *
 *   2. SHOULDER-TILT REJECTION: tilting the shoulders while the head stays
 *      centered over the hips must read ~0° — that was the cheat live testing
 *      found with the previous shoulder-line metric (2026-05-25). A head-based
 *      metric ignores shoulder-girdle motion that doesn't move the head.
 *
 * USAGE
 * ─────
 *   npx tsx web/src/lib/pose/trunkSideAgreement.test.ts
 */

import {
  computeTrunkLateralFlexionFromNeutralSigned,
  computeTrunkLateralFlexionSigned,
  computeTrunkLateralFlexionUncorrectedSigned,
  computeShoulderSymmetry,
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

/**
 * Builds a landmark array from explicit ear / shoulder / hip positions. Ears
 * drive the head metric; shoulders are only needed for the computeShoulderSymmetry
 * cross-check. Defaults are a centered, level, upright pose.
 */
function makeLandmarks(opts: {
  leftEar?:      { x: number; y: number };
  rightEar?:     { x: number; y: number };
  leftShoulder?: { x: number; y: number };
  rightShoulder?:{ x: number; y: number };
  leftHip?:      { x: number; y: number };
  rightHip?:     { x: number; y: number };
}): Array<{ x: number; y: number; visibility?: number }> {
  const lms: Array<{ x: number; y: number; visibility?: number }> = [];
  for (let i = 0; i <= 24; i++) lms.push({ x: 0, y: 0, visibility: 0 });
  const v = (p: { x: number; y: number }) => ({ ...p, visibility: 1 });
  lms[7]  = v(opts.leftEar       ?? { x: 0.54, y: 0.20 });
  lms[8]  = v(opts.rightEar      ?? { x: 0.46, y: 0.20 });
  lms[11] = v(opts.leftShoulder  ?? { x: 0.60, y: 0.30 });
  lms[12] = v(opts.rightShoulder ?? { x: 0.40, y: 0.30 });
  lms[23] = v(opts.leftHip       ?? { x: 0.58, y: 0.55 });
  lms[24] = v(opts.rightHip      ?? { x: 0.42, y: 0.55 });
  return lms;
}

function repTagSide(signedValueAtPeak: number): "left" | "right" {
  return signedValueAtPeak > 0 ? "left" : "right";
}

function opposite(side: "left" | "right"): "left" | "right" {
  return side === "left" ? "right" : "left";
}

const LEVEL_HIPS = {
  leftHip:  { x: 0.58, y: 0.55 },
  rightHip: { x: 0.42, y: 0.55 },
};

console.log("\nTrunk side-agreement diagnostic (ex_005, head-lateral displacement)\n");

// ── SCENARIO 1: realistic bend with the head displaced toward image-right ────
test("bend (head image-right + shoulders tilted) → rep tag is opposite the elevated shoulder", () => {
  const lms = makeLandmarks({
    leftEar:  { x: 0.66, y: 0.20 },
    rightEar: { x: 0.58, y: 0.20 },   // ear-midpoint x = 0.62 (right of hip-mid 0.50)
    leftShoulder:  { x: 0.64, y: 0.40 }, // image-right shoulder dropped
    rightShoulder: { x: 0.42, y: 0.30 },
    ...LEVEL_HIPS,
  });
  const tiltRef = computeTiltReference(lms);

  const signed = computeTrunkLateralFlexionSigned(lms, tiltRef, "left");
  const sym = computeShoulderSymmetry(lms, tiltRef);
  if (signed === null || sym === null) throw new Error("metric returned null on a valid pose");
  if (Math.abs(signed) < 5) throw new Error(`pose too subtle (signed=${signed.toFixed(2)}°)`);
  if (sym.elevatedSide === "level") throw new Error("shoulder symmetry reports 'level' — pose too subtle");

  const repSide = repTagSide(signed);
  console.log(`      signed=${signed.toFixed(2)}°, repTag=${repSide}, elevated=${sym.elevatedSide}`);

  if (repSide !== opposite(sym.elevatedSide)) {
    throw new Error(
      `rep tag '${repSide}' is not the opposite of the elevated shoulder ` +
      `'${sym.elevatedSide}' — head-metric sign drifted from computeShoulderSymmetry.`,
    );
  }
});

// ── SCENARIO 2: mirror — head displaced toward image-left ────────────────────
test("bend (head image-left + shoulders tilted) → rep tag is opposite the elevated shoulder", () => {
  const lms = makeLandmarks({
    leftEar:  { x: 0.42, y: 0.20 },
    rightEar: { x: 0.34, y: 0.20 },   // ear-midpoint x = 0.38 (left of hip-mid 0.50)
    leftShoulder:  { x: 0.58, y: 0.30 },
    rightShoulder: { x: 0.36, y: 0.40 }, // image-left shoulder dropped
    ...LEVEL_HIPS,
  });
  const tiltRef = computeTiltReference(lms);

  const signed = computeTrunkLateralFlexionSigned(lms, tiltRef, "left");
  const sym = computeShoulderSymmetry(lms, tiltRef);
  if (signed === null || sym === null) throw new Error("metric returned null on a valid pose");
  if (Math.abs(signed) < 5) throw new Error(`pose too subtle (signed=${signed.toFixed(2)}°)`);
  if (sym.elevatedSide === "level") throw new Error("shoulder symmetry reports 'level' — pose too subtle");

  const repSide = repTagSide(signed);
  console.log(`      signed=${signed.toFixed(2)}°, repTag=${repSide}, elevated=${sym.elevatedSide}`);

  if (repSide !== opposite(sym.elevatedSide)) {
    throw new Error(
      `rep tag '${repSide}' is not the opposite of the elevated shoulder ` +
      `'${sym.elevatedSide}' — head-metric sign drifted from computeShoulderSymmetry.`,
    );
  }
});

// ── SCENARIO 3: the cheat — shoulders tilted, head CENTERED → ~0° ────────────
test("shoulder tilt with the head centered reads ~0° (rejects the shoulder-tilt cheat)", () => {
  const lms = makeLandmarks({
    // Head centered over the hips (ear-midpoint x = 0.50)...
    leftEar:  { x: 0.54, y: 0.20 },
    rightEar: { x: 0.46, y: 0.20 },
    // ...while the shoulders are tilted exactly as in scenario 1.
    leftShoulder:  { x: 0.64, y: 0.40 },
    rightShoulder: { x: 0.42, y: 0.30 },
    ...LEVEL_HIPS,
  });
  const tiltRef = computeTiltReference(lms);

  const signed = computeTrunkLateralFlexionSigned(lms, tiltRef, "left");
  if (signed === null) throw new Error("metric returned null on a valid pose");
  console.log(`      signed=${signed.toFixed(2)}° (expected ~0)`);

  if (Math.abs(signed) >= 2) {
    throw new Error(
      `shoulder tilt with a centered head produced ${signed.toFixed(2)}° — the ` +
      `head metric is still responding to shoulder-girdle motion.`,
    );
  }
});

test("off-frame ear with good visibility returns null, not an extrapolated head lean", () => {
  const lms = makeLandmarks({
    leftEar:  { x: 1.04, y: 0.20 },
    rightEar: { x: 0.96, y: 0.20 },
    leftShoulder:  { x: 0.64, y: 0.40 },
    rightShoulder: { x: 0.42, y: 0.30 },
    ...LEVEL_HIPS,
  });
  const tiltRef = computeTiltReference(lms);

  const signed = computeTrunkLateralFlexionSigned(lms, tiltRef, "left");
  console.log(`      signed=${signed === null ? "null" : signed.toFixed(2) + "°"} (expected null)`);

  if (signed !== null) {
    throw new Error(
      `off-frame ear produced ${signed.toFixed(2)}° — the metric accepted an ` +
      `extrapolated head landmark.`,
    );
  }
});

test("neutral baseline preserves head lean when per-frame hip tilt would cancel it", () => {
  const neutral = makeLandmarks({
    leftEar:  { x: 0.54, y: 0.20 },
    rightEar: { x: 0.46, y: 0.20 },
    ...LEVEL_HIPS,
  });
  const neutralUncorrected = computeTrunkLateralFlexionUncorrectedSigned(neutral);
  if (neutralUncorrected === null) throw new Error("neutral baseline returned null");

  const deg = Math.PI / 180;
  const pairAround = (
    mid: { x: number; y: number },
    halfLength: number,
    angleDeg: number,
  ) => {
    const dx = Math.cos(angleDeg * deg) * halfLength;
    const dy = Math.sin(angleDeg * deg) * halfLength;
    return {
      left: { x: mid.x + dx, y: mid.y + dy },
      right: { x: mid.x - dx, y: mid.y - dy },
    };
  };
  const hips = pairAround({ x: 0.50, y: 0.60 }, 0.08, 26);
  const ears = pairAround({ x: 0.61, y: 0.28 }, 0.04, 64);
  const bend = makeLandmarks({
    leftEar: ears.left,
    rightEar: ears.right,
    leftShoulder:  { x: 0.64, y: 0.40 },
    rightShoulder: { x: 0.42, y: 0.30 },
    leftHip: hips.left,
    rightHip: hips.right,
  });

  const perFrame = computeTrunkLateralFlexionSigned(
    bend,
    computeTiltReference(bend),
    "left",
  );
  const fixedNeutral = computeTrunkLateralFlexionFromNeutralSigned(
    bend,
    neutralUncorrected,
  );
  if (perFrame === null || fixedNeutral === null) {
    throw new Error("valid bend returned null");
  }
  console.log(
    `      per-frame=${perFrame.toFixed(2)}°, fixed-neutral=${fixedNeutral.toFixed(2)}°`,
  );

  if (Math.abs(perFrame) >= 15) {
    throw new Error(
      `test setup invalid: per-frame tilt correction did not cancel (${perFrame.toFixed(2)}°)`,
    );
  }
  if (Math.abs(fixedNeutral) < 15) {
    throw new Error(
      `fixed neutral baseline failed to preserve the bend (${fixedNeutral.toFixed(2)}°)`,
    );
  }
});

console.log(`\n  ${testsPassed} passed, ${testsFailed} failed\n`);
process.exit(testsFailed > 0 ? 1 : 0);
