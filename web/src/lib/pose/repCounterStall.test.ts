/**
 * repCounterStall.test.ts
 *
 * D-50: a camera-loop stall no longer makes the rep counter forget that the
 * limb was at rest. Through the camera loop itself (the replay harness), a
 * neck bend, side bend or arm raise whose start falls inside a pause with no frame at
 * all still counts when the pause is under 1 s. A start hidden by frames the
 * camera processed without a reading (ears or an elbow out of view, a
 * rejected capture, no person) is still refused after 300 ms, as before.
 * The recordings behind it: C1, C4 and session 230
 * (Review_Artifacts/2026-10-22_rep_counter_gap_proposal/).
 *
 *   npx tsx src/lib/pose/repCounterStall.test.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { EXERCISE_REGISTRY } from "../exercises/registry";
import { captureCoachingProvenance } from "./coachingConfig";
import { computeNeckLateralFlexionSigned, frameAspectOf, NO_ASPECT_CORRECTION } from "./poseMetrics";
import { createCameraReplay } from "../../../scripts/lib/cameraReplayHarness";

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
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
function assertEq<T>(actual: T, expected: T, msg: string) {
  if (actual !== expected) throw new Error(`${msg}: expected ${String(expected)}, got ${String(actual)}`);
}

const FRAME_MS = 33;
const WIDE = frameAspectOf(1280, 720);
const RAD = Math.PI / 180;
const p = (x: number, y: number, visibility = 1) => ({ x, y, z: 0, visibility });

// ── Figures read at `deg` by the camera loop at 1280x720 (D-48) ─────────────
function rawHead(deg: number, earsVisible: boolean): any[] {
  const lm = Array.from({ length: 33 }, () => p(0.5, 0.5));
  const r = deg * RAD;
  const ear = earsVisible ? 1 : 0.1;
  lm[7] = p(0.5 + 0.1 * Math.cos(r), 0.23 - 0.1 * Math.sin(r), ear);
  lm[8] = p(0.5 - 0.1 * Math.cos(r), 0.23 + 0.1 * Math.sin(r), ear);
  lm[11] = p(0.6, 0.35); lm[12] = p(0.4, 0.35);
  lm[13] = p(0.61, 0.5); lm[14] = p(0.39, 0.5);
  lm[15] = p(0.61, 0.65); lm[16] = p(0.39, 0.65);
  lm[23] = p(0.58, 0.7); lm[24] = p(0.42, 0.7);
  return lm;
}
// Positive = patient's left (neckSideAgreement.test.ts), as in neckLateralFlexionCounting.test.ts.
const orientation = Math.sign(computeNeckLateralFlexionSigned(rawHead(20, true), { cameraTiltDeg: 0, confidence: "high", divergenceDeg: null }, "left", NO_ASPECT_CORRECTION) ?? 0);
const neck = (deg: number, readable = true) => rawHead(orientation * Math.atan(Math.tan(deg * RAD) * WIDE) / RAD, readable);

// The left arm raised `deg` from the trunk in pixels; the right arm hangs.
function arm(deg: number, readable = true): any[] {
  const lm = Array.from({ length: 33 }, () => p(0.5, 0.5));
  lm[7] = p(0.6, 0.23); lm[8] = p(0.4, 0.23);
  lm[11] = p(0.6, 0.35); lm[12] = p(0.4, 0.35);
  lm[23] = p(0.6, 0.7); lm[24] = p(0.4, 0.7);
  const place = (shoulder: number, joint: number, angle: number, sign: number, lengthPx: number, visibility = 1) => {
    lm[joint] = p(lm[shoulder].x + (sign * lengthPx * Math.sin(angle * RAD)) / 1280, 0.35 + (lengthPx * Math.cos(angle * RAD)) / 720, visibility);
  };
  place(11, 13, deg, 1, 115, readable ? 1 : 0.1); place(11, 15, deg, 1, 216);
  place(12, 14, 0, -1, 115); place(12, 16, 0, -1, 216);
  return lm;
}

// The head swung `deg` about the hip midpoint in pixels: a side bend (ex_005).
function trunk(deg: number, readable = true): any[] {
  const lm = Array.from({ length: 33 }, () => p(0.5, 0.5));
  lm[23] = p(0.55, 0.75); lm[24] = p(0.45, 0.75);
  const x = 0.5 + (330 * Math.sin(deg * RAD)) / 1280, y = 0.75 - (330 * Math.cos(deg * RAD)) / 720;
  const ear = readable ? 1 : 0.1;
  lm[7] = p(x + 0.03, y, ear); lm[8] = p(x - 0.03, y, ear);
  lm[11] = p(0.58 + (x - 0.5) * 0.6, 0.4); lm[12] = p(0.42 + (x - 0.5) * 0.6, 0.4);
  return lm;
}

// ── One movement with an interruption near its start ───────────────────────
type Interruption =
  | { kind: "none" }
  | { kind: "stall"; ms: number }                       // no frame processed at all
  | { kind: "unread"; ms: number }                      // frames processed, no reading
  | { kind: "then-stall"; tick: "rejected" | "no-person"; ms: number; stallMs: number };

/** Rest, a 700 ms rise to `peak`, a 250 ms hold, a 700 ms return, rest; interrupted from `fromMs` into the rise. */
async function countMovement(exerciseId: "ex_001" | "ex_004" | "ex_005", peak: number, fromMs: number, interruption: Interruption) {
  const definition = EXERCISE_REGISTRY[exerciseId];
  const replay = createCameraReplay(definition, await captureCoachingProvenance(definition), { prescribedSide: exerciseId === "ex_001" ? "left" : "both" });
  const figure = exerciseId === "ex_004" ? neck : exerciseId === "ex_005" ? trunk : arm;
  const at = (ms: number) => ms < 0 ? 0 : ms < 700 ? (peak * ms) / 700 : ms < 950 ? peak : ms < 1650 ? peak * (1 - (ms - 950) / 700) : 0;
  const extra = exerciseId === "ex_004" ? { frozenTilt: 0, earLine: 0 }
    : exerciseId === "ex_005" ? { frozenTilt: 0, baselines: { bidirectionalPrimary: 0 } }
    : { baselines: { scapLeft: 0.12 / 0.35, scapRight: 0.12 / 0.35 } };
  let t = 1000;
  const start = t + 1000; // the rise begins after a second at rest
  const until = interruption.kind === "none" ? 0 : interruption.kind === "then-stall" ? interruption.ms + interruption.stallMs : interruption.ms;
  while (t < start + 2700) {
    t += FRAME_MS;
    const ms = t - start;
    const inside = ms >= fromMs && ms < fromMs + until;
    if (!inside) { replay.tick({ tMs: t, landmarks: figure(at(ms)), ...extra }); continue; }
    if (interruption.kind === "stall") continue;
    if (interruption.kind === "unread") { replay.tick({ tMs: t, landmarks: figure(at(ms), false), ...extra }); continue; }
    if (interruption.kind === "then-stall" && ms < fromMs + interruption.ms) {
      replay.tick({ tMs: t, landmarks: figure(at(ms)), ...extra,
        ...(interruption.tick === "rejected" ? { accepted: false } : { noPerson: true }) });
    }
  }
  // The side bend's one counter tags its side at the peak; the others count the left side.
  return replay.emitted.filter((r: any) => exerciseId === "ex_005" || r.side === "left").length;
}

async function main() {
  console.log("\nD-50: rest evidence across a camera-loop stall\n");

  // ex_004: 22 from the calibration ear line (start 6.8). The rise passes the
  // start line at 216 ms; each interruption starts at 130 ms (4.1).
  await test("neck: an uninterrupted bend counts (control)", async () => {
    assertEq(await countMovement("ex_004", 22, 130, { kind: "none" }), 1, "left bends");
  });
  await test("neck: a 0.4 s stall as the bend starts no longer loses it (D-50)", async () => {
    assertEq(await countMovement("ex_004", 22, 130, { kind: "stall", ms: 400 }), 1, "left bends");
  });
  await test("neck: a stall over 1 s still clears the rest evidence", async () => {
    assertEq(await countMovement("ex_004", 22, 130, { kind: "stall", ms: 1200 }), 0, "left bends");
  });
  await test("neck: 0.4 s of frames without both ears still refuses the start", async () => {
    assertEq(await countMovement("ex_004", 22, 130, { kind: "unread", ms: 400 }), 0, "left bends");
  });
  await test("neck: rejected frames, then a stall, still refuse the start", async () => {
    assertEq(await countMovement("ex_004", 22, 130, { kind: "then-stall", tick: "rejected", ms: 132, stallMs: 270 }), 0, "left bends");
  });
  await test("neck: frames with no person, then a stall, still refuse the start", async () => {
    assertEq(await countMovement("ex_004", 22, 130, { kind: "then-stall", tick: "no-person", ms: 132, stallMs: 270 }), 0, "left bends");
  });

  // ex_001: a 95 raise (start 32.9) passes the start line at 242 ms; each
  // interruption starts at 150 ms (20.4).
  await test("arm raise: an uninterrupted raise counts (control)", async () => {
    assertEq(await countMovement("ex_001", 95, 150, { kind: "none" }), 1, "left raises");
  });
  await test("arm raise: a 0.4 s stall as the raise starts no longer loses it (D-50)", async () => {
    assertEq(await countMovement("ex_001", 95, 150, { kind: "stall", ms: 400 }), 1, "left raises");
  });
  await test("arm raise: 0.4 s with the elbow out of view still refuses the start", async () => {
    assertEq(await countMovement("ex_001", 95, 150, { kind: "unread", ms: 400 }), 0, "left raises");
  });

  // ex_005: a 32 side bend (start 8.8) passes the start line at 192 ms; its one
  // counter wraps a RepCounter. Each interruption starts at 110 ms (5.0).
  await test("side bend: an uninterrupted bend counts (control)", async () => {
    assertEq(await countMovement("ex_005", 32, 110, { kind: "none" }), 1, "bends");
  });
  await test("side bend: a 0.4 s stall as the bend starts no longer loses it (D-50)", async () => {
    assertEq(await countMovement("ex_005", 32, 110, { kind: "stall", ms: 400 }), 1, "bends");
  });
  await test("side bend: 0.4 s without both ears still refuses the start", async () => {
    assertEq(await countMovement("ex_005", 32, 110, { kind: "unread", ms: 400 }), 0, "bends");
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exitCode = 1;
}

void main();
