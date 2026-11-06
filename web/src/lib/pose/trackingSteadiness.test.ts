/**
 * trackingSteadiness.test.ts
 *
 * Pins the display-only tracking check: a point's jump is its distance from the
 * line through its neighbours, over the shoulder width; a point is unsteady
 * when its one-second median jump passes its limit, so smooth movement, a fast
 * turn or one glitch never count and repeated jumping does; gaps and points off
 * the picture measure nothing; the check still judges at 7 frames a second and
 * says when it cannot; the message is held; each repetition counts its own
 * frames, checked frames and parts, and one longer than the marks reach gets no
 * record.
 *
 * USAGE
 *   npx tsx src/lib/pose/trackingSteadiness.test.ts
 */

import { EXERCISE_REGISTRY } from "@/lib/exercises/registry";
import {
  NO_TRACKING_MESSAGE,
  TRACKING_STEADINESS,
  addTrackingMark,
  isRepTracking,
  newSteadinessState,
  repTracking,
  trackingParts,
  trackingRegion,
  updateSteadiness,
  updateTrackingMessage,
  type SteadinessResult,
  type TrackingFrameMark,
} from "./trackingSteadiness";

let testsPassed = 0;
let testsFailed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  PASS ${name}`);
    testsPassed += 1;
  } catch (err) {
    console.log(`  FAIL ${name}`);
    console.log(`      ${err instanceof Error ? err.message : String(err)}`);
    testsFailed += 1;
  }
}

function assertEq(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const W = 1280;
const H = 720;

/** A standing pose on a 1280 x 720 frame; shoulder width 128 px. */
function standing(): { x: number; y: number }[] {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5 }));
  const set = (i: number, x: number, y: number) => { lm[i] = { x, y }; };
  set(0, 0.5, 0.18); set(7, 0.48, 0.17); set(8, 0.52, 0.17);
  set(11, 0.45, 0.3); set(12, 0.55, 0.3);
  set(13, 0.42, 0.45); set(14, 0.58, 0.45);
  set(15, 0.41, 0.58); set(16, 0.59, 0.58);
  set(23, 0.47, 0.6); set(24, 0.53, 0.6);
  return lm;
}

/** Deterministic noise in pixels, about +/- `amp`. */
function noise(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648 - 0.5;
  };
}

function run(frames: { x: number; y: number }[][], dtMs = 40): SteadinessResult[] {
  let state = newSteadinessState();
  const out: SteadinessResult[] = [];
  frames.forEach((lm, k) => {
    const step = updateSteadiness(state, lm, k * dtMs, W, H);
    state = step.state;
    out.push(step.result);
  });
  return out;
}

const anyUnsteady = (results: SteadinessResult[]) =>
  results.some((r) => Object.values(r.unsteady).some(Boolean));

test("a still person with sub-pixel noise is steady", () => {
  const rand = noise(7);
  const frames = Array.from({ length: 150 }, () =>
    standing().map((p) => ({ x: p.x + (0.6 * rand()) / W, y: p.y + (0.6 * rand()) / H })));
  assertEq(anyUnsteady(run(frames)), false, "no part unsteady");
});

test("fast arm raises with sharp turns at the top are steady", () => {
  // Both arms swing from the side to shoulder height and back at 180 degrees a
  // second: every turn gives one large jump, which a one-second median ignores.
  const frames = Array.from({ length: 200 }, (_, k) => {
    const lm = standing();
    const phase = (k * 0.04 * 180) % 180;
    const angle = ((phase <= 90 ? phase : 180 - phase) * Math.PI) / 180;
    const armPx = 216;
    for (const [shoulder, elbow, wrist, sign] of [[11, 13, 15, -1], [12, 14, 16, 1]] as const) {
      const sx = lm[shoulder].x * W;
      const sy = lm[shoulder].y * H;
      const ex = sx + sign * Math.sin(angle) * armPx * 0.5;
      const ey = sy + Math.cos(angle) * armPx * 0.5;
      const wx = sx + sign * Math.sin(angle) * armPx;
      const wy = sy + Math.cos(angle) * armPx;
      lm[elbow] = { x: ex / W, y: ey / H };
      lm[wrist] = { x: wx / W, y: wy / H };
    }
    return lm;
  });
  const results = run(frames);
  assertEq(anyUnsteady(results), false, "no part unsteady");
  const wristMedian = Math.max(...results.map((r) => r.medians[15] ?? 0));
  if (!(wristMedian < 0.05)) throw new Error(`wrist median stayed low: ${wristMedian}`);
});

test("a wrist that keeps jumping makes its arm unsteady", () => {
  const frames = Array.from({ length: 40 }, (_, k) => {
    const lm = standing();
    lm[15] = { x: lm[15].x + ((k % 2 ? 25 : -25) / W), y: lm[15].y };
    return lm;
  });
  const results = run(frames);
  const last = results[results.length - 1];
  assertEq(last.unsteady.leftArm, true, "left arm");
  assertEq(last.unsteady.rightArm, false, "right arm");
  assertEq(last.unsteady.trunk, false, "trunk");
  // 50 px out and back over 128 px of shoulder width.
  if (Math.abs((last.medians[15] ?? 0) - 50 / 128) > 0.01) throw new Error(`median ${last.medians[15]}`);
  const first = results.findIndex((r) => r.unsteady.leftArm);
  // The first jump needs three frames, so frame k holds k - 1 jumps.
  assertEq(first, TRACKING_STEADINESS.minJumps + 1, "judged once the window holds minJumps jumps");
});

test("an elbow jumping by 12 px passes the 0.15 limit, a wrist needs more", () => {
  const frames = (index: number, px: number) => Array.from({ length: 40 }, (_, k) => {
    const lm = standing();
    lm[index] = { x: lm[index].x + ((k % 2 ? px : -px) / W), y: lm[index].y };
    return lm;
  });
  assertEq(run(frames(13, 12)).at(-1)!.unsteady.leftArm, true, "elbow 24/128 = 0.19");
  assertEq(run(frames(15, 12)).at(-1)!.unsteady.leftArm, false, "wrist 0.19 under 0.25");
});

test("one glitch is not enough", () => {
  const frames = Array.from({ length: 60 }, (_, k) => {
    const lm = standing();
    if (k === 30) lm[15] = { x: lm[15].x + 60 / W, y: lm[15].y };
    return lm;
  });
  assertEq(anyUnsteady(run(frames)), false, "no part unsteady");
});

test("frames further apart than maxGapMs measure nothing", () => {
  const frames = Array.from({ length: 40 }, (_, k) => {
    const lm = standing();
    lm[15] = { x: lm[15].x + ((k % 2 ? 40 : -40) / W), y: lm[15].y };
    return lm;
  });
  const results = run(frames, TRACKING_STEADINESS.maxGapMs + 30);
  assertEq(anyUnsteady(results), false, "no part unsteady");
  assertEq(results.at(-1)!.medians[15], null, "wrist not judged");
  assertEq(results.at(-1)!.checked.leftArm, false, "and the arm reads as not checked");
});

/** Frame marks as the camera makes them, from each frame's result. */
const marksOf = (results: SteadinessResult[], dtMs: number): TrackingFrameMark[] =>
  results.map((r, k) => ({
    t: k * dtMs,
    captureOk: true,
    checked: (Object.keys(r.checked) as (keyof typeof r.checked)[]).filter((part) => r.checked[part]),
    unsteady: (Object.keys(r.unsteady) as (keyof typeof r.unsteady)[]).filter((part) => r.unsteady[part]),
  }));

const jitteringWrist = () => Array.from({ length: 40 }, (_, k) => {
  const lm = standing();
  lm[15] = { x: lm[15].x + ((k % 2 ? 25 : -25) / W), y: lm[15].y };
  return lm;
});

test("at 7 frames a second a wrist that keeps jumping is still found", () => {
  const results = run(jitteringWrist(), 143);
  assertEq(results.at(-1)!.unsteady.leftArm, true, "left arm unsteady");
  const record = repTracking(marksOf(results, 143), 143 * 10, 143 * 39, trackingParts("arms", "left"))!;
  assertEq(record.checkedFrames, record.frames, "every frame of the repetition judged");
  assertEq(record.unsteadyFrames, record.frames, "and found unsteady");
});

test("at 5 frames a second the check cannot judge, and the record says so", () => {
  // Five jumps are needed in one second: frames 200 ms apart give four.
  const results = run(jitteringWrist(), 200);
  assertEq(anyUnsteady(results), false, "nothing flagged");
  const record = repTracking(marksOf(results, 200), 200 * 10, 200 * 39, trackingParts("arms", "left"))!;
  assertEq(record.frames, 30, "frames counted");
  assertEq(record.checkedFrames, 0, "none checked, so not read as steady");
});

test("a point outside the picture is skipped", () => {
  const frames = Array.from({ length: 40 }, (_, k) => {
    const lm = standing();
    lm[15] = { x: 1.1 + (k % 2 ? 0.03 : -0.03), y: lm[15].y };
    return lm;
  });
  const results = run(frames);
  assertEq(results.at(-1)!.unsteady.leftArm, false, "left arm");
  assertEq(results.at(-1)!.medians[15], null, "wrist not judged");
});

test("a head exercise is judged on the head and trunk only", () => {
  assertEq(trackingParts("head", "left").join(","), "head,trunk", "head, left");
  assertEq(trackingParts("arms", "left").join(","), "leftArm,trunk", "arms, left");
  assertEq(trackingParts("arms", "right").join(","), "rightArm,trunk", "arms, right");
  assertEq(trackingParts("arms", "both").join(","), "leftArm,rightArm,trunk", "arms, both");
  assertEq(trackingRegion(EXERCISE_REGISTRY.ex_004), "head", "neck bends");
  assertEq(trackingRegion(EXERCISE_REGISTRY.ex_005), "head", "side bends");
  for (const id of ["ex_001", "ex_006", "ex_007", "ex_008"]) {
    assertEq(trackingRegion(EXERCISE_REGISTRY[id]), "arms", id);
  }
});

test("the message keeps its part and holds after the last unsteady frame", () => {
  const hold = TRACKING_STEADINESS.messageHoldMs;
  let m = updateTrackingMessage(NO_TRACKING_MESSAGE, ["rightArm"], 0);
  assertEq(m.part, "rightArm", "named");
  m = updateTrackingMessage(m, ["leftArm", "rightArm"], 100);
  assertEq(m.part, "rightArm", "kept while still unsteady");
  m = updateTrackingMessage(m, [], 100 + hold - 1);
  assertEq(m.part, "rightArm", "held");
  m = updateTrackingMessage(m, [], 100 + hold);
  assertEq(m.part, null, "cleared after the hold");
});

test("a repetition counts only its own frames and parts", () => {
  const all = ["leftArm", "rightArm", "trunk"] as const;
  const marks: TrackingFrameMark[] = [
    { t: 0, captureOk: true, checked: all, unsteady: ["leftArm"] },
    { t: 100, captureOk: true, checked: ["rightArm"], unsteady: [] },
    { t: 200, captureOk: false, checked: [], unsteady: [] },
    { t: 300, captureOk: true, checked: all, unsteady: ["rightArm"] },
    { t: 400, captureOk: true, checked: all, unsteady: ["leftArm", "trunk"] },
    { t: 500, captureOk: true, checked: all, unsteady: ["leftArm"] },
  ];
  const left = repTracking(marks, 100, 400, trackingParts("arms", "left"))!;
  assertEq(JSON.stringify(left), JSON.stringify({
    version: 1, check: "tracking_steadiness_v1", frames: 4, rejectedFrames: 1, checkedFrames: 2, unsteadyFrames: 1,
  }), "left arm repetition");
  const right = repTracking(marks, 100, 400, trackingParts("arms", "right"))!;
  assertEq(right.checkedFrames, 3, "right arm and trunk checked");
  assertEq(right.unsteadyFrames, 2, "right arm and trunk unsteady");
  assertEq(isRepTracking(left), true, "valid record");
  assertEq(isRepTracking({ ...left, unsteadyFrames: 3 }), false, "more unsteady than checked");
  assertEq(isRepTracking({ ...left, checkedFrames: 4 }), false, "more checked than frames passing readiness");
  assertEq(isRepTracking({ ...left, frames: 2.5 }), false, "not a count");
  assertEq(isRepTracking({ ...left, check: "other" }), false, "other check");
  const withoutChecked: Record<string, unknown> = { ...left };
  delete withoutChecked.checkedFrames;
  assertEq(isRepTracking(withoutChecked), false, "a record must say how many frames were checked");
});

test("frame marks reach back markHorizonMs; a longer repetition gets no record", () => {
  const horizon = TRACKING_STEADINESS.markHorizonMs;
  let marks: TrackingFrameMark[] = [];
  for (let t = 0; t <= horizon + 20_000; t += 100) {
    marks = addTrackingMark(marks, { t, captureOk: true, checked: ["leftArm"], unsteady: [] });
  }
  const now = marks[marks.length - 1].t;
  if (!(now - marks[0].t >= horizon)) throw new Error(`kept ${now - marks[0].t} ms`);
  if (!(now - marks[0].t <= horizon + 10_000)) throw new Error(`older marks dropped: kept ${now - marks[0].t} ms`);
  const parts = trackingParts("arms", "left");
  assertEq(repTracking(marks, now - 60_000, now, parts)?.frames, 601, "a 60 s repetition keeps all its frames");
  assertEq(repTracking(marks, now - horizon - 15_000, now, parts), null, "one that began before the oldest mark has no record");
});

test("the limits sit above every ordinary level measured", () => {
  // Largest one-second medians in the researcher's six session videos
  // (Review_Artifacts evidence): 0.211 wrists and 0.131 others with every third
  // frame kept; 0.234 and 0.113 under the live 250 ms gap rule with every 2nd
  // to 5th frame kept.
  if (!(TRACKING_STEADINESS.wristLimit > 0.234)) throw new Error("wrist limit");
  if (!(TRACKING_STEADINESS.otherLimit > 0.131)) throw new Error("other limit");
  assertEq(TRACKING_STEADINESS.maxGapMs, 250, "gap limit checked at 250 ms");
});

test("the input state is not mutated", () => {
  const start = newSteadinessState();
  const frozen = JSON.stringify(start);
  const one = updateSteadiness(start, standing(), 0, W, H).state;
  const frozenOne = JSON.stringify(one);
  updateSteadiness(one, standing(), 40, W, H);
  assertEq(JSON.stringify(start), frozen, "start unchanged");
  assertEq(JSON.stringify(one), frozenOne, "second state unchanged");
});

console.log(`\n  ${testsPassed} passed, ${testsFailed} failed\n`);
process.exit(testsFailed === 0 ? 0 : 1);
