/**
 * neckLateralFlexionCounting.test.ts
 *
 * ex_004 active alternating neck flexion: one signed ear-line angle is split
 * by sign into per-side magnitudes, and each side runs its own RepCounter.
 * Pins the scenarios the two earlier counting designs failed on:
 *   I1 — a passive overshoot past neutral must not count as a repetition on
 *        the other side;
 *   I2 — a deliberate repetition must still count when the patient returns
 *        only loosely to neutral before tilting the other way;
 * plus small posture adjustments (no ghost counts) and reduced-range tilts.
 * The last section drives the same motion through the camera loop itself.
 *
 *   npx tsx src/lib/pose/neckLateralFlexionCounting.test.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { EXERCISE_REGISTRY, type ExerciseDefinition } from "../exercises/registry";
import {
  computeNeckLateralFlexionSigned,
  computePoseMetricsForExercise,
  earLineAngleDeg,
  frameAspectOf,
  splitSignedBySide,
  NO_ASPECT_CORRECTION,
} from "./poseMetrics";
import { RepCounter } from "./repCounter";
import { captureCoachingProvenance } from "./coachingConfig";
import { restingShoulderLineDeg } from "./shoulderRestReference";
import { createCameraReplay } from "../../../scripts/lib/cameraReplayHarness";

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
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
function assertEq<T>(actual: T, expected: T, msg: string) {
  if (actual !== expected) throw new Error(`${msg}: expected ${String(expected)}, got ${String(actual)}`);
}

const ex004 = EXERCISE_REGISTRY.ex_004 as Extract<ExerciseDefinition, { kind: "dynamic" }>;
const thresholds = ex004.primaryMetric.thresholds;
const level = { cameraTiltDeg: 0, confidence: "high" as const, divergenceDeg: null };

// ── Landmarks: a standing figure whose ear line is rotated by `deg` ─────────
function rawHead(deg: number): any[] {
  const p = (x: number, y: number) => ({ x, y, z: 0, visibility: 1 });
  const lm = Array.from({ length: 33 }, () => p(0.5, 0.5));
  const r = (deg * Math.PI) / 180;
  lm[7] = p(0.5 + 0.1 * Math.cos(r), 0.23 - 0.1 * Math.sin(r));
  lm[8] = p(0.5 - 0.1 * Math.cos(r), 0.23 + 0.1 * Math.sin(r));
  lm[11] = p(0.6, 0.35); lm[12] = p(0.4, 0.35);
  lm[13] = p(0.61, 0.5); lm[14] = p(0.39, 0.5);
  lm[15] = p(0.61, 0.65); lm[16] = p(0.39, 0.65);
  lm[23] = p(0.58, 0.7); lm[24] = p(0.42, 0.7);
  return lm;
}
// Orient the construction so a positive request reads as a positive signed
// angle (patient's LEFT under the convention neckSideAgreement.test.ts pins).
const orientation = Math.sign(computeNeckLateralFlexionSigned(rawHead(20), level, "left", NO_ASPECT_CORRECTION) ?? 0);
const head = (signedDeg: number) => rawHead(orientation * signedDeg);

// The motion scripts below were written in pipeline units, the near-horizontal
// ear line's reading on a 16:9 frame before the aspect correction (D-48). The
// counters now read the corrected tilt, so each scripted sample is converted on
// the way in; the camera-loop runs convert by themselves, since their figures are
// laid out in normalised coordinates and the loop measures them at 1280x720.
const WIDE = frameAspectOf(1280, 720);
const corrected = (pipelineDeg: number) =>
  (Math.atan(Math.tan((pipelineDeg * Math.PI) / 180) / WIDE) * 180) / Math.PI;
// The other way: a figure whose ear line the camera loop reads at `correctedDeg`.
const headAt = (correctedDeg: number) =>
  head((Math.atan(Math.tan((correctedDeg * Math.PI) / 180) * WIDE) * 180) / Math.PI);

// ── Motion scripts: ramps sampled at ~30 fps ────────────────────────────────
const FRAME_MS = 33;
function ramp(from: number, to: number, ms: number): number[] {
  const n = Math.max(1, Math.round(ms / FRAME_MS));
  return Array.from({ length: n }, (_, i) => from + ((to - from) * (i + 1)) / n);
}
const hold = (value: number, ms: number) => ramp(value, value, ms);
// One tilt out to `peak`, a short hold, and back to `back`.
const stroke = (from: number, peak: number, back: number) => [
  ...ramp(from, peak, 700), ...hold(peak, 250), ...ramp(peak, back, 700),
];

type Counted = { side: "left" | "right"; peak: number; classification: string };
function countSigned(series: number[]): Counted[] {
  const left = new RepCounter(thresholds);
  const right = new RepCounter(thresholds);
  const out: Counted[] = [];
  let t = 1000;
  for (const v of series) {
    t += FRAME_MS;
    const s = splitSignedBySide(corrected(v));
    const l = left.update(s.left as number, t);
    const r = right.update(s.right as number, t);
    if (l) out.push({ side: "left", peak: l.peakValue, classification: l.classification });
    if (r) out.push({ side: "right", peak: r.peakValue, classification: r.classification });
  }
  return out;
}
const sides = (reps: Counted[]) => reps.map((r) => r.side).join(",");

async function main() {
  console.log("\nex_004 active neck flexion counting\n");

  await test("registry: ex_004 is a per-limb dynamic exercise on the signed neck angle", () => {
    assertEq(ex004.kind, "dynamic", "kind");
    assertEq(ex004.bilateralMode, "per-limb", "bilateralMode");
    assertEq(ex004.primaryMetric.name, "neckLateralFlexion", "primary metric");
    // About 11 peak-to-peak at rest in pipeline units (D-30).
    assert(thresholds.startThreshold >= corrected(11), "start threshold must clear the resting noise band");
  });

  await test("metric split: positive tilt feeds only the left side, negative only the right", () => {
    assert(orientation !== 0, "fixture must produce a nonzero signed angle");
    for (const deg of [25, -25, 0]) {
      const m = computePoseMetricsForExercise(head(deg), ex004, level, NO_ASPECT_CORRECTION);
      const signed = m.metrics.neckLateralFlexion;
      assert(typeof signed === "number" && Math.abs(signed - deg) < 0.01, `signed ${deg}° reads ${signed}`);
      assertEq(m.perSideMetrics?.left, Math.max(0, signed), `left at ${deg}°`);
      assertEq(m.perSideMetrics?.right, Math.max(0, -signed), `right at ${deg}°`);
    }
    const missing = rawHead(10);
    missing[7] = { ...missing[7], visibility: 0 };
    const m = computePoseMetricsForExercise(missing, ex004, level, NO_ASPECT_CORRECTION);
    assertEq(m.perSideMetrics?.left, null, "occluded ear leaves the left side unavailable");
    assertEq(m.perSideMetrics?.right, null, "occluded ear leaves the right side unavailable");
  });

  await test("clean alternation L,R,L,R counts two per side, all complete", () => {
    const reps = countSigned([
      ...hold(0, 400), ...stroke(0, 40, 0), ...stroke(0, -40, 0), ...stroke(0, 40, 0), ...stroke(0, -40, 0), ...hold(0, 400),
    ]);
    assertEq(sides(reps), "left,right,left,right", "sides in order");
    assert(reps.every((r) => r.classification === "complete"), "40° peaks are complete (target 30)");
  });

  await test("I1: a passive overshoot past neutral is not a repetition on the other side", () => {
    for (const overshoot of [-5, -8, -11]) {
      const reps = countSigned([...hold(0, 400), ...stroke(0, 40, overshoot), ...ramp(overshoot, 0, 400), ...hold(0, 600)]);
      assertEq(sides(reps), "left", `overshoot ${overshoot}°`);
    }
  });

  await test("I1: an overshoot that crosses the start threshold but not the minimum peak is discarded", () => {
    const reps = countSigned([...hold(0, 400), ...stroke(0, 40, -15), ...ramp(-15, 0, 400), ...hold(0, 600)]);
    assertEq(sides(reps), "left", "15 overshoot (start 12, minimum peak 18, all in pipeline units)");
  });

  await test("I2: loose returns to neutral (3/5/7/8°) still count every alternating repetition", () => {
    for (const residual of [3, 5, 7, 8]) {
      const reps = countSigned([
        ...hold(0, 400),
        ...stroke(0, 40, residual), ...hold(residual, 300),
        ...stroke(residual, -40, -residual), ...hold(-residual, 300),
        ...stroke(-residual, 40, residual), ...hold(residual, 300),
        ...stroke(residual, -40, 0), ...hold(0, 400),
      ]);
      assertEq(sides(reps), "left,right,left,right", `residual ${residual}°`);
    }
  });

  await test("rapid alternation without a pause at neutral counts every repetition", () => {
    const reps = countSigned([
      ...hold(0, 400),
      ...ramp(0, 35, 350), ...ramp(35, -35, 500), ...ramp(-35, 35, 500), ...ramp(35, -35, 500), ...ramp(-35, 0, 350),
      ...hold(0, 400),
    ]);
    assertEq(sides(reps), "left,right,left,right", "rapid sides");
  });

  await test("posture adjustments and slow drift within ±10° never count", () => {
    const jitter: number[] = [];
    for (let i = 0; i < 300; i++) jitter.push(6 * Math.sin(i / 3) * Math.cos(i / 17));
    const reps = countSigned([...hold(0, 300), ...jitter, ...ramp(0, 10, 2000), ...ramp(10, -10, 3000), ...ramp(-10, 0, 2000)]);
    assertEq(reps.length, 0, "no ghost counts");
  });

  await test("reduced range: a 22° tilt counts as partial; a 16° tilt is below the minimum and discarded", () => {
    const partial = countSigned([...hold(0, 400), ...stroke(0, 22, 0), ...hold(0, 400)]);
    assertEq(sides(partial), "left", "22° counts");
    assertEq(partial[0].classification, "partial", "22° is partial");
    const tooSmall = countSigned([...hold(0, 400), ...stroke(0, -16, 0), ...hold(0, 400)]);
    assertEq(tooSmall.length, 0, "16° discarded");
  });

  await test("known limit: same-side repetitions need a return near centre (a loose same-side return merges)", () => {
    const reps = countSigned([...hold(0, 400), ...stroke(0, 40, 8), ...stroke(8, 40, 0), ...hold(0, 400)]);
    assertEq(reps.length, 1, "two left tilts with an 8° same-side return count once");
  });

  await test("camera loop: alternating tilts through the product pipeline count per side", async () => {
    const provenance = await captureCoachingProvenance(ex004);
    const replay = createCameraReplay(ex004, provenance);
    let t = 1000;
    const script = [
      ...hold(0, 1000), ...stroke(0, 40, 0), ...hold(0, 300), ...stroke(0, -40, 0), ...hold(0, 300),
      ...stroke(0, 40, 0), ...hold(0, 300), ...stroke(0, -40, 0), ...hold(0, 1000),
    ];
    script.forEach((deg, i) => {
      const jitter = 1.5 * Math.sin(i * 1.7);
      replay.tick({ tMs: (t += FRAME_MS), landmarks: head(deg + jitter) });
    });
    const left = replay.emitted.filter((r: any) => r.side === "left");
    const right = replay.emitted.filter((r: any) => r.side === "right");
    assertEq(left.length, 2, "left repetitions");
    assertEq(right.length, 2, "right repetitions");
    assertEq(replay.context.repCountsRef.current.left, 2, "live left count");
    assertEq(replay.context.repCountsRef.current.right, 2, "live right count");
  });

  await test("camera loop: a single tilt with an overshoot counts once", async () => {
    const provenance = await captureCoachingProvenance(ex004);
    const replay = createCameraReplay(ex004, provenance);
    let t = 1000;
    for (const deg of [...hold(0, 1000), ...stroke(0, 40, -9), ...ramp(-9, 0, 400), ...hold(0, 1000)]) {
      replay.tick({ tMs: (t += FRAME_MS), landmarks: head(deg) });
    }
    assertEq(replay.emitted.length, 1, "one repetition");
    assertEq(replay.emitted[0].side, "left", "on the left");
  });

  await test("camera loop: a calibration takes no sample during the positioning countdown", async () => {
    const provenance = await captureCoachingProvenance(ex004);
    const replay = createCameraReplay(ex004, provenance);
    let t = 1000;
    replay.context.baselinePhaseRef.current = "capturing";
    replay.context.frozenTiltDegRef.current = null;
    replay.context.calibrationPositioningEndsAtMsRef.current = t + 5_000;
    for (const deg of hold(0, 4_900)) replay.tick({ tMs: (t += FRAME_MS), landmarks: head(deg) });
    assertEq(replay.context.neutralCalibrationSamplesRef.current.length, 0, "no sample while getting into position");
    for (const deg of hold(0, 500)) replay.tick({ tMs: (t += FRAME_MS), landmarks: head(deg) });
    assert(replay.context.neutralCalibrationSamplesRef.current.length > 0, "samples once the countdown has run out");
  });

  // A figure whose shoulders rest tilted by `restDeg` (the shoulder line in
  // normalised coordinates, i.e. pipeline units) and tilt `followDeg` further
  // while the head bends to the right.
  const withShoulders = (headDeg: number, restDeg: number, followDeg: number) => {
    const lm = head(headDeg);
    const tilt = restDeg + (headDeg < 0 ? (followDeg * -headDeg) / 40 : 0);
    const half = (0.2 * Math.tan((tilt * Math.PI) / 180)) / 2;
    lm[11] = { ...lm[11], y: 0.35 + half };
    lm[12] = { ...lm[12], y: 0.35 - half };
    return lm;
  };
  const lowerDrawn = async (restLine: number | null, followDeg = -3) => {
    const provenance = await captureCoachingProvenance(ex004);
    const replay = createCameraReplay(ex004, provenance);
    replay.context.shoulderRestLineDegRef.current = restLine;
    let t = 1000;
    let drawn = 0;
    const script = [...hold(0, 1000), ...stroke(0, -40, 0), ...hold(0, 600), ...stroke(0, -40, 0), ...hold(0, 1000)];
    for (const deg of script) {
      const frame = replay.tick({ tMs: (t += FRAME_MS), landmarks: withShoulders(deg, -6, followDeg), frozenTilt: 0 });
      if (frame.renderedTexts.includes("LOWER")) drawn += 1;
    }
    return drawn;
  };

  await test("camera loop: LOWER judged against the resting shoulder line ignores a resting tilt (D-47)", async () => {
    // At 1280x720 the resting shoulders (6 in pipeline units) read 3.4 against
    // the frozen tilt (0), and the bends (3 more) take them to 5.1, past the
    // switch-on level of 4. Against their resting line, which the calibration
    // measures from the still figure, only the part added in each bend counts.
    const restLine = restingShoulderLineDeg([{ landmarks: withShoulders(0, -6, 0), frameAspect: WIDE }]);
    assert(restLine !== null && Math.abs(restLine - corrected(-6)) < 1e-9, `rest line ${restLine}`);
    const frozen = await lowerDrawn(null);
    const resting = await lowerDrawn(restLine);
    assert(frozen > 0, `against the frozen tilt the cue is drawn (${frozen} frames)`);
    assertEq(resting, 0, "against the resting shoulder line it is not");
    // A shoulder that rises 9 pipeline units (5.2 here) from its resting line still draws it.
    assert((await lowerDrawn(restLine, -9)) > 0, "a real hike past the switch-on level still draws LOWER");
  });

  await test("camera loop: in the rests, a neck side bend records what the still head reads", async () => {
    const provenance = await captureCoachingProvenance(ex004);
    const replay = createCameraReplay(ex004, provenance);
    let t = 1000;
    replay.context.neckRestTallyRef.current = { epochs: [{ from: new Date(t).toISOString(), readings: [] }] };
    for (const deg of hold(0, 300)) replay.tick({ tMs: (t += FRAME_MS), landmarks: head(deg), frozenTilt: 2 });
    assertEq(replay.context.neckRestTallyRef.current.epochs[0].readings.length, 0, "nothing while a set is active");
    replay.context.sessionStateRef.current = "resting";
    for (const deg of hold(0, 1_000)) replay.tick({ tMs: (t += FRAME_MS), landmarks: head(deg), frozenTilt: 2 });
    const readings: number[] = replay.context.neckRestTallyRef.current.epochs[0].readings;
    assert(readings.length > 20, `readings during the rest: ${readings.length}`);
    assert(readings.every((v) => Math.abs(v + 2) < 1e-6), "a level head under a frozen tilt of 2 reads -2");
  });

  // D-49: ex_004 counts from the ear line frozen in the calibration. A head
  // resting 5 off the frozen tilt (uneven hips, an angled stance) bends 22
  // each way. From the frozen tilt the left reads 27 and the right 17, short of
  // the target (18); from the calibration's ear line both read 22.
  const restingBends = async (earLine: number | null) => {
    const provenance = await captureCoachingProvenance(ex004);
    const replay = createCameraReplay(ex004, provenance);
    let t = 1000;
    const script = [...hold(5, 1000), ...stroke(5, 27, 5), ...hold(5, 300), ...stroke(5, -17, 5), ...hold(5, 1000)];
    for (const deg of script) replay.tick({ tMs: (t += FRAME_MS), landmarks: headAt(deg), frozenTilt: 0, earLine });
    const one = (side: string) => {
      const reps = replay.emitted.filter((r: any) => r.side === side);
      assertEq(reps.length, 1, `${side} repetitions (earLine ${earLine})`);
      return reps[0];
    };
    return { left: one("left"), right: one("right") };
  };

  await test("camera loop: counted from the calibration ear line, a resting head tilt is the zero (D-49)", async () => {
    const restLine = earLineAngleDeg(headAt(5), WIDE);
    assert(restLine !== null && Math.abs(restLine - 5) < 1e-9, `the resting figure's ear line reads ${restLine}`);
    const frozen = await restingBends(null);
    assert(frozen.left.peakValue - frozen.right.peakValue > 8, `from the frozen tilt: left ${frozen.left.peakValue}, right ${frozen.right.peakValue}`);
    assertEq(frozen.right.classification, "partial", "a full right bend falls short of the target");
    const fromRest = await restingBends(restLine);
    assert(Math.abs(fromRest.left.peakValue - fromRest.right.peakValue) < 1, `from the ear line: left ${fromRest.left.peakValue}, right ${fromRest.right.peakValue}`);
    assert(Math.abs(fromRest.left.peakValue - 22) < 1, `the bend itself: ${fromRest.left.peakValue}`);
    assertEq(fromRest.left.classification, "complete", "left complete");
    assertEq(fromRest.right.classification, "complete", "right complete");
  });

  await test("camera loop: from the calibration ear line, the still head reads 0 in the rests (D-49)", async () => {
    const provenance = await captureCoachingProvenance(ex004);
    const replay = createCameraReplay(ex004, provenance);
    let t = 1000;
    replay.context.neckRestTallyRef.current = { epochs: [{ from: new Date(t).toISOString(), readings: [] }] };
    replay.context.sessionStateRef.current = "resting";
    for (const deg of hold(0, 1_000)) replay.tick({ tMs: (t += FRAME_MS), landmarks: head(deg), frozenTilt: 2, earLine: 0 });
    const readings: number[] = replay.context.neckRestTallyRef.current.epochs[0].readings;
    assert(readings.length > 20, `readings during the rest: ${readings.length}`);
    assert(readings.every((v) => Math.abs(v) < 1e-6), "the head at its calibration posture reads 0, whatever the frozen tilt");
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exitCode = 1;
}

void main();
