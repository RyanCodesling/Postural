/**
 * Regression tests for the Reference Guide's demonstration clips. Run with:
 *
 *   npx tsx src/lib/exercises/demoClips.test.ts
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DEMO_CLIPS, demoClipFor, demoStatusAtTime } from "./demoClips";
import { EXERCISE_REGISTRY } from "./registry";

let testsPassed = 0;
let testsFailed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    testsPassed += 1;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`      ${err instanceof Error ? err.message : String(err)}`);
    testsFailed += 1;
  }
}

function assert(condition: boolean, label: string): void {
  if (!condition) throw new Error(label);
}

console.log("\ndemoClips - Reference Guide clip tests\n");

test("every crop lies inside its source frame with a positive size", () => {
  for (const [id, clip] of Object.entries(DEMO_CLIPS)) {
    const { x, y, w, h } = clip.crop;
    assert([x, y, w, h].every(Number.isInteger), `${id}: crop must be whole pixels`);
    assert(x >= 0 && y >= 0 && w > 0 && h > 0, `${id}: crop origin/size out of range`);
    assert(x + w <= clip.width, `${id}: crop runs past the right edge (${x + w} > ${clip.width})`);
    assert(y + h <= clip.height, `${id}: crop runs past the bottom edge (${y + h} > ${clip.height})`);
  }
});

test("every clip uses the ex_001 crop scaled to its own frame", () => {
  const ref = DEMO_CLIPS.ex_001;
  const refAspect = ref.crop.w / ref.crop.h;
  for (const [id, clip] of Object.entries(DEMO_CLIPS)) {
    const sx = clip.width / ref.width;
    const sy = clip.height / ref.height;
    const expected = { x: ref.crop.x * sx, y: ref.crop.y * sy, w: ref.crop.w * sx, h: ref.crop.h * sy };
    for (const key of ["x", "y", "w", "h"] as const) {
      assert(
        Math.abs(clip.crop[key] - expected[key]) <= 0.5,
        `${id}: crop.${key} ${clip.crop[key]} is not the scaled ex_001 value ${expected[key].toFixed(2)}`,
      );
    }
    const aspect = clip.crop.w / clip.crop.h;
    assert(Math.abs(aspect / refAspect - 1) < 0.001, `${id}: shown shape differs from ex_001 (${aspect.toFixed(4)})`);
  }
});

test("the 870 x 980 clips use the reference crop checked against every frame", () => {
  for (const id of ["ex_001", "ex_005", "ex_006", "ex_007", "ex_008"]) {
    const clip = DEMO_CLIPS[id];
    assert(clip !== undefined, `${id} must have a clip`);
    assert(clip.width === 870 && clip.height === 980, `${id}: unexpected frame size`);
    const { x, y, w, h } = clip.crop;
    assert(x === 43 && y === 108 && w === 784 && h === 847, `${id}: crop ${JSON.stringify(clip.crop)} was not the one checked`);
  }
});

test("each clip is served under the exercise it demonstrates", () => {
  for (const [id, clip] of Object.entries(DEMO_CLIPS)) {
    assert(clip.src === `/demos/${id}-figure-motion.mp4`, `${id}: unexpected src ${clip.src}`);
    assert(clip.subject.trim().length > 0, `${id}: missing subject for the accessible label`);
  }
});

test("every clip belongs to an exercise in the registry", () => {
  for (const id of Object.keys(DEMO_CLIPS)) {
    assert(id in EXERCISE_REGISTRY, `${id} is not a registry exercise`);
  }
});

test("exercises without an accepted guide animation have no clip", () => {
  assert(demoClipFor("ex_004") === null, "ex_004's active neck-tilt draft is not accepted for the guide");
  assert(demoClipFor("ex_005") === DEMO_CLIPS.ex_005, "ex_005's side-bend animation is back");
  assert(demoClipFor("ex_008") === DEMO_CLIPS.ex_008, "ex_008's wall-angels animation is published");
});

test("no id, an unknown id, or an inherited key returns null", () => {
  assert(demoClipFor(null) === null, "null id");
  assert(demoClipFor(undefined) === null, "undefined id");
  assert(demoClipFor("") === null, "empty id");
  assert(demoClipFor("ex_999") === null, "unknown id");
  assert(demoClipFor("toString") === null, "inherited key");
  assert(demoClipFor("ex_006") === DEMO_CLIPS.ex_006, "known id returns its clip");
});

test("the camera page takes its clip from this module, not a hard-coded exercise", () => {
  const camera = readFileSync(
    fileURLToPath(new URL("../../app/(app)/camera/CameraClient.tsx", import.meta.url)),
    "utf8",
  );
  assert(camera.includes("demoClipFor("), "CameraClient must look clips up with demoClipFor");
  assert(!camera.includes('exerciseId === "ex_001"'), "the single-exercise clip check must be gone");
});

test("hold labels follow exact video boundaries and a loop back to zero", () => {
  const clip = DEMO_CLIPS.ex_006;
  assert(demoStatusAtTime(clip, 94 / 30).phase === "Raise", "frame 95 still raises");
  assert(demoStatusAtTime(clip, 95 / 30).phase === "Hold", "frame 96 begins hold");
  assert(demoStatusAtTime(clip, 203 / 30).phase === "Hold", "frame 204 still holds");
  assert(demoStatusAtTime(clip, 204 / 30).phase === "Lower", "frame 205 begins lowering");
  assert(demoStatusAtTime(clip, 10).phase === "Ready", "end-of-file stays at final pose");
  assert(demoStatusAtTime(clip, 0).phase === "Ready", "loop starts at Ready");
});

test("wall view changes at 7.8 seconds even while the phase stays Ready", () => {
  const clip = DEMO_CLIPS.ex_008;
  assert(demoStatusAtTime(clip, 233 / 30).view === "Front view", "frame 234 is front");
  const cut = demoStatusAtTime(clip, 7.8);
  assert(cut.view === "Side view" && cut.phase === "Ready", "frame 235 side cut");
  assert(demoStatusAtTime(clip, 8.2).phase === "Slide up", "second repetition begins");
  assert(demoStatusAtTime(clip, 0).view === "Front view", "loop restores front label");
});

test("seeking backward and invalid media time cannot leave a stale phase", () => {
  const clip = DEMO_CLIPS.ex_007;
  assert(demoStatusAtTime(clip, 6).phase === "Lower", "later seek");
  assert(demoStatusAtTime(clip, 2).phase === "Press", "backward seek");
  assert(demoStatusAtTime(clip, NaN).phase === "Ready", "metadata not yet loaded");
  assert(demoStatusAtTime(clip, -1).phase === "Ready", "negative time");
});

test("detail crops stay within the source and timelines remain ordered", () => {
  for (const [id, clip] of Object.entries(DEMO_CLIPS)) {
    const { x, y, w, h } = clip.detail.crop;
    assert(x >= 0 && y >= 108 && w > 0 && h > 0 && x + w <= clip.width && y + h <= clip.height, `${id}: detail bounds`);
    for (const list of [clip.phases, clip.views ?? [{ start: 1, label: "Front view" }]]) {
      assert(list[0].start === 1, `${id}: labels must start on the first frame`);
      list.forEach((item, i) => {
        assert(item.start <= clip.frames && (i === 0 || item.start > list[i - 1].start), `${id}: ordered label boundaries`);
      });
    }
  }
});

console.log(`\n${testsPassed} passed, ${testsFailed} failed`);
if (testsFailed > 0) {
  process.exitCode = 1;
}
