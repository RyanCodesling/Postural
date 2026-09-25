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
  splitSignedBySide,
} from "./poseMetrics";
import { RepCounter } from "./repCounter";
import { captureCoachingProvenance } from "./coachingConfig";
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
const orientation = Math.sign(computeNeckLateralFlexionSigned(rawHead(20), level, "left") ?? 0);
const head = (signedDeg: number) => rawHead(orientation * signedDeg);

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
    const s = splitSignedBySide(v);
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
    assert(thresholds.startThreshold >= 12, "start threshold must clear the ~11° resting noise band");
  });

  await test("metric split: positive tilt feeds only the left side, negative only the right", () => {
    assert(orientation !== 0, "fixture must produce a nonzero signed angle");
    for (const deg of [25, -25, 0]) {
      const m = computePoseMetricsForExercise(head(deg), ex004, level);
      const signed = m.metrics.neckLateralFlexion;
      assert(typeof signed === "number" && Math.abs(signed - deg) < 0.01, `signed ${deg}° reads ${signed}`);
      assertEq(m.perSideMetrics?.left, Math.max(0, signed), `left at ${deg}°`);
      assertEq(m.perSideMetrics?.right, Math.max(0, -signed), `right at ${deg}°`);
    }
    const missing = rawHead(10);
    missing[7] = { ...missing[7], visibility: 0 };
    const m = computePoseMetricsForExercise(missing, ex004, level);
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
    assertEq(sides(reps), "left", "15° overshoot (start 12, minimum peak 18)");
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

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exitCode = 1;
}

void main();
