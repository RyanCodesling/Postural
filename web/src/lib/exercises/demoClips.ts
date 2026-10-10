/**
 * Demonstration clips — the rendered figure animations the camera page's
 * Reference Guide plays for an exercise.
 *
 * ── WHAT A CLIP IS ──────────────────────────────────────────────────────────
 * An unmodified render of the MPFB figure, built by the scripts under
 * `tools/blender/` and served from `web/public/demos/`. That folder is
 * gitignored, so a checkout without the media shows the guide's "no video"
 * state rather than a broken player. Renders carry a baked-in title and
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
 * No clip is published yet for ex_004 (its animation follows the change to
 * active neck tilts).
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
    detail: { label: "Shoulders", crop: { x: 210, y: 108, w: 450, h: 450 } },
  },
  // Full-size 870 x 980 renders like ex_001, so they use the reference crop
  // itself. Over every decoded frame the figure stays inside it with at least
  // 32 px (ex_005), 41 px (ex_006), 32 px (ex_007) and 29 px (ex_008) to
  // spare, and the baked text ends by row 92.
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
    detail: { label: "Shoulders", crop: { x: 210, y: 140, w: 450, h: 480 } },
  },
};

/** Resolve labels from media time, including seeks, speed changes and loops. */
export function demoStatusAtTime(clip: DemoClip, seconds: number): { phase: string; view: string } {
  const time = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const frame = Math.min(clip.frames, Math.floor(time * clip.fps + 1e-6) + 1);
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

/** The clip for an exercise, or null when none is published. */
export function demoClipFor(exerciseId: string | null | undefined): DemoClip | null {
  if (!exerciseId) return null;
  return Object.prototype.hasOwnProperty.call(DEMO_CLIPS, exerciseId)
    ? DEMO_CLIPS[exerciseId]
    : null;
}
