/**
 * Pins the trunk-lean cue's resting trunk reference (D-65): the resting line is
 * the median trunk line over the calibration's samples, and the cue's reading
 * is the trunk line against it, in computeTrunkLateralLean's form. Through the
 * camera loop, the cue and its arrow take that reading while the compensation
 * score keeps the frozen-tilt one. The coaching configuration records the
 * reference. The cue has no cooldown, so a lean to the other side straight
 * after the first is drawn too.
 *
 *   npx tsx src/lib/pose/trunkRestReference.test.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { coachingConfiguration, captureCoachingProvenance, validCoachingProvenance, COACHING_ALGORITHM_VERSION } from "./coachingConfig";
import { COACHING_CUE_COOLDOWN_MS, resolveCoachingCue, resolveCoachingCueTiming } from "./coachingCue";
import { computeTrunkLateralLean, frameAspectOf, trunkLineAngleDeg, NO_ASPECT_CORRECTION } from "./poseMetrics";
import { medianFinite } from "./neutralCalibration";
import { TRUNK_LEAN_CUE_REFERENCE, restReferencedTrunkLean, restingTrunkLineDeg } from "./trunkRestReference";
import { EXERCISE_REGISTRY, type ExerciseDefinition } from "../exercises/registry";
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
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const WIDE = frameAspectOf(1280, 720);
const level = { cameraTiltDeg: 0, confidence: "high" as const, divergenceDeg: null };

/**
 * A standing figure, arms down, whose trunk line (hip midpoint to shoulder
 * midpoint) reads `leanDeg` from vertical in a frame of shape `aspect`;
 * positive leans toward the image's right.
 */
function figure(leanDeg: number, aspect = WIDE, hipVisibility = 1) {
  const p = (x: number, y: number, visibility = 1) => ({ x, y, z: 0, visibility });
  const lm = Array.from({ length: 33 }, () => p(0.5, 0.5));
  const dx = (Math.tan((leanDeg * Math.PI) / 180) * 0.35) / aspect;
  lm[7] = p(0.55 + dx, 0.23); lm[8] = p(0.45 + dx, 0.23);
  lm[11] = p(0.6 + dx, 0.35); lm[12] = p(0.4 + dx, 0.35);
  lm[13] = p(0.61 + dx, 0.5); lm[14] = p(0.39 + dx, 0.5);
  lm[15] = p(0.61 + dx, 0.65); lm[16] = p(0.39 + dx, 0.65);
  lm[23] = p(0.58, 0.7, hipVisibility); lm[24] = p(0.42, 0.7, hipVisibility);
  return lm;
}
const at = (leanDeg: number) => ({ landmarks: figure(leanDeg), frameAspect: WIDE });

async function main() {
  console.log("\nTrunk-lean cue: resting trunk reference\n");

  await test("the raw trunk line reads -90 upright and turns by the lean, with computeTrunkLateralLean's sign", () => {
    const upright = trunkLineAngleDeg(figure(0), WIDE);
    assert(upright !== null && Math.abs(upright + 90) < 1e-9, `upright ${upright}`);
    const leaning = trunkLineAngleDeg(figure(6), WIDE);
    assert(leaning !== null && Math.abs(leaning - (-90 + 6)) < 1e-9, `leaning ${leaning}`);
    const lean = computeTrunkLateralLean(figure(6), level, WIDE);
    assert(lean?.angleDeg === 6 && lean.direction === "right", JSON.stringify(lean));
    assert(trunkLineAngleDeg(figure(6, WIDE, 0.2), WIDE) === null, "hidden hips give none");
  });

  await test("the resting line is the median over the calibration's samples", () => {
    const samples = [at(-3.5), at(-4), at(-4.5), at(-4.2), { landmarks: figure(20, WIDE, 0.1), frameAspect: WIDE }];
    const rest = restingTrunkLineDeg(samples);
    assert(rest !== null && Math.abs(rest - (-90 - 4.1)) < 1e-9, `rest ${rest}`);
    assert(restingTrunkLineDeg([]) === null, "no samples: none");
  });

  await test("each sample is read in its own frame's corrected plane (D-48)", () => {
    // A figure laid out to read 6 in normalized units reads atan(k tan 6) on a 16:9 frame.
    const rest = restingTrunkLineDeg([{ landmarks: figure(6, NO_ASPECT_CORRECTION), frameAspect: 16 / 9 }]);
    const expected = (Math.atan((16 / 9) * Math.tan((6 * Math.PI) / 180)) * 180) / Math.PI;
    assert(rest !== null && Math.abs(rest + 90 - expected) < 1e-9, `rest ${rest} expected ${expected - 90}`);
  });

  await test("against the resting line, a still trunk reads 0 and only the change counts", () => {
    const rest = restingTrunkLineDeg([at(-4)]);
    const still = restReferencedTrunkLean(figure(-4), rest, WIDE);
    assert(still !== null && still.angleDeg === 0 && still.direction === "center", JSON.stringify(still));
    // The live check's missed wall-angel lean (2026-10-29): 8.5 against the frozen tilt, 12.5 from rest.
    const lean = restReferencedTrunkLean(figure(8.5), rest, WIDE);
    assert(lean !== null && lean.angleDeg === 12.5 && lean.direction === "right", JSON.stringify(lean));
    const other = restReferencedTrunkLean(figure(-14.5), rest, WIDE);
    assert(other !== null && other.angleDeg === 10.5 && other.direction === "left", JSON.stringify(other));
    assert(restReferencedTrunkLean(figure(8.5), null, WIDE) === null, "no resting line: none");
    assert(restReferencedTrunkLean(figure(8.5, WIDE, 0.2), rest, WIDE) === null, "hidden hips: none");
  });

  await test("the reading is the lean minus the calibration's median lean, whatever the frozen tilt", () => {
    // The survey's resting reference (Review_Artifacts/2026-10-29_trunk_lean_reference_survey):
    // each lean under the frozen tilt minus its median over the calibration's samples.
    const samples = [at(2.1), at(2.9), at(3.4), at(2.6), at(3)];
    const rest = restingTrunkLineDeg(samples);
    for (const tilt of [-3, 0, 1.7]) {
      const frozen = { cameraTiltDeg: tilt, confidence: "high" as const, divergenceDeg: null };
      // Unrounded leans: the trunk line against the frozen tilt, from vertical.
      const exact = (lm: any[]) => trunkLineAngleDeg(lm, WIDE)! - tilt + 90;
      const calibrationLean = medianFinite(samples.map((s) => exact(s.landmarks)))!;
      for (const deg of [-12, -4, 0, 9.3]) {
        const lm = figure(deg);
        const frozenLean = computeTrunkLateralLean(lm, frozen, WIDE)!.angleDeg;
        assert(frozenLean === Math.round(Math.abs(exact(lm)) * 10) / 10, `tilt ${tilt}, lean ${deg}: the frozen-tilt lean ${frozenLean}`);
        const reading = restReferencedTrunkLean(lm, rest, WIDE)!.angleDeg;
        const expected = Math.round(Math.abs(exact(lm) - calibrationLean) * 10) / 10;
        assert(reading === expected, `tilt ${tilt}, lean ${deg}: ${reading} vs ${expected}`);
      }
    }
  });

  await test("the coaching configuration records the reference and stays valid", () => {
    assert(COACHING_ALGORITHM_VERSION === "coaching_v21_trunk_lean_rest_reference", COACHING_ALGORITHM_VERSION);
    const configuration = coachingConfiguration(EXERCISE_REGISTRY.ex_001);
    assert(configuration.trunkLeanReference === TRUNK_LEAN_CUE_REFERENCE, "recorded");
    const version = `sha256:${"0".repeat(64)}`;
    assert(validCoachingProvenance({ version, configuration }), "valid");
    const older: Record<string, unknown> = { ...configuration };
    delete older.trunkLeanReference;
    assert(validCoachingProvenance({ version, configuration: older }), "a configuration from before the reference stays valid");
    assert(!validCoachingProvenance({ version, configuration: { ...configuration, trunkLeanReference: "other" } }), "an unknown reference is not");
  });

  await test("the trunk-lean cue has no cooldown on any active exercise", () => {
    for (const id of ["ex_001", "ex_004", "ex_006", "ex_007", "ex_008"]) {
      const spec = EXERCISE_REGISTRY[id].compensationMetrics.find((c) => c.name === "trunkLean");
      assert(spec?.cue, `${id} cues trunk lean`);
      assert(resolveCoachingCueTiming(resolveCoachingCue(spec)).cooldownMs === 0, `${id}'s trunk-lean cooldown`);
    }
  });

  // ── Through the camera loop (lateral arm raises, both arms, arms down) ──────
  const ex001 = EXERCISE_REGISTRY.ex_001;
  const FRAME_MS = 50;
  /**
   * Holds each posture of `phases` ([lean, frames]) in turn, 50 ms a frame,
   * with the frozen tilt at 0. `calibratedDeg` is the posture the calibration
   * saw (null: no resting line, as in a replay).
   */
  const run = async (calibratedDeg: number | null, phases: [number, number][], definition: ExerciseDefinition = ex001) => {
    const replay = createCameraReplay(definition, await captureCoachingProvenance(definition));
    replay.context.trunkRestLineDegRef.current = calibratedDeg === null ? null : restingTrunkLineDeg([at(calibratedDeg)]);
    let t = 1000;
    let drawn = 0;
    const directions = new Set<string>();
    const scores: (number | null)[] = [];
    const script = phases.flatMap(([deg, frames]) => Array<number>(frames).fill(deg));
    for (const deg of script) {
      const frame = replay.tick({ tMs: (t += FRAME_MS), landmarks: figure(deg), frozenTilt: 0 });
      scores.push(replay.context.setFrameMetricsOutput?.compensationScore ?? null);
      if (!frame.renderedTexts.includes("STRAIGHTEN")) continue;
      drawn += 1;
      const direction = replay.context.lastDrawnCueRef.current?.direction;
      if (direction) directions.add(direction);
    }
    return { drawn, directions: [...directions], scores };
  };

  await test("camera loop: a lean the frozen tilt under-reads is drawn from the resting line", async () => {
    // As in the live check's wall angels: the trunk rested at -4, so a lean to
    // 8.4 stayed under the line (8.8) against the frozen tilt; from rest it is 12.4.
    const phases: [number, number][] = [[-4, 20], [8.4, 50], [-4, 20]];
    const frozen = await run(null, phases);
    const resting = await run(-4, phases);
    assert(frozen.drawn === 0, `against the frozen tilt it is not drawn (${frozen.drawn} frames)`);
    assert(resting.drawn > 20, `against the resting line it is (${resting.drawn} frames)`);
    assert(resting.directions.join() === "right", `its arrow follows the lean: ${resting.directions}`);
  });

  await test("camera loop: a resting offset alone no longer draws the cue, and the score keeps the frozen reading", async () => {
    // A trunk that rests 14 from the hip-and-ear reference, for example with a
    // scoliosis, reads past the line throughout against the frozen tilt.
    const frozen = await run(null, [[14, 90]]);
    const resting = await run(14, [[14, 90]]);
    assert(frozen.drawn > 40, `against the frozen tilt it is drawn (${frozen.drawn} frames)`);
    assert(resting.drawn === 0, `against the resting line it is not (${resting.drawn} frames)`);
    assert(frozen.scores.some((s) => s !== null && s < 100), "the frozen lean deducts from the score");
    assert(JSON.stringify(resting.scores) === JSON.stringify(frozen.scores), "the score is the same with and without the resting line");
  });

  await test("camera loop: the arrow takes the resting reading's side", async () => {
    // Resting at 14, a move to 4 is 10 to the left of the resting trunk, while
    // the frozen tilt reads the trunk to the right throughout.
    const phases: [number, number][] = [[14, 40], [4, 50], [14, 20]];
    const frozen = await run(null, phases);
    const resting = await run(14, phases);
    assert(frozen.drawn > 10 && frozen.directions.join() === "right", `against the frozen tilt: ${frozen.drawn} frames, ${frozen.directions}`);
    assert(resting.drawn > 20 && resting.directions.join() === "left", `against the resting line: ${resting.drawn} frames, ${resting.directions}`);
  });

  await test("camera loop: a lean to the other side straight after the first is drawn too", async () => {
    // As in the live check's press and wall angels (sessions 253 and 254): a
    // lean, half a second upright, then a lean to the other side.
    const phases: [number, number][] = [[0, 20], [12, 40], [0, 10], [-12, 40], [0, 20]];
    const now = await run(0, phases);
    assert(now.directions.join() === "right,left", `both leans are drawn: ${now.directions}`);
    // The 3 s default, kept per cue and not per side, held the second one back.
    const withCooldown = structuredClone(ex001);
    withCooldown.compensationMetrics.find((c) => c.name === "trunkLean")!.cue!.cooldownMs = COACHING_CUE_COOLDOWN_MS;
    const before = await run(0, phases, withCooldown);
    assert(before.directions.join() === "right", `with the 3 s cooldown only the first is: ${before.directions}`);
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
