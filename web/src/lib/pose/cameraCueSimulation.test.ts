/**
 * Controlled cue scenarios through the current camera callback and renderer.
 * Synthetic landmarks/world points and canvas pixels replace detector/browser
 * delivery. Readiness, metrics, tracking, latches and cue selection are real.
 * These checks establish software behavior, not detector or clinical accuracy.
 * Run: npx tsx src/lib/pose/cameraCueSimulation.test.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import { createCameraReplay } from "../../../scripts/lib/cameraReplayHarness";
import { getExerciseDefinition } from "../exercises/registry";
import { evaluateCaptureReadiness } from "./captureReadiness";
import { captureCoachingProvenance, COACHING_ALGORITHM_VERSION } from "./coachingConfig";
import { DARK_PICTURE_MESSAGE } from "./pictureBrightness";

type Side = "left" | "right";
const sides: Side[] = ["left", "right"];
const baseline = { scapLeft: 0.12 / 0.35, scapRight: 0.12 / 0.35 };
const results: Record<string, unknown>[] = [];

/** Image-plane arm positions, with the nose and knees needed by real readiness. */
function pose(left = 90, right = left, bent: Side | null = null, torsoShift = 0): any[] {
  const point = (x: number, y: number) => ({ x, y, z: 0, visibility: 1 });
  const lm = Array.from({ length: 33 }, () => point(0.5, 0.5));
  lm[0] = point(0.5, 0.2);
  lm[7] = point(0.6, 0.23); lm[8] = point(0.4, 0.23);
  lm[11] = point(0.6, 0.35); lm[12] = point(0.4, 0.35);
  lm[23] = point(0.6, 0.7); lm[24] = point(0.4, 0.7);
  lm[25] = point(0.6, 0.88); lm[26] = point(0.4, 0.88);
  for (const [side, degrees, shoulder, elbow, wrist, sign] of [
    ["left", left, 11, 13, 15, 1], ["right", right, 12, 14, 16, -1],
  ] as const) {
    const upper = degrees * Math.PI / 180;
    const forearm = (degrees + (bent === side ? 80 : 0)) * Math.PI / 180;
    lm[elbow] = point(lm[shoulder].x + sign * 0.16 * Math.sin(upper), 0.35 + 0.16 * Math.cos(upper));
    lm[wrist] = point(lm[elbow].x + sign * 0.14 * Math.sin(forearm), lm[elbow].y + 0.14 * Math.cos(forearm));
  }
  // Translate the upper body relative to the hips: visible lateral torso lean.
  for (const index of [0, 7, 8, 11, 12, 13, 14, 15, 16]) lm[index].x += torsoShift;
  return lm;
}

async function replayFor(id: string, side: Side | "both" = "both") {
  const definition = getExerciseDefinition(id)!;
  const replay = createCameraReplay(definition, await captureCoachingProvenance(definition), { prescribedSide: side });
  replay.context.evaluateCaptureReadiness = evaluateCaptureReadiness;
  let now = 1000;
  return {
    ...replay,
    feed(frames: number, makePose: (index: number) => any[], stepMs = 50) {
      const from = replay.frames.length;
      for (let i = 0; i < frames; i++) replay.tick({ tMs: (now += stepMs), landmarks: makePose(i), baselines: baseline });
      return replay.frames.slice(from);
    },
  };
}

async function scenario(name: string, run: () => Promise<Record<string, unknown>>) {
  try {
    const evidence = await run();
    results.push({ name, passed: true, ...evidence });
    console.log(`  PASS ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({ name, passed: false, error: message });
    console.error(`  FAIL ${name}: ${message}`);
  }
}

async function main() {
  console.log("\nCamera cue simulations: synthetic inputs through real product processing\n");

  for (const id of ["ex_001", "ex_006"]) for (const side of sides) {
    await scenario(`${id}: ${side} elbow bend triggers Straighten arms and clears after recovery`, async () => {
      const replay = await replayFor(id, side);
      replay.feed(12, () => pose(0));
      const correct = replay.feed(35, () => pose(90));
      assert(correct.every((f: any) => !f.renderedTexts.includes("Straighten arms")), "straight-arm control stays quiet");
      const fault = replay.feed(45, () => pose(90, 90, side));
      const drawn = fault.filter((f: any) => f.renderedTexts.includes("Straighten arms")).length;
      assert(drawn > 0, "the actual canvas renderer draws the instruction for a visible elbow bend");
      assert.equal(replay.context.lastDrawnCueRef.current?.metric, "elbowBend");
      // A dynamic elbow cue is repetition-held; its recovery includes rest.
      // The hold cue is live, so its recovery keeps the arms at shoulder height.
      const recovered = replay.feed(65, () => pose(id === "ex_001" ? 0 : 90));
      assert(!recovered.at(-1).renderedTexts.includes("Straighten arms"), "no stale instruction after recovery");
      return { cueFrames: drawn, finalCaptureAccepted: replay.context.lastCaptureOkRef.current };
    });
  }

  for (const side of sides) {
    await scenario(`${side} hand: low confidence and out-of-frame wording differ, then recover`, async () => {
      const replay = await replayFor("ex_006");
      const index = side === "left" ? 15 : 16;
      replay.feed(12, () => pose(90));
      assert(replay.context.leftHoldMsRef.current > 0 && replay.context.rightHoldMsRef.current > 0);
      const before = [replay.context.leftHoldMsRef.current, replay.context.rightHoldMsRef.current];
      replay.feed(2, () => {
        const lm = pose(90); lm[index].visibility = 0.2; return lm;
      });
      const lowConfidenceMessage = replay.context.setCaptureMessageOutput;
      assert(lowConfidenceMessage.startsWith(`The camera can't make out your ${side} hand.`), lowConfidenceMessage);
      assert.equal(replay.context.lastCaptureOkRef.current, false);
      assert.deepEqual([replay.context.leftHoldMsRef.current, replay.context.rightHoldMsRef.current], before,
        "rejected frames do not add hold credit");
      replay.feed(2, () => {
        const lm = pose(90); lm[index].x = side === "left" ? 1.1 : -0.1; return lm;
      });
      const outsideMessage = replay.context.setCaptureMessageOutput;
      assert.equal(outsideMessage, `Show your ${side} hand to the camera.`);
      replay.feed(35, () => pose(90));
      assert.equal(replay.context.lastCaptureOkRef.current, true);
      assert.equal(replay.context.setCaptureMessageOutput, "Captured");
      return { lowConfidenceMessage, outsideMessage, recovered: replay.context.lastCaptureOkRef.current };
    });
  }

  for (const side of sides) for (const luma of [55, 100]) {
    await scenario(`${side} wrist flicker at luma ${luma}: named warning and recovery`, async () => {
      const replay = await replayFor("ex_001", side);
      replay.context.lastLumaSampleMsRef.current = Infinity;
      replay.context.pictureLumaRef.current = luma;
      const index = side === "left" ? 15 : 16;
      replay.feed(20, () => pose(40));
      assert.equal(replay.context.trackingHintRef.current, null, "steady control stays quiet");
      replay.feed(45, (i) => {
        const lm = pose(40); lm[index].x += i % 2 ? 0.04 : -0.04; return lm;
      });
      const message = replay.context.setTrackingHintOutput;
      assert(message?.includes(`your ${side} arm`), message);
      assert.equal(message.includes("More light"), luma < 70, "bright-room advice omits more light");
      assert(replay.context.captureUnsteadyFramesRef.current > 0, "real steadiness processing counts the flicker");
      assert.equal(replay.context.lastCaptureOkRef.current, true, "high-confidence flicker is not a readiness failure");
      const unsteadyFrames = replay.context.captureUnsteadyFramesRef.current;
      replay.feed(100, () => pose(40));
      assert.equal(replay.context.trackingHintRef.current, null, "the warning clears after tracking settles and its hold ends");
      return { message, unsteadyFrames, recovered: replay.context.trackingHintRef.current === null };
    });
  }

  for (const side of sides) {
    await scenario(`${side} observation-arm flicker cannot warn a unilateral exercise`, async () => {
      const prescribed = side === "left" ? "right" : "left";
      const replay = await replayFor("ex_001", prescribed);
      const index = side === "left" ? 15 : 16;
      replay.feed(45, (i) => {
        const lm = pose(40); lm[index].x += i % 2 ? 0.04 : -0.04; return lm;
      });
      assert(replay.context.trackingMarksRef.current.some((m: any) => m.unsteady.includes(`${side}Arm`)), "the observation arm really is unsteady");
      assert.equal(replay.context.trackingHintRef.current, null, "no warning for the observation-only arm");
      assert.equal(replay.context.captureUnsteadyFramesRef.current, 0, "prescribed tracking tally excludes the observation arm");
      return { prescribed, observationArmDetectedUnsteady: true, warning: replay.context.trackingHintRef.current };
    });
  }

  for (const id of ["ex_007", "ex_008"]) for (const shift of [-0.06, 0.06]) {
    await scenario(`${id}: lateral torso shift ${shift} triggers STRAIGHTEN and clears upright`, async () => {
      const replay = await replayFor(id);
      const correct = replay.feed(30, () => pose(70));
      assert(correct.every((f: any) => !f.renderedTexts.includes("STRAIGHTEN")), "upright control stays quiet");
      const fault = replay.feed(50, () => pose(70, 70, null, shift));
      const drawn = fault.filter((f: any) => f.renderedTexts.includes("STRAIGHTEN")).length;
      assert(drawn > 0, "the actual renderer draws the torso correction");
      assert.equal(replay.context.lastDrawnCueRef.current?.metric, "trunkLean");
      const direction = replay.context.lastDrawnCueRef.current?.direction;
      const recovered = replay.feed(85, () => pose(70));
      assert(!recovered.at(-1).renderedTexts.includes("STRAIGHTEN"), "upright correction clears the cue");
      return { cueFrames: drawn, direction, finalCaptureAccepted: replay.context.lastCaptureOkRef.current };
    });
  }

  await scenario("synthetic canvas pixels reach the real luma sampler and camera message", async () => {
    const oldDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
    let grey = 0;
    let drawCalls = 0;
    const canvas = { width: 0, height: 0, getContext: () => ({
      drawImage: () => { drawCalls++; },
      getImageData: (_x: number, _y: number, width: number, height: number) => {
        assert.equal(width, 64); assert.equal(height, 36);
        const data = new Uint8ClampedArray(width * height * 4);
        for (let i = 0; i < data.length; i += 4) {
          data[i] = grey; data[i + 1] = grey; data[i + 2] = grey; data[i + 3] = 255;
        }
        return { data };
      },
    }) };
    Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => canvas } });
    try {
      const replay = await replayFor("ex_001");
      replay.tick({ tMs: 1000, noPerson: true });
      assert.equal(replay.context.pictureLumaRef.current, 0, "sampler reads the dark synthetic pixels");
      assert.equal(replay.context.setCaptureMessageOutput, DARK_PICTURE_MESSAGE);
      grey = 200;
      replay.tick({ tMs: 1100, noPerson: true });
      assert.equal(drawCalls, 1, "sampling is throttled between frames");
      replay.tick({ tMs: 1600, noPerson: true });
      assert.equal(drawCalls, 2);
      assert(Math.abs(replay.context.pictureLumaRef.current - 200) < 1e-6);
      assert.equal(replay.context.setCaptureMessageOutput, "No person detected. Step into the frame.");
      return { drawCalls, finalLuma: replay.context.pictureLumaRef.current, finalMessage: replay.context.setCaptureMessageOutput };
    } finally {
      if (oldDocument) Object.defineProperty(globalThis, "document", oldDocument);
      else Reflect.deleteProperty(globalThis, "document");
    }
  });

  const passed = results.filter((r) => r.passed).length;
  console.log(`\n${passed}/${results.length} camera simulation scenarios passed.`);
  console.log(`SIMULATION_RESULT_JSON=${JSON.stringify({ algorithm: COACHING_ALGORITHM_VERSION, passed, total: results.length, scenarios: results })}`);
  if (passed !== results.length) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
