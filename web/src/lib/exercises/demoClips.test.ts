/**
 * Regression tests for the Reference Guide's demonstration clips. Run with:
 *
 *   npx tsx src/lib/exercises/demoClips.test.ts
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DEMO_CLIPS, demoClipFor, demoCueIndexAtTime, demoCueSpoken, demoRepCues, demoStatusAtTime } from "./demoClips";
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
  for (const id of ["ex_001", "ex_004", "ex_005", "ex_006", "ex_007", "ex_008"]) {
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
  assert(demoClipFor("ex_002") === null, "deprecated ex_002 has no guide animation");
  assert(demoClipFor("ex_003") === null, "deprecated ex_003 has no guide animation");
  assert(demoClipFor("ex_004") === DEMO_CLIPS.ex_004, "ex_004's active neck-tilt animation is accepted");
  assert(demoClipFor("ex_005") === DEMO_CLIPS.ex_005, "ex_005's side-bend animation is back");
  assert(demoClipFor("ex_008") === DEMO_CLIPS.ex_008, "ex_008's wall-angels animation is published");
});

test("the neck swing has no rest, so its one label holds for the whole loop", () => {
  const clip = DEMO_CLIPS.ex_004;
  for (const seconds of [0, 0.7, 4.5, 8.99, 9]) {
    assert(demoStatusAtTime(clip, seconds).phase === "Swing", `${seconds} s is still Swing`);
  }
  assert(clip.frames === 270 && clip.fps === 30, "three 3-second cycles at 30 fps");
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

test("every clip has ordered spoken cues inside its timeline", () => {
  for (const [id, clip] of Object.entries(DEMO_CLIPS)) {
    assert(clip.cues.length >= 2, `${id}: needs at least two spoken cues`);
    clip.cues.forEach((cue, i) => {
      assert(cue.text.trim().length > 0, `${id}: empty cue text`);
      assert(Number.isInteger(cue.start) && cue.start >= 1 && cue.start <= clip.frames, `${id}: cue ${i} outside the clip`);
      assert(i === 0 || cue.start > clip.cues[i - 1].start, `${id}: cues out of order`);
    });
  }
});

test("every recorded line ends before the next one starts at 1×, across the loop", () => {
  for (const [id, clip] of Object.entries(DEMO_CLIPS)) {
    const loop = clip.frames / clip.fps;
    clip.cues.forEach((cue, i) => {
      const next = clip.cues[(i + 1) % clip.cues.length];
      const nextStart = (next.start - 1) / clip.fps + (i + 1 === clip.cues.length ? loop : 0);
      const end = (cue.start - 1) / clip.fps + cue.speech;
      assert(end <= nextStart, `${id}: "${cue.text}" runs ${(end - nextStart).toFixed(2)} s into "${next.text}"`);
    });
  }
});

test("every recorded line is published next to the clips", () => {
  for (const [id, clip] of Object.entries(DEMO_CLIPS)) {
    for (const cue of clip.cues) {
      assert(/^\/demos\/voice\/[a-z-]+\.mp3$/.test(cue.audio), `${id}: unexpected audio path ${cue.audio}`);
      assert(existsSync(fileURLToPath(new URL(`../../../public${cue.audio}`, import.meta.url))), `${id}: ${cue.audio} is missing`);
      assert(cue.speech > 0 && cue.speech < 3, `${id}: implausible speech length for "${cue.text}"`);
    }
  }
});

test("lateral raise lines lead their movements and wrap across the loop", () => {
  const clip = DEMO_CLIPS.ex_001;
  const text = (frame: number) => clip.cues[demoCueIndexAtTime(clip, (frame - 1) / 30)].text;
  assert(text(1).startsWith("Relax"), "loop start is still the relax line");
  assert(demoCueIndexAtTime(clip, 0) === demoCueIndexAtTime(clip, 209 / 30), "no repeat across the loop seam");
  assert(text(16).startsWith("Raise") && 16 < 25, "the raise line starts before the raise");
  assert(text(112) === "Lower your arms." && 112 < 121, "the lower line starts before lowering");
  assert(text(NaN as unknown as number).startsWith("Relax"), "metadata not yet loaded");
});

test("neck lines alternate sides, one per 45-frame beat, ahead of each swing", () => {
  const clip = DEMO_CLIPS.ex_004;
  clip.cues.forEach((cue, i) => {
    if (i > 0) assert(cue.start - clip.cues[i - 1].start === 45, "one cue per beat");
    assert(cue.text === (i % 2 === 0 ? "Tilt right." : "Tilt left."), "sides alternate");
    assert((28 + 45 * i) - cue.start === 6, "each line leads its swing by 6 frames");
  });
  assert(clip.cues[demoCueIndexAtTime(clip, 0)].text === "Tilt left.", "frame 1 swings toward the figure's left");
  assert(clip.defaultSpeed === 0.5, "the neck guide starts at half speed so its lines are not back to back");
});

/** The lines a set speaks aloud when the voice is first allowed on cue `from`. */
function spokenInSet(id: string, from: number): string[] {
  const clip = DEMO_CLIPS[id];
  const spoken: string[] = [];
  for (let step = 0; step < clip.cues.length * 6; step++) {
    const index = (from + step) % clip.cues.length;
    if (demoCueSpoken(clip, index, spoken.length, 3)) spoken.push(clip.cues[index].text);
  }
  return spoken;
}

test("a set speaks exactly three whole repetitions, from any starting line", () => {
  const expected: Record<string, string[]> = {
    ex_001: ["Raise your arms to shoulder level.", "Lower your arms.", "Relax your arms, shoulders straight."],
    ex_004: ["Tilt right.", "Tilt left."],
    ex_005: ["Slowly bend to the side.", "Come back up.", "Stand tall, hand on your hip."],
    ex_006: ["Raise your arms to shoulder level.", "Hold.", "Lower your arms.", "Relax your arms."],
    ex_007: ["Press your arms overhead.", "Lower your hands to your shoulders.", "Hands at shoulder height."],
    ex_008: ["Slide your arms up in W-position.", "Slide them down."],
  };
  assert(Object.keys(expected).length === Object.keys(DEMO_CLIPS).length, "every clip has an expected repetition");
  for (const [id, rep] of Object.entries(expected)) {
    const want = [...rep, ...rep, ...rep].join(" | ");
    for (let from = 0; from < DEMO_CLIPS[id].cues.length; from++) {
      const got = spokenInSet(id, from).join(" | ");
      assert(got === want, `${id} from cue ${from}: spoke "${got}"`);
    }
  }
});

test("repetition sizes divide each loop", () => {
  for (const [id, clip] of Object.entries(DEMO_CLIPS)) {
    const rep = demoRepCues(clip);
    assert(rep >= 1 && clip.cues.length % rep === 0, `${id}: ${rep} lines per repetition does not divide ${clip.cues.length}`);
  }
  assert(demoRepCues(DEMO_CLIPS.ex_004) === 2 && demoRepCues(DEMO_CLIPS.ex_008) === 2, "neck and wall angels hold several repetitions per loop");
});

test("only the neck guide starts slowed down", () => {
  for (const [id, clip] of Object.entries(DEMO_CLIPS)) {
    if (id !== "ex_004") assert(clip.defaultSpeed === undefined, `${id}: unexpected default speed`);
  }
});

console.log(`\n${testsPassed} passed, ${testsFailed} failed`);
if (testsFailed > 0) {
  process.exitCode = 1;
}
