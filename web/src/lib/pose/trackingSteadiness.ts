/**
 * Unsteady tracking: a display-only check on whether the body points an
 * exercise depends on keep jumping between camera frames.
 *
 * WHAT
 * A point's jump is its distance from the straight line through its positions
 * in the frames just before and just after, in pixels divided by the shoulder
 * width. Movement at constant speed gives zero and smooth movement little; a
 * point the pose model keeps misplacing jumps out and back. A point is unsteady
 * when the median of its jumps over the last second is above its limit, so one
 * glitch or one fast turn does not count, only jumping that goes on.
 *
 * WHY THESE LIMITS
 * In the researcher's recorded sessions (one person, one room, every live frame
 * of six session videos), the largest one-second median was 0.123 shoulder
 * widths for a wrist and at most 0.072 for every other point. With only every
 * third frame kept, as on a slower computer, it was 0.211 and 0.131. The
 * limits, 0.25 for the wrists and 0.15 for the others, stay above all of these.
 * They are engineering values from one subject's ordinary sessions; detection
 * of real flicker is untested.
 *
 * WHEN
 * The camera feeds only frames that pass capture readiness. A jump is measured
 * only when the frames before and after are at most `maxGapMs` away, and a
 * point outside the picture is skipped. Re-run with this rule on the same
 * sessions, at the recorded rate and with every 2nd to 5th frame kept (median
 * frame intervals of 34 to 299 ms), 250 ms kept every one-second median under
 * its limit (largest 0.234 for a wrist, 0.113 for the other points); 360 ms let
 * a wrist reach 0.305 at the recorded rate, and 120 ms judged only 3 to 74 % of
 * the frames with every third kept. On slow or uneven frame streams the check
 * still judges fewer frames, so each repetition records on how many it could
 * (`checkedFrames`): one it never checked is not mistaken for a steady one.
 *
 * Display only: never scored and never a measurement. The camera shows a
 * message, and each repetition records how many of its frames were unsteady.
 */
import type { ExerciseDefinition } from "@/lib/exercises/registry";

export const TRACKING_CHECK_VERSION = "tracking_steadiness_v1" as const;

export const TRACKING_STEADINESS = {
  windowMs: 1000,
  /** Fewest jumps in the window before a point is judged. */
  minJumps: 5,
  maxGapMs: 250,
  wristLimit: 0.25,
  otherLimit: 0.15,
  /** The message stays at least this long after the last unsteady frame. */
  messageHoldMs: 2000,
  /**
   * How far back the frame marks reach. The longest stored repetition took
   * 31 s; a repetition that began before the oldest mark gets no tracking
   * record rather than a partial one (`repTracking`).
   */
  markHorizonMs: 180_000,
} as const;

export type TrackingSteadinessConfig = typeof TRACKING_STEADINESS;

export type TrackingRegion = "arms" | "head";

/** Body parts by the pose model's landmark sides, the same sides the metrics use. */
export type TrackingPart = "leftArm" | "rightArm" | "trunk" | "head";

export const PART_LANDMARKS: Record<TrackingPart, readonly number[]> = {
  leftArm: [13, 15],
  rightArm: [14, 16],
  trunk: [11, 12, 23, 24],
  head: [0, 7, 8],
};

const TRACKED: readonly number[] = [...new Set(Object.values(PART_LANDMARKS).flat())].sort((a, b) => a - b);
const WRISTS = new Set([15, 16]);

/** Side bends and neck bends are judged on the head; every other exercise on the arms. */
export function trackingRegion(definition: ExerciseDefinition): TrackingRegion {
  if (definition.requiresLateralRoom) return "head";
  if (definition.kind === "dynamic" && definition.primaryMetric.name === "neckLateralFlexion") return "head";
  return "arms";
}

/** The parts that matter for one repetition side, or for the whole exercise with "both". */
export function trackingParts(region: TrackingRegion, side: "left" | "right" | "both"): TrackingPart[] {
  if (region === "head") return ["head", "trunk"];
  if (side === "left") return ["leftArm", "trunk"];
  if (side === "right") return ["rightArm", "trunk"];
  return ["leftArm", "rightArm", "trunk"];
}

type Point = { x: number; y: number };
type Frame = { t: number; points: Record<number, Point | null>; shoulder: number | null };
type Jump = { t: number; v: number };

export type SteadinessState = {
  /** The last two frames fed, oldest first. */
  frames: Frame[];
  /** Each tracked point's jumps inside the window. */
  jumps: Record<number, Jump[]>;
};

export type SteadinessResult = {
  /** Each tracked point's median jump over the window, or null while it has too few. */
  medians: Record<number, number | null>;
  /** Parts with a median for at least one of their points: the check could judge them this frame. */
  checked: Record<TrackingPart, boolean>;
  unsteady: Record<TrackingPart, boolean>;
};

export function newSteadinessState(): SteadinessState {
  return { frames: [], jumps: Object.fromEntries(TRACKED.map((i) => [i, []])) };
}

export function landmarkLimit(index: number, config: TrackingSteadinessConfig = TRACKING_STEADINESS): number {
  return WRISTS.has(index) ? config.wristLimit : config.otherLimit;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** One frame. Pure: the input state is not mutated. */
export function updateSteadiness(
  state: SteadinessState,
  landmarks: ReadonlyArray<{ x: number; y: number }>,
  tMs: number,
  frameWidth: number,
  frameHeight: number,
  config: TrackingSteadinessConfig = TRACKING_STEADINESS,
): { state: SteadinessState; result: SteadinessResult } {
  const points: Record<number, Point | null> = {};
  for (const i of TRACKED) {
    const p = landmarks[i];
    const inside = !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
    points[i] = inside ? { x: p.x * frameWidth, y: p.y * frameHeight } : null;
  }
  const l = points[11];
  const r = points[12];
  const width = l && r ? Math.hypot(l.x - r.x, l.y - r.y) : 0;
  const frame: Frame = { t: tMs, points, shoulder: width > 1 ? width : null };

  const jumps: Record<number, Jump[]> = {};
  for (const i of TRACKED) jumps[i] = (state.jumps[i] ?? []).filter((j) => j.t > tMs - config.windowMs);

  const [a, b] = state.frames;
  const c = frame;
  if (a && b && b.shoulder !== null) {
    const before = b.t - a.t;
    const after = c.t - b.t;
    if (before > 0 && after > 0 && before <= config.maxGapMs && after <= config.maxGapMs) {
      const w = before / (c.t - a.t);
      for (const i of TRACKED) {
        const pa = a.points[i];
        const pb = b.points[i];
        const pc = c.points[i];
        if (!pa || !pb || !pc) continue;
        const lx = pa.x + (pc.x - pa.x) * w;
        const ly = pa.y + (pc.y - pa.y) * w;
        jumps[i].push({ t: b.t, v: Math.hypot(pb.x - lx, pb.y - ly) / b.shoulder });
      }
    }
  }

  const medians: Record<number, number | null> = {};
  for (const i of TRACKED) {
    medians[i] = jumps[i].length >= config.minJumps ? median(jumps[i].map((j) => j.v)) : null;
  }
  const parts = Object.keys(PART_LANDMARKS) as TrackingPart[];
  const checked = Object.fromEntries(
    parts.map((part) => [part, PART_LANDMARKS[part].some((i) => medians[i] !== null)]),
  ) as Record<TrackingPart, boolean>;
  const unsteady = Object.fromEntries(
    parts.map((part) => [
      part,
      PART_LANDMARKS[part].some((i) => {
        const m = medians[i];
        return m !== null && m > landmarkLimit(i, config);
      }),
    ]),
  ) as Record<TrackingPart, boolean>;

  return { state: { frames: [...state.frames, frame].slice(-2), jumps }, result: { medians, checked, unsteady } };
}

export type TrackingMessageState = { part: TrackingPart | null; lastUnsteadyMs: number | null };

export const NO_TRACKING_MESSAGE: TrackingMessageState = { part: null, lastUnsteadyMs: null };

/**
 * Which part the message names this frame: the part already named while it
 * stays unsteady, otherwise the first unsteady one, kept `messageHoldMs` after
 * the last unsteady frame so the message does not flicker.
 */
export function updateTrackingMessage(
  state: TrackingMessageState,
  unsteadyParts: readonly TrackingPart[],
  tMs: number,
  config: TrackingSteadinessConfig = TRACKING_STEADINESS,
): TrackingMessageState {
  if (unsteadyParts.length > 0) {
    const part = state.part !== null && unsteadyParts.includes(state.part) ? state.part : unsteadyParts[0];
    return { part, lastUnsteadyMs: tMs };
  }
  if (state.lastUnsteadyMs !== null && tMs - state.lastUnsteadyMs < config.messageHoldMs) return state;
  return NO_TRACKING_MESSAGE;
}

export function trackingMessage(part: TrackingPart): string {
  const where = part === "head" ? "your head" : part === "trunk" ? "your shoulders and hips" : "your arms";
  return `The camera keeps losing track of ${where}. More light, a plainer background or clothes that stand out from the background may help.`;
}

/** One processed frame, as the per-repetition record counts it. */
export type TrackingFrameMark = {
  t: number;
  captureOk: boolean;
  /** Parts the check could judge on this frame, and the unsteady ones among them. */
  checked: readonly TrackingPart[];
  unsteady: readonly TrackingPart[];
};

/** Adds a frame's mark and drops marks past the horizon, ten seconds' worth at a time rather than every frame. */
export function addTrackingMark(
  marks: TrackingFrameMark[],
  mark: TrackingFrameMark,
  config: TrackingSteadinessConfig = TRACKING_STEADINESS,
): TrackingFrameMark[] {
  marks.push(mark);
  if (mark.t - marks[0].t <= config.markHorizonMs + 10_000) return marks;
  return marks.filter((m) => mark.t - m.t <= config.markHorizonMs);
}

/** How well a repetition was tracked, saved with it (`rep_events.compensations.tracking`). */
export type RepTracking = {
  version: 1;
  check: typeof TRACKING_CHECK_VERSION;
  /** Frames processed from the repetition's start to its end. */
  frames: number;
  /** Of those, frames that failed capture readiness. */
  rejectedFrames: number;
  /** Of the rest, frames on which the check could judge one of the repetition's parts. */
  checkedFrames: number;
  /** Of those, frames on which one of the repetition's parts was unsteady. */
  unsteadyFrames: number;
};

/**
 * The repetition's record from the frame marks, or null when the marks no
 * longer reach back to its start (it ran past `markHorizonMs`): no record
 * rather than one that silently leaves out its early frames.
 */
export function repTracking(
  marks: readonly TrackingFrameMark[],
  startMs: number,
  endMs: number,
  parts: readonly TrackingPart[],
): RepTracking | null {
  if (marks.length === 0 || marks[0].t > startMs) return null;
  let frames = 0;
  let rejectedFrames = 0;
  let checkedFrames = 0;
  let unsteadyFrames = 0;
  for (const mark of marks) {
    if (mark.t < startMs || mark.t > endMs) continue;
    frames += 1;
    if (!mark.captureOk) {
      rejectedFrames += 1;
      continue;
    }
    if (mark.checked.some((part) => parts.includes(part))) checkedFrames += 1;
    if (mark.unsteady.some((part) => parts.includes(part))) unsteadyFrames += 1;
  }
  return { version: 1, check: TRACKING_CHECK_VERSION, frames, rejectedFrames, checkedFrames, unsteadyFrames };
}

export function isRepTracking(value: unknown): value is RepTracking {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const count = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0;
  return v.version === 1 && v.check === TRACKING_CHECK_VERSION &&
    count(v.frames) && count(v.rejectedFrames) && count(v.checkedFrames) && count(v.unsteadyFrames) &&
    v.rejectedFrames + v.checkedFrames <= v.frames && v.unsteadyFrames <= v.checkedFrames;
}

/** The settings the coaching configuration fingerprints. */
export function trackingCheckConfiguration(definition: ExerciseDefinition) {
  return {
    check: TRACKING_CHECK_VERSION,
    region: trackingRegion(definition),
    parts: PART_LANDMARKS,
    ...TRACKING_STEADINESS,
  };
}
