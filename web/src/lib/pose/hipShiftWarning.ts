/**
 * Hips pushed sideways in a standing side bend: a display-only coaching check.
 *
 * WHAT
 * How far the hip midpoint has moved sideways, AWAY from the side being bent
 * to, in hip widths, against the stance just before the bend. The stance is
 * the median of the upright frames (head lean below the repetition start)
 * seen since the previous bend, within the last `stanceMs`. Movement toward
 * the bend side reads 0.
 *
 * Only image x is used: the hip midpoint, the hip width (the horizontal
 * distance between the hip landmarks) and the ear midpoint's offset from the
 * hip midpoint, which gives the bend's direction on screen. The result is
 * therefore independent of the camera's aspect ratio and of mirroring.
 *
 * WHY
 * Exercise and range-of-motion sources name the hips or pelvis shifting as a
 * compensation in a trunk side bend. The movement lies in a front camera's
 * plane, and it inflates the side-bend reading, which runs from the hip
 * midpoint to the ears. On 118 ordinary pilot side bends the hips moved away
 * from the bend by at most 0.42 hip widths.
 *
 * WHEN
 * Judged once per bend, while the head lean is at least `from`. A shift that
 * stays at or above the cue's switch-on level for `persistMs` flags the bend,
 * and its largest value is held as the warning until the patient is upright
 * again. Before a flag the live value passes through; upright, there is none.
 * A bend that starts without at least two stance frames is not judged. A frame
 * that is not judged (no reading, a lean below `from`, or no direction) ends a
 * run that has not yet lasted `persistMs`, so only an unbroken run flags; a
 * flag already confirmed is kept.
 *
 * Display only: never scored, never stored as a measurement, and outside the
 * measurement version.
 */

/** The image-space quantities the check reads from one frame. */
export type HipShiftGeometry = {
  /** Hip midpoint x (normalized image x). */
  hipX: number;
  /** Horizontal distance between the hip landmarks (normalized image x). */
  hipWidth: number;
  /** Ear midpoint x minus hip midpoint x (normalized image x). */
  earOffset: number;
};

export type HipShiftState = {
  /** Upright frames since the previous bend, oldest first. */
  upright: (HipShiftGeometry & { tMs: number })[];
  /** True from the repetition start until the patient is upright again. */
  bending: boolean;
  /** The stance the current bend is judged against, or null (not judged). */
  stance: HipShiftGeometry | null;
  /** Largest flagged shift of the current bend, or null. */
  heldValue: number | null;
  /** Start of the present run at or above the switch-on level, or null. */
  overSinceMs: number | null;
};

export type HipShiftCheck = {
  /** How far back upright frames count toward the stance. */
  stanceMs: number;
  /** Head lean (primary units) from which a bend is judged. */
  from: number;
  /** How long the shift must stay at or above the switch-on level. */
  persistMs: number;
  /** Head lean below which the patient is upright: the repetition start. */
  restBelow: number;
};

type Landmark = { x: number; y: number; visibility?: number } | undefined;

// Same visibility rule as poseMetrics.ts (MIN_VIS): below 0.5 a landmark is
// partly or fully occluded, and MediaPipe can extrapolate off-frame points.
const MIN_VISIBILITY = 0.5;
// Below this the hip landmarks nearly coincide (the patient is turned side-on
// or mis-detected), and dividing by the width would magnify noise.
const MIN_HIP_WIDTH = 0.01;

function usable(p: Landmark): p is { x: number; y: number; visibility?: number } {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y) &&
    p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1 &&
    (typeof p.visibility === "number" ? p.visibility : 1) >= MIN_VISIBILITY;
}

/** MediaPipe ears (7, 8) and hips (23, 24); null unless all four are usable. */
export function hipShiftGeometry(landmarks: readonly Landmark[]): HipShiftGeometry | null {
  const [earA, earB, hipA, hipB] = [landmarks[7], landmarks[8], landmarks[23], landmarks[24]];
  if (!usable(earA) || !usable(earB) || !usable(hipA) || !usable(hipB)) return null;
  const hipWidth = Math.abs(hipA.x - hipB.x);
  if (hipWidth < MIN_HIP_WIDTH) return null;
  const hipX = (hipA.x + hipB.x) / 2;
  return { hipX, hipWidth, earOffset: (earA.x + earB.x) / 2 - hipX };
}

export function newHipShiftState(): HipShiftState {
  return { upright: [], bending: false, stance: null, heldValue: null, overSinceMs: null };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** One frame. Pure: the input state is not mutated. */
export function updateHipShift(
  state: HipShiftState,
  input: { geometry: HipShiftGeometry | null; lean: number | null; nowMs: number },
  check: HipShiftCheck,
  level: number,
): { state: HipShiftState; value: number | null } {
  const { geometry, nowMs } = input;
  // A frame without a reading neither ends a bend nor adds to the stance. It
  // breaks a pending run; a flagged bend keeps its warning through it.
  if (geometry === null || typeof input.lean !== "number" || !Number.isFinite(input.lean)) {
    return { state: { ...state, overSinceMs: null }, value: state.bending ? state.heldValue : null };
  }
  const lean = Math.abs(input.lean);

  if (lean < check.restBelow) {
    const upright = state.bending ? [] : state.upright.filter((s) => nowMs - s.tMs <= check.stanceMs);
    upright.push({ ...geometry, tMs: nowMs });
    return { state: { ...newHipShiftState(), upright }, value: null };
  }

  let { bending, stance, heldValue, overSinceMs } = state;
  if (!bending) {
    bending = true;
    const frames = state.upright.filter((s) => nowMs - s.tMs <= check.stanceMs);
    stance = frames.length >= 2
      ? {
          hipX: median(frames.map((s) => s.hipX)),
          hipWidth: median(frames.map((s) => s.hipWidth)),
          earOffset: median(frames.map((s) => s.earOffset)),
        }
      : null;
    heldValue = null;
    overSinceMs = null;
  }
  const next = (value: number | null) => ({
    state: { upright: [], bending, stance, heldValue, overSinceMs },
    value,
  });
  // Frames that are not judged break a pending run (see WHEN above).
  if (stance === null || lean < check.from) {
    overSinceMs = null;
    return next(heldValue);
  }

  // The ears move toward the bend side relative to the hips, so the change in
  // their offset gives the bend's direction on screen.
  const direction = Math.sign(geometry.earOffset - stance.earOffset);
  if (direction === 0) {
    overSinceMs = null;
    return next(heldValue);
  }
  const away = Math.max(0, (-(geometry.hipX - stance.hipX) * direction) / stance.hipWidth);
  if (away >= level) {
    overSinceMs ??= nowMs;
    if (nowMs - overSinceMs >= check.persistMs) heldValue = Math.max(heldValue ?? -Infinity, away);
  } else {
    overSinceMs = null;
  }
  return next(heldValue ?? away);
}
