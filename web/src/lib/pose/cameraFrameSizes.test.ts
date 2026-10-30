/**
 * cameraFrameSizes.test.ts
 *
 * The capture summary must record every camera frame size a session measured
 * on, so a session whose frame shape changed is not described by its last size
 * alone (review of b84ebac, 2026-10-14). Runs the camera page's own
 * frame loop (through the replay harness) across a size change and checks the
 * session-owned count, and that a frame that fails capture readiness is not
 * counted. Readings depend on the frame's shape; the thresholds were tuned on
 * 16:9 frames.
 *
 *   npx tsx src/lib/pose/cameraFrameSizes.test.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import { createCameraReplay } from "../../../scripts/lib/cameraReplayHarness";
import { captureCoachingProvenance } from "./coachingConfig";
import { getExerciseDefinition } from "../exercises/registry";
import { buildCaptureQualitySummary } from "../sessionReadModels";

function pose(): any[] {
  const p = (x: number, y: number) => ({ x, y, z: 0, visibility: 1 });
  const lm = Array.from({ length: 33 }, () => p(0.5, 0.5));
  lm[7] = p(0.55, 0.23); lm[8] = p(0.45, 0.23);
  lm[11] = p(0.6, 0.35); lm[12] = p(0.4, 0.35);
  lm[13] = p(0.62, 0.5); lm[14] = p(0.38, 0.5);
  lm[15] = p(0.63, 0.63); lm[16] = p(0.37, 0.63);
  lm[23] = p(0.57, 0.7); lm[24] = p(0.43, 0.7);
  return lm;
}

async function run() {
  console.log("\ncamera frame sizes\n");
  const definition = getExerciseDefinition("ex_001")!;
  const replay = createCameraReplay(definition, await captureCoachingProvenance(definition));
  const baselines = { scapLeft: 0.2, scapRight: 0.2, bidirectionalPrimary: null };
  let t = 1000;
  for (let i = 0; i < 10; i++) replay.tick({ tMs: t += 100, landmarks: pose(), baselines });
  // The camera now delivers 640x480 frames, as after switching to another camera.
  replay.context.videoRef.current.videoWidth = 640;
  replay.context.videoRef.current.videoHeight = 480;
  for (let i = 0; i < 10; i++) replay.tick({ tMs: t += 100, landmarks: pose(), baselines });
  replay.tick({ tMs: t += 100, landmarks: pose(), baselines, accepted: false });

  const sizes = replay.context.captureFrameSizesRef.current;
  assert.deepEqual({ ...sizes }, { "1280x720": 10, "640x480": 10 }, `both sizes counted: ${JSON.stringify(sizes)}`);
  assert.equal(replay.context.captureFramesOkRef.current, 20, "the 20 accepted frames");
  console.log("  ✓ both frame sizes of a session whose frame changed are counted");

  const summary = buildCaptureQualitySummary({
    total: replay.context.captureFramesTotalRef.current,
    ok: replay.context.captureFramesOkRef.current,
    rejectedByStatus: replay.context.captureRejectedByStatusRef.current,
    dropoutResets: replay.context.captureDropoutResetsRef.current,
    frameSizes: sizes,
  });
  assert.equal(summary?.framesTotal, 21);
  assert.equal(JSON.stringify(summary?.frameSizes), JSON.stringify([
    { width: 1280, height: 720, frames: 10 }, { width: 640, height: 480, frames: 10 },
  ]), "the summary lists both, so the session shows as mixed");
  console.log("  ✓ a frame that fails capture readiness is not counted, and the summary lists both sizes");

  console.log("\n2 passed, 0 failed\n");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
