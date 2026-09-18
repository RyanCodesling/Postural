/**
 * Demonstration clips — the rendered figure animations the camera page's
 * Reference Guide plays for an exercise.
 *
 * ── WHAT A CLIP IS ──────────────────────────────────────────────────────────
 * An unmodified render of the MPFB figure, built by the scripts under
 * `tools/blender/` and served from `web/public/demos/`. That folder is
 * gitignored, so a checkout without the media shows the guide's "no video"
 * state rather than a broken player. Every render carries a baked-in title,
 * caption and phase word above the figure, which the crop cuts away.
 *
 * ── ONE CROP FOR EVERY CLIP ─────────────────────────────────────────────────
 * Every clip shows the same part of its frame: the ex_001 crop, scaled to the
 * clip's own size. The renders share one frame shape, so the guide keeps one
 * size and framing whichever exercise is selected. A clip is added only after
 * the shared crop has been checked, over every frame, to hold its figure and to
 * leave out its baked text.
 *
 * ── WHAT IT IS NOT ──────────────────────────────────────────────────────────
 * The animations are illustrative presentation with authored timing, not
 * clinical demonstrations, and the therapist's instructions override them.
 * No clip is published for ex_004 or ex_008, whose animations are on hold, or
 * for ex_005, whose side-bend animation is withheld for now.
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
};

/**
 * The ex_001 render's full-body crop: the union figure box over all 210 source
 * frames of its 870 x 980 render, with the baked title band excluded, plus a
 * 14 px margin.
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
  },
  // 522 x 588 renders, so the shared crop is x 26, y 65, w 470, h 508. Over
  // every decoded frame the figure stays inside it with at least 25 px
  // (ex_006) and 19 px (ex_007) to spare, and the baked text ends by row 55.
  ex_006: {
    src: "/demos/ex_006-figure-motion.mp4",
    width: 522,
    height: 588,
    crop: sharedCrop(522, 588),
    subject: "an arm hold at shoulder height",
  },
  ex_007: {
    src: "/demos/ex_007-figure-motion.mp4",
    width: 522,
    height: 588,
    crop: sharedCrop(522, 588),
    subject: "an overhead shoulder press",
  },
};

/** The clip for an exercise, or null when none is published. */
export function demoClipFor(exerciseId: string | null | undefined): DemoClip | null {
  if (!exerciseId) return null;
  return Object.prototype.hasOwnProperty.call(DEMO_CLIPS, exerciseId)
    ? DEMO_CLIPS[exerciseId]
    : null;
}
