/**
 * Pins the LOWER cue's resting shoulder reference (D-47): the resting line is
 * the median shoulder line over the calibration's samples, and the cue's
 * reading is the shoulder line against it, in computeShoulderSymmetry's form.
 * The coaching configuration records the reference.
 *
 *   npx tsx src/lib/pose/shoulderRestReference.test.ts
 */
import { coachingConfiguration, validCoachingProvenance, COACHING_ALGORITHM_VERSION } from "./coachingConfig";
import { computeShoulderSymmetry, shoulderLineAngleDeg, NO_ASPECT_CORRECTION } from "./poseMetrics";
import { SHOULDER_CUE_REFERENCE, restReferencedShoulderSymmetry, restingShoulderLineDeg } from "./shoulderRestReference";
import { EXERCISE_REGISTRY } from "../exercises/registry";

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`      ${err instanceof Error ? err.message : String(err)}`);
    failed += 1;
  }
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** Shoulders 0.2 apart whose line (landmark 12 to 11) is tilted by `deg`. */
function shoulders(deg: number, visibility = 1) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }));
  const half = (0.2 * Math.tan((deg * Math.PI) / 180)) / 2;
  lm[11] = { x: 0.6, y: 0.35 + half, visibility };
  lm[12] = { x: 0.4, y: 0.35 - half, visibility };
  return lm;
}

console.log("\nLOWER cue: resting shoulder reference\n");

test("the raw shoulder line has the sign computeShoulderSymmetry corrects", () => {
  const line = shoulderLineAngleDeg(shoulders(6), NO_ASPECT_CORRECTION);
  assert(line !== null && Math.abs(line - 6) < 1e-9, `line ${line}`);
  const sym = computeShoulderSymmetry(shoulders(6), { cameraTiltDeg: 0, confidence: "high", divergenceDeg: null }, NO_ASPECT_CORRECTION);
  assert(sym?.angleDeg === 6 && sym.elevatedSide === "right", JSON.stringify(sym));
  assert(shoulderLineAngleDeg(shoulders(6, 0.2), NO_ASPECT_CORRECTION) === null, "hidden shoulders give none");
});

test("the resting line is the median over the calibration's samples", () => {
  const samples = [shoulders(-5), shoulders(-6), shoulders(-7), shoulders(-6.2), shoulders(30, 0.1)]
    .map((landmarks) => ({ landmarks, frameAspect: NO_ASPECT_CORRECTION }));
  const rest = restingShoulderLineDeg(samples);
  assert(rest !== null && Math.abs(rest - -6.1) < 1e-9, `rest ${rest}`);
  assert(restingShoulderLineDeg([]) === null, "no samples: none");
});

test("each sample is read in its own frame's corrected plane (D-48)", () => {
  // On a 16:9 frame a line reading 6 in normalized units is atan(tan 6 / k) in the picture.
  const rest = restingShoulderLineDeg([{ landmarks: shoulders(6), frameAspect: 16 / 9 }]);
  const expected = (Math.atan(Math.tan((6 * Math.PI) / 180) / (16 / 9)) * 180) / Math.PI;
  assert(rest !== null && Math.abs(rest - expected) < 1e-9, `rest ${rest} expected ${expected}`);
});

test("against the resting line, a still body reads 0 and only the change counts", () => {
  const still = restReferencedShoulderSymmetry(shoulders(-6), -6, NO_ASPECT_CORRECTION);
  assert(still !== null && still.angleDeg === 0 && still.elevatedSide === "level", JSON.stringify(still));
  const raised = restReferencedShoulderSymmetry(shoulders(-15), -6, NO_ASPECT_CORRECTION);
  assert(raised !== null && raised.angleDeg === 9 && raised.elevatedSide === "left", JSON.stringify(raised));
  assert(restReferencedShoulderSymmetry(shoulders(-6), null, NO_ASPECT_CORRECTION) === null, "no resting line: none");
});

test("the coaching configuration records the reference and stays valid", () => {
  assert(COACHING_ALGORITHM_VERSION === "coaching_v13_aspect_corrected", COACHING_ALGORITHM_VERSION);
  const configuration = coachingConfiguration(EXERCISE_REGISTRY.ex_004);
  assert(configuration.shoulderReference === SHOULDER_CUE_REFERENCE, "recorded");
  const version = `sha256:${"0".repeat(64)}`;
  assert(validCoachingProvenance({ version, configuration }), "valid");
  const older: Record<string, unknown> = { ...configuration };
  delete older.shoulderReference;
  assert(validCoachingProvenance({ version, configuration: older }), "a configuration from before the reference stays valid");
  assert(!validCoachingProvenance({ version, configuration: { ...configuration, shoulderReference: "other" } }), "an unknown reference is not");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exitCode = 1;
