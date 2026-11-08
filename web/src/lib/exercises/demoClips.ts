/**
 * Demonstration clips — the rendered figure animations the camera page's
 * Reference Guide plays for an exercise.
 *
 * ── WHAT A CLIP IS ──────────────────────────────────────────────────────────
 * An unmodified render of the MPFB figure, built by the scripts under
 * `tools/blender/` and served from `web/public/demos/`. The six accepted
 * clips and their editable sources are versioned; the asset manifest lives
 * in `assets/blender/reference/guide_assets.json`. A missing media file still
 * uses the guide's existing "no video" state. Renders carry a baked-in title and
 * caption above the figure, which the crop cuts away. The player supplies
 * phase labels separately; earlier renders also bake them into that band.
 *
 * ── ONE CROP FOR EVERY CLIP ─────────────────────────────────────────────────
 * Every clip defaults to the same part of its frame: the ex_001 crop, scaled to the
 * clip's own size. The renders share one frame shape, so the guide keeps one
 * size and framing whichever exercise is selected. A clip is added only after
 * the shared crop has been checked, over every frame, to hold its figure and to
 * leave out its baked text. Optional detail framing is explicitly labelled
 * and can be switched back to the full-body view without restarting playback.
 *
 * ── WHAT IT IS NOT ──────────────────────────────────────────────────────────
 * The animations are illustrative presentation with authored timing, not
 * clinical demonstrations, and the therapist's instructions override them.
 *
 * ── WHY IT IS NOT IN THE REGISTRY ───────────────────────────────────────────
 * Exercise definitions feed the measurement-configuration hash that groups a
 * patient's history. A presentation asset must never move that hash, so the
 * clips live here, keyed by exercise id.
 */

export type DemoClip = {
  /** Public URL of the unmodified render. */
  src: string;
  /** Source frame size in pixels. */
  width: number;
  height: number;
  /** Crop in source pixels. */
  crop: { x: number; y: number; w: number; h: number };
  /** What the clip shows, completing "Animated guide showing …". */
  subject: string;
  /** Presentation timing from the saved render, independent of prescriptions. */
  fps: number;
  frames: number;
  phases: readonly { start: number; label: string }[];
  views?: readonly { start: number; label: string }[];
  /**
   * Recorded coaching lines. A line starts playing on its frame, placed a
   * little before the movement it names, and holds until the next cue; the
   * list wraps around the loop, so frames before the first cue belong to the
   * last. Every line's words end before the next line starts at 1×.
   */
  cues: readonly VoiceCue[];
  /**
   * Lines in one repetition, when the video loop holds more than one (the
   * neck's three right/left swings, the wall angels' front and side). The
   * cues list must start with a repetition. Absent: one repetition per loop.
   */
  repCues?: number;
  /**
   * Playback speed the guide starts at; 1 when absent. One of the player's
   * speed options. Cues follow media time, so they stay on their frames.
   */
  defaultSpeed?: 1 | 0.5;
  /** Optional detail framing; the default full-body crop stays shared. */
  detail: { label: string; crop: DemoClip["crop"] };
};

/**
 * The ex_001 render's full-body crop: the union figure box over all 210 source
 * frames of its original 870 x 980 render, with the baked title band excluded,
 * plus a 14 px margin. The re-rendered figure's hair leaves 6 px above the
 * head, checked on every frame.
 */
const REFERENCE_FRAME = { width: 870, height: 980 };
const REFERENCE_CROP = { x: 43, y: 108, w: 784, h: 847 };

/** The reference crop scaled to a clip's frame, in whole source pixels. */
function sharedCrop(width: number, height: number): DemoClip["crop"] {
  const sx = width / REFERENCE_FRAME.width;
  const sy = height / REFERENCE_FRAME.height;
  return {
    x: Math.round(REFERENCE_CROP.x * sx),
    y: Math.round(REFERENCE_CROP.y * sy),
    w: Math.round(REFERENCE_CROP.w * sx),
    h: Math.round(REFERENCE_CROP.h * sy),
  };
}

export type VoiceCue = {
  /** Frame the recording starts on. */
  start: number;
  /** The spoken words, also shown as the subtitle. */
  text: string;
  /** Public URL of the recording. */
  audio: string;
  /** Seconds from the start of the file to the end of the last word. */
  speech: number;
};

/**
 * Recorded lines under `web/public/demos/voice/`, generated with Microsoft's
 * "Ava" neural voice (en-US-AvaMultilingualNeural). `speech` is the end of the
 * last word, from the voice service's word timings; the files carry a short
 * silent tail after it.
 */
const VOICE_LINES = {
  "raise-arms-shoulder-level": { text: "Raise your arms to shoulder level.", speech: 1.9 },
  "lower-arms": { text: "Lower your arms.", speech: 1.3 },
  "relax-arms-shoulders-straight": { text: "Relax your arms, shoulders straight.", speech: 2.05 },
  "tilt-right": { text: "Tilt right.", speech: 0.69 },
  "tilt-left": { text: "Tilt left.", speech: 0.84 },
  "bend-to-side": { text: "Slowly bend to the side.", speech: 1.59 },
  "come-back-up": { text: "Come back up.", speech: 0.85 },
  "stand-tall-hand-on-hip": { text: "Stand tall, hand on your hip.", speech: 1.77 },
  "hold": { text: "Hold.", speech: 0.51 },
  "relax-arms": { text: "Relax your arms.", speech: 1.23 },
  "press-overhead": { text: "Press your arms overhead.", speech: 1.69 },
  "lower-hands-to-shoulders": { text: "Lower your hands to your shoulders.", speech: 2.03 },
  "hands-at-shoulder-height": { text: "Hands at shoulder height.", speech: 1.6 },
  // Recorded from "Slide your arms up in W position." so the voice says the letter.
  "slide-arms-up-w-position": { text: "Slide your arms up in W-position.", speech: 2.22 },
  "slide-them-down": { text: "Slide them down.", speech: 1.13 },
} as const;

export type VoiceLine = keyof typeof VOICE_LINES;

function cue(start: number, line: VoiceLine): VoiceCue {
  return { start, ...VOICE_LINES[line], audio: `/demos/voice/${line}.mp3` };
}

export const DEMO_CLIPS: Readonly<Record<string, DemoClip>> = {
  ex_001: {
    src: "/demos/ex_001-figure-motion.mp4",
    width: 870,
    height: 980,
    crop: sharedCrop(870, 980),
    subject: "a lateral arm raise",
    fps: 30,
    frames: 210,
    phases: [{ start: 1, label: "Ready" }, { start: 25, label: "Raise" }, { start: 96, label: "Pause" }, { start: 121, label: "Lower" }, { start: 192, label: "Ready" }],
    // Raise at 25, lower at 121; the relax line starts as the arms come down
    // and ends just before the next raise line.
    cues: [cue(16, "raise-arms-shoulder-level"), cue(112, "lower-arms"), cue(158, "relax-arms-shoulders-straight")],
    detail: { label: "Shoulders", crop: { x: 210, y: 108, w: 450, h: 450 } },
  },
  // Full-size 870 x 980 renders like ex_001, so they use the reference crop
  // itself. Over every decoded frame the figure stays inside it with at least
  // 40 px (ex_004), 32 px (ex_005), 41 px (ex_006), 30 px (ex_007) and 29 px
  // (ex_008) to spare, and the baked text ends by row 92.
  // Active alternating neck tilts, as the app counts them: the head swings ear
  // toward shoulder at 40 beats per minute, one side per beat, without stopping
  // at the centre, while the arms rest at the sides. Added 2026-10-11 by user
  // decision before the multi-person neck counting test; if that test returns
  // the exercise to the assisted stretch, this clip comes out.
  ex_004: {
    src: "/demos/ex_004-figure-motion.mp4",
    width: 870,
    height: 980,
    crop: sharedCrop(870, 980),
    subject: "side-to-side neck bends",
    fps: 30,
    frames: 270,
    phases: [{ start: 1, label: "Swing" }],
    // Frame 1 is the centre on the way to the figure's left, and each swing
    // starts 45 frames after the last, at 28, 73, 118 ... (build_mpfb_exercise_drafts.py).
    // Each line leads its swing by 6 frames. Sides are the figure's own, so the
    // patient tilts toward the side named.
    cues: [
      cue(22, "tilt-right"), cue(67, "tilt-left"), cue(112, "tilt-right"),
      cue(157, "tilt-left"), cue(202, "tilt-right"), cue(247, "tilt-left"),
    ],
    // One repetition is a right and a left swing; the loop holds three.
    repCues: 2,
    // At 1× a new side every 1.5 s makes the voice nonstop; at 0.5× each side
    // gets 3 s, and every line still leads its swing by 6 frames (0.4 s).
    defaultSpeed: 0.5,
    detail: { label: "Head and shoulders", crop: { x: 285, y: 116, w: 300, h: 324 } },
  },
  // The side bend is shown to one side only, so it does not suggest
  // alternating: one hand stays on the hip while the other arm hangs.
  ex_005: {
    src: "/demos/ex_005-figure-motion.mp4",
    width: 870,
    height: 980,
    crop: sharedCrop(870, 980),
    subject: "a standing side bend to one side, with one hand on the hip",
    fps: 30,
    frames: 180,
    phases: [{ start: 1, label: "Ready" }, { start: 21, label: "Bend" }, { start: 80, label: "Pause" }, { start: 101, label: "Return" }, { start: 160, label: "Ready" }],
    cues: [cue(14, "bend-to-side"), cue(92, "come-back-up"), cue(135, "stand-tall-hand-on-hip")],
    detail: { label: "Upper body", crop: { x: 215, y: 140, w: 500, h: 535 } },
  },
  ex_006: {
    src: "/demos/ex_006-figure-motion.mp4",
    width: 870,
    height: 980,
    crop: sharedCrop(870, 980),
    subject: "an arm hold at shoulder height",
    fps: 30,
    frames: 300,
    phases: [{ start: 1, label: "Ready" }, { start: 25, label: "Raise" }, { start: 96, label: "Hold" }, { start: 205, label: "Lower" }, { start: 276, label: "Ready" }],
    cues: [cue(16, "raise-arms-shoulder-level"), cue(93, "hold"), cue(194, "lower-arms"), cue(238, "relax-arms")],
    detail: { label: "Shoulders", crop: { x: 210, y: 125, w: 450, h: 450 } },
  },
  ex_007: {
    src: "/demos/ex_007-figure-motion.mp4",
    width: 870,
    height: 980,
    crop: sharedCrop(870, 980),
    subject: "an overhead shoulder press",
    fps: 30,
    frames: 300,
    phases: [{ start: 1, label: "Ready" }, { start: 25, label: "Press" }, { start: 120, label: "Pause" }, { start: 145, label: "Lower" }, { start: 240, label: "Ready" }],
    cues: [cue(16, "press-overhead"), cue(136, "lower-hands-to-shoulders"), cue(228, "hands-at-shoulder-height")],
    detail: { label: "Upper body", crop: { x: 170, y: 108, w: 530, h: 620 } },
  },
  // One repetition seen from the front, then one from the side so the back
  // and arms can be seen against the wall; the view switches at the rest.
  ex_008: {
    src: "/demos/ex_008-figure-motion.mp4",
    width: 870,
    height: 980,
    crop: sharedCrop(870, 980),
    subject: "wall angels, one repetition from the front and one from the side",
    fps: 30,
    frames: 468,
    phases: [
      { start: 1, label: "Ready" }, { start: 13, label: "Slide up" }, { start: 108, label: "Pause" }, { start: 120, label: "Slide down" }, { start: 215, label: "Ready" },
      { start: 235, label: "Ready" }, { start: 247, label: "Slide up" }, { start: 342, label: "Pause" }, { start: 354, label: "Slide down" }, { start: 449, label: "Ready" },
    ],
    views: [{ start: 1, label: "Front view" }, { start: 235, label: "Side view" }],
    // The same two lines for the front and the side repetition.
    cues: [
      cue(8, "slide-arms-up-w-position"), cue(112, "slide-them-down"),
      cue(240, "slide-arms-up-w-position"), cue(346, "slide-them-down"),
    ],
    // One repetition is up and down; the loop holds the front and the side one.
    repCues: 2,
    detail: { label: "Shoulders", crop: { x: 210, y: 140, w: 450, h: 480 } },
  },
};

/** The 1-based clip frame shown at a media time, clamped to the clip. */
function frameAtTime(clip: DemoClip, seconds: number): number {
  const time = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  return Math.min(clip.frames, Math.floor(time * clip.fps + 1e-6) + 1);
}

/** Resolve labels from media time, including seeks, speed changes and loops. */
export function demoStatusAtTime(clip: DemoClip, seconds: number): { phase: string; view: string } {
  const frame = frameAtTime(clip, seconds);
  const at = (items: readonly { start: number; label: string }[]) => {
    let label = items[0].label;
    for (const item of items) {
      if (item.start > frame) break;
      label = item.label;
    }
    return label;
  };
  return { phase: at(clip.phases), view: clip.views ? at(clip.views) : "Front view" };
}

/**
 * Index of the spoken cue whose window holds a media time. Frames before the
 * first cue wrap to the last, so a loop back to zero does not repeat a line.
 */
export function demoCueIndexAtTime(clip: DemoClip, seconds: number): number {
  const frame = frameAtTime(clip, seconds);
  let index = clip.cues.length - 1;
  for (let i = 0; i < clip.cues.length; i++) {
    if (clip.cues[i].start > frame) break;
    index = i;
  }
  return index;
}

/** Lines in one repetition of a clip's movement. */
export function demoRepCues(clip: DemoClip): number {
  return clip.repCues ?? clip.cues.length;
}

/**
 * Whether a session speaks cue `index` aloud, given how many lines it has
 * already spoken this set. Speaking starts on a repetition's first line and
 * stops after `reps` whole repetitions; the other lines are subtitles only.
 */
export function demoCueSpoken(clip: DemoClip, index: number, spokenSoFar: number, reps: number): boolean {
  const rep = demoRepCues(clip);
  const begun = spokenSoFar > 0 || index % rep === 0;
  return begun && spokenSoFar < rep * reps;
}

/** The clip for an exercise, or null when none is published. */
export function demoClipFor(exerciseId: string | null | undefined): DemoClip | null {
  if (!exerciseId) return null;
  return Object.prototype.hasOwnProperty.call(DEMO_CLIPS, exerciseId)
    ? DEMO_CLIPS[exerciseId]
    : null;
}
