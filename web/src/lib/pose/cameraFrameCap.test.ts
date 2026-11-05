/**
 * cameraFrameCap.test.ts
 *
 * The camera loop processes at most CAMERA_LOOP_MAX_FPS frames a second, the
 * rate the system was developed and tuned at, however fast the computer and its
 * screen are; a computer that cannot reach the rate runs as before. Checks the
 * slot schedule on 60, 144 and 30 Hz screen refreshes, on a slow computer, at the
 * 50 ms step the camera tests use, after a stall and switched off; the page
 * address switch; and, through the camera page's own frame loop (the replay
 * harness), that a refresh without a slot runs no detection and leaves the
 * picture and the trace readout as they were.
 *
 *   npx tsx src/lib/pose/cameraFrameCap.test.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createCameraReplay } from "../../../scripts/lib/cameraReplayHarness";
import { captureCoachingProvenance } from "./coachingConfig";
import { getExerciseDefinition } from "../exercises/registry";
import {
  CAMERA_LOOP_MAX_FPS,
  cameraFrameCapEnabledFromSearch,
  newCameraFrameCap,
  takeCameraFrameSlot,
} from "./cameraFrameCap";

let failures = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures++;
    console.log(`  FAIL ${name}\n       ${(error as Error).message}`);
  }
}

/** The refresh times the loop processes. */
function processed(ticks: number[], enabled = true): number[] {
  const cap = newCameraFrameCap(enabled);
  return ticks.filter((t) => takeCameraFrameSlot(cap, t));
}

/** Screen refreshes at `hz` for `seconds`. */
function refreshes(hz: number, seconds: number, startMs = 1000): number[] {
  return Array.from({ length: Math.round(hz * seconds) }, (_, i) => startMs + (i * 1000) / hz);
}

function gaps(times: number[]): number[] {
  return times.slice(1).map((t, i) => t - times[i]);
}

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
  console.log("\ncamera frame cap\n");

  await check("60 Hz screen: every third refresh, 20 a second", () => {
    const p = processed(refreshes(60, 10));
    assert.equal(p.length, 200);
    for (const g of gaps(p)) assert(Math.abs(g - 50) < 0.01, `gap ${g}`);
  });

  await check("144 Hz screen: 20 a second, no two frames under 40 ms apart", () => {
    const p = processed(refreshes(144, 10));
    assert(p.length >= 199 && p.length <= 201, `count ${p.length}`);
    assert(Math.min(...gaps(p)) >= 40, `smallest gap ${Math.min(...gaps(p))}`);
  });

  await check("30 Hz refreshes (a browser's power saving): still 20 a second, not 15", () => {
    const p = processed(refreshes(30, 10));
    assert(p.length >= 199 && p.length <= 201, `count ${p.length}`);
  });

  await check("a slow computer (70 ms a frame) processes every frame, as before", () => {
    const ticks = refreshes(1000 / 70, 10);
    assert.equal(processed(ticks).length, ticks.length);
  });

  await check("frames exactly 50 ms apart are all processed", () => {
    const ticks = refreshes(20, 10);
    assert.equal(processed(ticks).length, ticks.length);
  });

  await check("after a 500 ms stall there is no burst to make up for it", () => {
    const before = refreshes(60, 1);
    const resume = before[before.length - 1] + 500;
    const afterStall = processed([...before, ...refreshes(60, 1, resume)]).filter((t) => t >= resume);
    const firstHalfSecond = afterStall.filter((t) => t < resume + 500);
    assert(firstHalfSecond.length <= 11, `${firstHalfSecond.length} frames in the half second after the stall`);
    assert(Math.min(...gaps(afterStall)) >= 25, `smallest gap after the stall ${Math.min(...gaps(afterStall))}`);
  });

  await check("switched off: every refresh is processed", () => {
    const ticks = refreshes(144, 2);
    assert.equal(processed(ticks, false).length, ticks.length);
  });

  await check("the page address switch", () => {
    assert.equal(cameraFrameCapEnabledFromSearch(""), true);
    assert.equal(cameraFrameCapEnabledFromSearch("?patientExerciseId=3"), true);
    assert.equal(cameraFrameCapEnabledFromSearch("?fpsCap=off"), false);
    assert.equal(cameraFrameCapEnabledFromSearch("?patientExerciseId=3&fpsCap=OFF"), false);
    assert.equal(cameraFrameCapEnabledFromSearch("?fpsCap=on"), true);
  });

  // Through the camera page's own frame loop.
  const definition = getExerciseDefinition("ex_001")!;
  const provenance = await captureCoachingProvenance(definition);
  const baselines = { scapLeft: 0.2, scapRight: 0.2, bidirectionalPrimary: null };
  function cameraLoop(frameCap: boolean) {
    const replay = createCameraReplay(definition, provenance, { frameCap });
    let detections = 0, clears = 0, readouts = 0;
    replay.context.landmarkerRef.current = { detectForVideo: () => { detections++; return { landmarks: [pose()] }; } };
    replay.context.canvasRef.current.getContext("2d").clearRect = () => { clears++; };
    replay.context.writeTraceSyncReadout = () => { readouts++; };
    return { replay, counts: () => ({ detections, clears, readouts }) };
  }

  await check("camera loop on a 60 Hz screen: 40 detections in 2 s, 120 with the limit off", () => {
    const on = cameraLoop(true);
    const off = cameraLoop(false);
    for (const t of refreshes(60, 2)) {
      on.replay.tick({ tMs: t, landmarks: pose(), baselines });
      off.replay.tick({ tMs: t, landmarks: pose(), baselines });
    }
    assert.equal(on.counts().detections, 40);
    assert.equal(off.counts().detections, 120);
  });

  await check("a refresh without a slot leaves the picture and the trace readout as they were", () => {
    const { replay, counts } = cameraLoop(true);
    replay.tick({ tMs: 1000, landmarks: pose(), baselines });
    const afterFrame = counts();
    assert.equal(afterFrame.detections, 1);
    assert(afterFrame.clears > 0, "the processed frame redraws the canvas");
    assert(afterFrame.readouts > 0, "the processed frame writes the trace readout");
    replay.tick({ tMs: 1000 + 1000 / 60, landmarks: pose(), baselines });
    assert.deepEqual(counts(), afterFrame);
  });

  await check("the camera page reads the switch and gates its loop on the limit", () => {
    const camera = readFileSync(fileURLToPath(new URL("../../app/(app)/camera/CameraClient.tsx", import.meta.url)), "utf8");
    assert(camera.includes("cameraFrameCapEnabledFromSearch(window.location.search)"));
    assert(camera.includes("takeCameraFrameSlot(cameraFrameCapRef.current, performance.now())"));
  });

  console.log(failures ? `\n${failures} failed` : `\nall passed (limit ${CAMERA_LOOP_MAX_FPS} frames a second)`);
  if (failures) process.exitCode = 1;
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
