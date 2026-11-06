/**
 * Which repetitions and sessions the trends count (trend data rules v1).
 *
 * A repetition or a session is left out only for a known cause, never because
 * its value looks unusual, and nothing is deleted: left-out repetitions stay in
 * the session's record and breakdown, and a left-out session is still drawn.
 *
 *   1. The first repetition of each set, per side, is left out of the timing
 *      measures (raising and lowering time). Its timing includes getting into
 *      position: in the stored sessions every repetition that took more than
 *      three times its set's typical raising time was a set's first.
 *   2. A repetition the camera tracked poorly is left out of every measure:
 *      frames that failed capture readiness or that the tracking check found
 *      unsteady make up at least POOR_TRACKING_SHARE of its frames. Repetitions
 *      saved before the tracking check carry no record and always count.
 *   3. A session in which at least SESSION_POOR_SHARE of the repetitions with a
 *      tracking record were poorly tracked is left out of the trend line and
 *      drawn hollow.
 *   4. (v2) The neck side bend's peaks are measured from the head's own resting
 *      position. The camera reads the neck against the camera tilt it froze at
 *      calibration, which comes from the hip and ear lines, so a still head can
 *      read a few degrees to one side: every left peak then moves one way and
 *      every right peak the other. The camera records what a still head reads
 *      in the rests between sets of each calibration (`neckRest` in the capture
 *      summary). Each repetition's peak is corrected by its calibration's
 *      reading (`neckRestPeak`), and completion is judged on the corrected peak
 *      against the repetition's own saved target. A repetition without such a
 *      reading counts in no peak measure (peak, completion, peak spread); it
 *      still counts as a repetition, and its timing still counts.
 *
 * The same rules run in the session list's SQL summary (`getSessionsForPatient`),
 * the session breakdown (`measureFromDetail`) and the trend-model export.
 */

export const TREND_RULES_VERSION = "trend_rules_v2" as const;

/** Exercises whose peaks follow rule 4. */
export const NECK_REST_EXERCISES: ReadonlySet<string> = new Set(["ex_004"]);

/** What a still head read in the rests between sets of one calibration, from `from` on (rule 4). */
export interface NeckRestEpoch {
  from: string;
  offsetDeg: number | null;
  frames: number;
}

/**
 * The still-head reading that applies to a repetition starting at `startMs`:
 * that of the latest calibration begun at or before it, or null when that
 * calibration recorded no usable reading.
 */
export function neckRestOffsetAt(
  epochs: readonly NeckRestEpoch[] | null | undefined,
  startMs: number | null,
): number | null {
  if (!epochs || startMs === null || !Number.isFinite(startMs)) return null;
  let found: NeckRestEpoch | null = null;
  let foundFrom = -Infinity;
  for (const epoch of epochs) {
    const from = Date.parse(epoch.from);
    if (Number.isFinite(from) && from <= startMs && from >= foundFrom) {
      found = epoch;
      foundFrom = from;
    }
  }
  return found && typeof found.offsetDeg === "number" && Number.isFinite(found.offsetDeg) ? found.offsetDeg : null;
}

/** A neck repetition's peak from the resting position: a left peak loses the still-head reading, a right peak gains it. */
export function neckRestPeak(side: string | null, peak: number, offsetDeg: number): number {
  return side === "left" ? peak - offsetDeg : peak + offsetDeg;
}

/** Share of a repetition's frames that makes it poorly tracked (rule 2); an engineering value. */
export const POOR_TRACKING_SHARE = 0.25;

/** Share of a session's tracked repetitions that leaves the session out (rule 3). */
export const SESSION_POOR_SHARE = 0.5;

/** Measures that skip each set's first repetition (rule 1). */
export const TIMING_MEASURES: ReadonlySet<string> = new Set(["loweringS", "raisingS"]);

const count = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;

function trackingRecord(compensations: unknown): Record<string, unknown> | null {
  const tracking = typeof compensations === "object" && compensations !== null
    ? (compensations as Record<string, unknown>).tracking
    : undefined;
  return typeof tracking === "object" && tracking !== null ? (tracking as Record<string, unknown>) : null;
}

/** The repetition's poorly tracked share of frames, or null without a usable tracking record. */
export function repTrackingShare(compensations: unknown): number | null {
  const tracking = trackingRecord(compensations);
  if (!tracking) return null;
  const { frames, rejectedFrames, unsteadyFrames } = tracking;
  if (!count(frames) || !count(rejectedFrames) || !count(unsteadyFrames) || frames === 0) return null;
  return Math.min(1, (rejectedFrames + unsteadyFrames) / frames);
}

/**
 * Display only, never a rule: the repetition's record shows frames that passed
 * capture readiness but none the tracking check could judge (it needs more
 * than five frames a second), so its steadiness is unknown rather than steady.
 */
export function repTrackingUnchecked(compensations: unknown): boolean {
  const tracking = trackingRecord(compensations);
  if (!tracking) return false;
  const { frames, rejectedFrames, checkedFrames } = tracking;
  return count(frames) && count(rejectedFrames) && count(checkedFrames) && checkedFrames === 0 && frames > rejectedFrames;
}

/** Rule 2. */
export function repPoorlyTracked(compensations: unknown): boolean {
  const share = repTrackingShare(compensations);
  return share !== null && share >= POOR_TRACKING_SHARE;
}

/** Rule 3, from the session's repetitions with a tracking record and the poorly tracked ones among them. */
export function sessionPoorlyTracked(trackedReps: number, poorReps: number): boolean {
  return trackedReps > 0 && poorReps / trackedReps >= SESSION_POOR_SHARE;
}

/** Rule 1: the repetition index of each set's first repetition, per side. */
export function firstRepsOfSets(reps: readonly { setIndex: number; side: string | null; repIndex: number }[]): Set<number> {
  const first = new Map<string, number>();
  for (const rep of reps) {
    const key = `${rep.setIndex}:${rep.side}`;
    const seen = first.get(key);
    if (seen === undefined || rep.repIndex < seen) first.set(key, rep.repIndex);
  }
  return new Set(first.values());
}

/**
 * Why a repetition is left out of some measures, for the breakdown:
 * "tracking" from every measure (rule 2), "no-rest-reference" from the peak
 * measures (rule 4), "first-of-set" from the timing measures (rule 1).
 */
export type RepLeftOut = "tracking" | "no-rest-reference" | "first-of-set" | null;

export function repLeftOut(compensations: unknown, firstOfSet: boolean, noRestReference = false): RepLeftOut {
  if (repPoorlyTracked(compensations)) return "tracking";
  if (noRestReference) return "no-rest-reference";
  return firstOfSet ? "first-of-set" : null;
}
