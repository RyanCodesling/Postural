/**
 * neckCalibrationReference.test.ts
 *
 * ex_004 counts from the ear line frozen in the neutral calibration (D-49):
 * the pure pieces, the measurement version, and the camera's own calibration
 * and trace code run from CameraClient's source. The counting itself, through
 * the camera loop, is in neckLateralFlexionCounting.test.ts.
 *
 *   npx tsx src/lib/pose/neckCalibrationReference.test.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import vm from "node:vm";
import { EXERCISE_REGISTRY, type ExerciseDefinition } from "../exercises/registry";
import { EXERCISE_CONFIG_VERSIONS, exerciseVersionPayload, sha256Version } from "../exercises/versioning";
import { countsFromCalibrationEarLine, primaryReferenceFor, restingEarLineDeg } from "./neckCalibrationReference";
import { computePoseMetricsForExercise, earLineAngleDeg, frameAspectOf } from "./poseMetrics";
import { neckRestPeak } from "../analytics/trendRules";
import { POSE_METRIC_ALGORITHM_VERSION } from "./metricVersion";
import { cameraDeclarations, productGlobals, transpile } from "../../../scripts/lib/cameraReplayHarness";
import { replayCalibration } from "../../../scripts/replay-coaching";

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
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
function near(actual: number | null | undefined, expected: number, msg: string, tol = 1e-9) {
  assert(typeof actual === "number" && Math.abs(actual - expected) <= tol, `${msg}: expected ${expected}, got ${actual}`);
}

const ex004 = EXERCISE_REGISTRY.ex_004;
const WIDE = frameAspectOf(1280, 720);
const RAD = Math.PI / 180;

/** A standing figure; its ear line sits at `earDeg` and its hip line at `hipDeg` in a 1280x720 picture. */
function figure(earDeg: number, hipDeg = 0): any[] {
  const p = (x: number, y: number) => ({ x, y, z: 0, visibility: 1 });
  const lm = Array.from({ length: 33 }, () => p(0.5, 0.5));
  // Normalised offsets whose pixel angle at 1280x720 is the requested one.
  const pair = (deg: number, cy: number, half: number) => {
    const dx = half, dy = (half * WIDE * Math.tan(deg * RAD));
    return [p(0.5 + dx, cy - dy), p(0.5 - dx, cy + dy)];
  };
  [lm[7], lm[8]] = pair(earDeg, 0.23, 0.05);
  lm[11] = p(0.6, 0.35); lm[12] = p(0.4, 0.35);
  lm[13] = p(0.61, 0.5); lm[14] = p(0.39, 0.5);
  lm[15] = p(0.61, 0.65); lm[16] = p(0.39, 0.65);
  [lm[23], lm[24]] = pair(hipDeg, 0.7, 0.08);
  return lm;
}
// The sign the figure's ear angle reads with (positive = patient's LEFT).
const ORIENT = Math.sign(earLineAngleDeg(figure(10), WIDE) ?? 0);

console.log("\nex_004: the calibration ear line as the neck's zero (D-49)\n");

test("the ear line of the figure reads the requested pixel angle", () => {
  assert(ORIENT !== 0, "fixture must tilt the ear line");
  near(earLineAngleDeg(figure(10), WIDE), 10 * ORIENT, "10 degree ear line", 1e-9);
});

test("restingEarLineDeg is the median ear line over the calibration samples", () => {
  const samples = [3, 4, 5, 6, 40].map((d) => ({ landmarks: figure(d), frameAspect: WIDE }));
  near(restingEarLineDeg(samples), 5 * ORIENT, "median, unmoved by one outlier");
  const deaf = figure(5);
  deaf[7] = { ...deaf[7], visibility: 0 };
  assert(restingEarLineDeg([{ landmarks: deaf, frameAspect: WIDE }]) === null, "no ear line without both ears");
});

test("only ex_004 counts from the calibration ear line", () => {
  for (const def of Object.values(EXERCISE_REGISTRY)) {
    assert(countsFromCalibrationEarLine(def) === (def.id === "ex_004"), `${def.id}`);
    assert((primaryReferenceFor(def, 2) !== undefined) === (def.id === "ex_004"), `${def.id} reference`);
  }
  assert(primaryReferenceFor(ex004, null) === undefined, "no reference without a frozen ear line");
  assert(primaryReferenceFor(ex004, Number.NaN) === undefined, "nor with a non-finite one");
});

test("the primary reads from the ear line; compensations keep the camera tilt", () => {
  const frozen = { cameraTiltDeg: 0, confidence: "high" as const, divergenceDeg: null };
  const rest = 6 * ORIENT;
  const lm = figure(6 + 15);  // 15 degrees beyond a resting ear line of 6
  const before = computePoseMetricsForExercise(lm, ex004, frozen, WIDE);
  const after = computePoseMetricsForExercise(lm, ex004, frozen, WIDE, primaryReferenceFor(ex004, rest));
  near(before.metrics.neckLateralFlexion, 21 * ORIENT, "from the frozen tilt: rest plus bend", 1e-9);
  near(after.metrics.neckLateralFlexion, 15 * ORIENT, "from the ear line: the bend alone", 1e-9);
  const side = ORIENT > 0 ? "left" : "right";
  near(after.perSideMetrics?.[side], 15, "the side's half", 1e-9);
  assert(after.metrics.trunkLean === before.metrics.trunkLean, "trunk lean unchanged");
  assert(after.metrics.shoulderSymmetry === before.metrics.shoulderSymmetry, "shoulder line unchanged");
  assert(after.primaryReference?.cameraTiltDeg === rest, "the frame reports the primary's reference");
  assert(before.primaryReference === undefined, "and none without one");
  assert(after.tiltReference.cameraTiltDeg === 0, "the frame's tilt reference stays the camera's");
});

test("trend rule 4 gives the same rest-relative peaks under either zero", () => {
  // The rest record reads the same metric as the peaks, so whichever zero the
  // camera counts from, rule 4 lands on the bend from the resting head.
  const frozen = { cameraTiltDeg: 1.5, confidence: "high" as const, divergenceDeg: null };
  const calibrationEar = primaryReferenceFor(ex004, 2.5 * ORIENT);  // the head at calibration
  const restHead = 4, bend = 18;  // the head rests at 4 between sets and bends 18 from there
  const read = (earDeg: number, primary?: typeof calibrationEar) =>
    computePoseMetricsForExercise(figure(earDeg), ex004, frozen, WIDE, primary).metrics.neckLateralFlexion as number;
  for (const [side, sign] of [["left", 1], ["right", -1]] as const) {
    const earAtPeak = restHead + sign * ORIENT * bend;
    const fromRule4 = (primary?: typeof calibrationEar) =>
      neckRestPeak(side, sign * read(earAtPeak, primary), read(restHead, primary));
    near(fromRule4(undefined), bend, `${side}, counted from the frozen tilt`, 1e-9);
    near(fromRule4(calibrationEar), bend, `${side}, counted from the calibration ear line`, 1e-9);
  }
});

test("ex_004's measurement version changes with the reference, and no other exercise's does", () => {
  for (const def of Object.values(EXERCISE_REGISTRY)) {
    const without = structuredClone(def) as ExerciseDefinition;
    if (without.kind === "dynamic") delete without.primaryMetric.reference;
    const changed = sha256Version(exerciseVersionPayload(def)) !== sha256Version(exerciseVersionPayload(without));
    assert(changed === (def.id === "ex_004"), `${def.id}`);
    assert(EXERCISE_CONFIG_VERSIONS[def.id] === sha256Version(exerciseVersionPayload(def)), `${def.id} exported version`);
  }
});

test("replay: the ear line is the recorded one, else rebuilt from the samples, whatever the trace's unit", () => {
  // A trace row's calibration, its landmarks named as the trace stores them.
  const named = (lm: any[]) => ({ leftEar: lm[7], rightEar: lm[8], leftShoulder: lm[11], rightShoulder: lm[12],
    leftElbow: lm[13], rightElbow: lm[14], leftWrist: lm[15], rightWrist: lm[16], leftHip: lm[23], rightHip: lm[24] });
  const row = (version: string, calibration: Record<string, unknown>) => ({ metrics: {
    metricAlgorithmVersion: version, baselines: {}, tiltReference: { cameraTiltDeg: 0 }, calibration } });
  const samples = Array.from({ length: 12 }, () => ({ landmarks: named(figure(8)) }));
  const current = replayCalibration(row(POSE_METRIC_ALGORITHM_VERSION, { samples }), WIDE);
  const older = replayCalibration(row("pose_metrics_v2_frozen_neutral_tilt", { samples }), WIDE);
  near(current.earLine, 8 * ORIENT, "a current-unit trace without a recorded line rebuilds it from its samples", 1e-9);
  near(older.earLine, 8 * ORIENT, "as an older-unit trace does", 1e-9);
  near(replayCalibration(row(POSE_METRIC_ALGORITHM_VERSION, { samples, earLineDeg: 3 }), WIDE).earLine, 3, "a recorded line wins");
  assert(replayCalibration(row(POSE_METRIC_ALGORITHM_VERSION, {}), WIDE).earLine === null, "no samples, no recorded line: none");
});

// ── The camera's own code, run from CameraClient's source ───────────────────

const ref = (current: any) => ({ current });
function finalizeContext(samples: { landmarks: any[]; frameAspect: number }[]) {
  const noop = () => undefined;
  const context: Record<string, any> = {
    ...productGlobals(), performance: { now: () => 5_000 },
    neutralCalibrationSamplesRef: ref(samples.map((s) => ({
      ...s,
      observedTilt: productGlobals().computeTiltReference(s.landmarks, s.frameAspect),
    }))),
    neutralCalibrationClockRef: ref(null),
    bidirectionalBaselineRef: ref({ samples: [], value: null }),
    leftBaselineRef: ref({ samples: [], value: null }), rightBaselineRef: ref({ samples: [], value: null }),
    leftScapBaselineRef: ref({ samples: [], value: null }), rightScapBaselineRef: ref({ samples: [], value: null }),
    ex004FaceShadowEnabledRef: ref(false), ex004FaceShadowBaselineSamplesRef: ref([]),
    ex004FaceShadowBaselineYawSamplesRef: ref([]), ex004FaceShadowBaselinePitchSamplesRef: ref([]),
    ex004FaceShadowBaselineRollRef: ref(null), ex004FaceShadowBaselineYawRef: ref(null), ex004FaceShadowBaselinePitchRef: ref(null),
    frozenTiltDegRef: ref(null), calibrationEarLineDegRef: ref(null), shoulderRestLineDegRef: ref(null),
    cueCompensationFiltersRef: ref(new Map()), calibrationTraceSamplesRef: ref(null),
    metricFiltersRef: ref(new Map()), leftCompensationFiltersRef: ref(new Map()), rightCompensationFiltersRef: ref(new Map()),
    leftPrimaryFilterRef: ref({ reset: noop }), rightPrimaryFilterRef: ref({ reset: noop }),
    neckRestTallyRef: ref({ epochs: [] }),
    resetCompensationWarnings: noop, updateNeutralCalibrationProgress: noop,
    perfToIso: (t: number) => new Date(t).toISOString(),
  };
  context.setBaselinePhase = (phase: string) => { context.phase = phase; };
  const code = cameraDeclarations([
    "EX004_FACE_SHADOW_MIN_BASELINE_SAMPLES", "finiteNumberOrNull", "traceLandmark", "upperBodyTraceLandmarks",
    "finalizeNeutralCalibration",
  ]);
  vm.runInContext(transpile(code + "\nglobalThis.finalize = finalizeNeutralCalibration;"), vm.createContext(context));
  return context;
}

test("calibration (camera source): ex_004 freezes the ear line of the still head", () => {
  // Hips 4 degrees off level, the head resting at 3: the frozen tilt mixes the two lines.
  const samples = Array.from({ length: 30 }, (_, i) => ({ landmarks: figure(3 + 0.2 * Math.sin(i), 4), frameAspect: WIDE }));
  const c = finalizeContext(samples);
  assert(c.finalize(ex004) === true, "calibrates");
  assert(c.phase === "captured", "phase flips to captured");
  near(c.calibrationEarLineDegRef.current, restingEarLineDeg(samples) as number, "the ear line over the same samples");
  near(c.calibrationEarLineDegRef.current, 3 * ORIENT, "the still head's ear line", 0.05);
  assert(Math.abs(c.frozenTiltDegRef.current - c.calibrationEarLineDegRef.current) > 0.3,
    "the frozen camera tilt is a different line (here it also leans on the hips)");
});

test("calibration (camera source): without both ears ex_004 cannot calibrate; other exercises still can", () => {
  const deaf = Array.from({ length: 30 }, () => {
    const lm = figure(3, 1);
    lm[8] = { ...lm[8], visibility: 0 };
    return { landmarks: lm, frameAspect: WIDE };
  });
  const neck = finalizeContext(deaf);
  assert(neck.finalize(ex004) === false, "ex_004 keeps capturing");
  assert(neck.frozenTiltDegRef.current === null, "nothing frozen");
  // An exercise whose calibration takes no ear-based baseline (ex_001's shrug
  // baseline, for one, reads from the ear) is not held up by the ear line.
  const other = Object.values(EXERCISE_REGISTRY).find((d) => !countsFromCalibrationEarLine(d)
    && !(d.kind === "dynamic" && d.primaryMetric.requiresBaselineCapture)
    && !d.compensationMetrics.some((m) => m.requiresBaselineCapture));
  assert(other, "fixture: an exercise without a calibration baseline");
  const c = finalizeContext(deaf);
  assert(c.finalize(other) === true, `${other.id} calibrates on the hip line`);
  assert(c.calibrationEarLineDegRef.current === null, "with no ear line frozen");
});

test("trace (camera source): the neck reading and the frozen ear line are what was counted", () => {
  const context: Record<string, any> = { ...productGlobals() };
  const code = cameraDeclarations(["finiteNumberOrNull", "traceLandmark", "upperBodyTraceLandmarks", "upperBodyTraceMetrics"]);
  vm.runInContext(transpile(code + "\nglobalThis.traceMetrics = upperBodyTraceMetrics;"), vm.createContext(context));
  const frozen = { cameraTiltDeg: 0, confidence: "high" as const, divergenceDeg: null };
  const lm = figure(6 + 15);
  const clock = { sampleCount: 30, validElapsedMs: 3_000 };
  const trace = (raw: any) => context.traceMetrics(lm, raw, frozen, "ex_004", { scapLeft: null, scapRight: null, bidirectionalPrimary: null },
    "not-needed", clock, { width: 1280, height: 720 }, undefined, null, WIDE);
  const withRef = trace(computePoseMetricsForExercise(lm, ex004, frozen, WIDE, primaryReferenceFor(ex004, 6 * ORIENT)));
  near(withRef.neckLateralFlexionSignedDeg, 15 * ORIENT, "the trace reads from the ear line", 1e-9);
  near(withRef.calibration.earLineDeg, 6 * ORIENT, "and records it");
  assert(withRef.tiltReference.cameraTiltDeg === 0, "the camera tilt is recorded as before");
  const without = trace(computePoseMetricsForExercise(lm, ex004, frozen, WIDE));
  near(without.neckLateralFlexionSignedDeg, 21 * ORIENT, "without one it reads from the frozen tilt", 1e-9);
  assert(!("earLineDeg" in without.calibration), "and records none");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exitCode = 1;
