/**
 * How one session's points on the trend charts were formed. The charts plot
 * each side's session summaries (getSessionsForPatient); this lists the
 * repetitions (or, for a hold, the sets) behind them and rebuilds every one of
 * those values from them by the same rules. Left and right are never combined.
 */
import type { PainReportStatus, PainTiming } from "@/lib/prescriptionContext";
import type { TrendMeasureName, TrendSide } from "./trendSeries";
import {
  firstRepsOfSets,
  NECK_REST_EXERCISES,
  neckRestOffsetAt,
  neckRestPeak,
  repLeftOut,
  repPoorlyTracked,
  repTrackingShare,
  repTrackingUnchecked,
  sessionPoorlyTracked,
  type NeckRestEpoch,
  type RepLeftOut,
} from "./trendRules";

/** The parts of a GET /api/sessions/[id] session the breakdown reads. */
export interface SessionRepsDetail {
  /** Needed for trend data rule 4 (neck side bends); without it every repetition reads as saved. */
  exerciseId?: string | null;
  /** The capture summary; rule 4 reads its neck rest record. */
  captureQuality?: { neckRest?: { epochs: NeckRestEpoch[] } | null } | null;
  reps: {
    repIndex: number;
    setIndex: number;
    side: string | null;
    peakValue: number | null;
    classification: string | null;
    targetRom?: number | null;
    timeToPeakMs?: number | null;
    holdMs?: number | null;
    descentMs?: number | null;
    /** Raise + top + lower, as saved. */
    totalMs?: number | null;
    compensations?: unknown;
    /** When the repetition started; rule 4 finds its calibration by it. */
    startTs?: string | number | Date | null;
  }[];
  sets: {
    setIndex: number;
    /** Absent in the trend summary's hold sets, which are holds already. */
    exerciseKind?: string | null;
    targetHoldMs: number | null;
    holdQuality: unknown;
    durationMs?: number | null;
    startTs?: string | number | Date | null;
    endTs?: string | number | Date | null;
  }[];
  /** The session's start context, which records the exercise definition in force. */
  context?: unknown;
  painReport?: { status: PainReportStatus; score: number | null; timing: PainTiming | null; bodyArea: string | null } | null;
}

export interface RepRow {
  repIndex: number;
  setIndex: number;
  peak: number | null;
  target: number | null;
  /** The repetition reached the target range. */
  complete: boolean;
  raisingS: number | null;
  /** Time held at the top, between raising and lowering. */
  pauseS: number | null;
  loweringS: number | null;
  /** Rule form score; it counts only with at least 80 % scored coverage. */
  formScore: number | null;
  formCounted: boolean;
  /** Share of the repetition's time over each compensation's threshold, in %. */
  overThresholdPct: Record<string, number | null>;
  /**
   * How far each compensation went, as its peak and its average size divided by
   * the warning threshold recorded for the session (1 = at the threshold). The
   * compensations are in different units, so this is how they compare.
   */
  peakOverThreshold: Record<string, number | null>;
  meanOverThreshold: Record<string, number | null>;
  /**
   * Trend data rules: "tracking" when the camera tracked the repetition poorly,
   * so it counts in no trend; "first-of-set" when its timing is left out.
   */
  leftOut: RepLeftOut;
}

export interface HoldSetRow {
  setIndex: number;
  inBandMs: number | null;
  targetMs: number | null;
  steadiness: number | null;
  distance: number | null;
  drift: number | null;
  /** Rule compensation score of the set, both sides together. */
  formScore: number | null;
  /** Lowest compensation score in the set. */
  minFormScore: number | null;
  /** Time until the hold first entered the band, both sides together. */
  settleMs: number | null;
  /** Times the hold left the band after being in it. */
  dropCount: number | null;
  /** Longest unbroken time in the band. */
  longestInBandMs: number | null;
  /** Time out of the band. */
  outOfBandMs: number | null;
}

export interface SetTiming {
  setIndex: number;
  durationMs: number | null;
  /** Rest since the previous set ended; null for the first set or without times. */
  restBeforeMs: number | null;
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** The number at a path of object keys, or null. */
function numberAt(value: unknown, ...path: string[]): number | null {
  let current = value;
  for (const key of path) {
    current = typeof current === "object" && current !== null ? (current as Record<string, unknown>)[key] : undefined;
  }
  return finite(current) ? current : null;
}

const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

/** The mean of the numbers present, or null when there are none, as SQL AVG. */
function meanPresent(values: (number | null | undefined)[]): number | null {
  const present = values.filter(finite);
  return present.length > 0 ? mean(present) : null;
}

/** Sample standard deviation, as SQL STDDEV_SAMP; null below two values. */
function sampleSd(values: number[]): number | null {
  if (values.length < 2) return null;
  const m = mean(values);
  return Math.sqrt(values.reduce((a, v) => a + (v - m) ** 2, 0) / (values.length - 1));
}

function ruleScore(compensations: unknown): { score: number | null; counted: boolean } {
  const score = numberAt(compensations, "rawRule", "meanScore");
  const coverage = numberAt(compensations, "rawRule", "coveragePct");
  return { score, counted: score !== null && coverage !== null && coverage >= 80 };
}

const overThresholdShare = (compensations: unknown, metric: string) =>
  numberAt(compensations, "rawFeatures", "compensations", metric, "overThresholdFrac");

/**
 * Each compensation's warning threshold as recorded in the session's start
 * context, which is the threshold its time over threshold was counted against.
 */
export function recordedWarningThresholds(context: unknown): Record<string, number> {
  const definition = objectAt(context, "exercise", "definition");
  const specs = definition ? (definition as Record<string, unknown>).compensationMetrics : undefined;
  const thresholds: Record<string, number> = {};
  if (!Array.isArray(specs)) return thresholds;
  for (const spec of specs) {
    const name = typeof spec === "object" && spec !== null ? (spec as Record<string, unknown>).name : undefined;
    const threshold = numberAt(spec, "warningThreshold");
    if (typeof name === "string" && threshold !== null && threshold > 0) thresholds[name] = threshold;
  }
  return thresholds;
}

/** The object at a path of object keys, or null. */
function objectAt(value: unknown, ...path: string[]): object | null {
  let current = value;
  for (const key of path) {
    current = typeof current === "object" && current !== null ? (current as Record<string, unknown>)[key] : undefined;
  }
  return typeof current === "object" && current !== null ? current : null;
}

const sideReps = (detail: SessionRepsDetail, side: TrendSide) => detail.reps.filter((r) => r.side === side);

type Rep = SessionRepsDetail["reps"][number];

/**
 * Trend data rule 4. For a neck side bend, a repetition's peak and completion
 * measured from the resting position, or `referenced: false` when its
 * calibration recorded no resting reading. Other exercises read as saved.
 */
function restReferenced(detail: SessionRepsDetail): (r: Rep) => { referenced: boolean; peak: number | null; complete: boolean } {
  const neck = typeof detail.exerciseId === "string" && NECK_REST_EXERCISES.has(detail.exerciseId);
  const epochs = detail.captureQuality?.neckRest?.epochs ?? null;
  return (r) => {
    const saved = finite(r.peakValue) ? r.peakValue : null;
    if (!neck) return { referenced: true, peak: saved, complete: r.classification === "complete" };
    const offset = neckRestOffsetAt(epochs, timeMs(r.startTs));
    if (offset === null) return { referenced: false, peak: null, complete: false };
    const peak = saved === null ? null : neckRestPeak(r.side, saved, offset);
    return {
      referenced: true,
      peak,
      complete: peak !== null && finite(r.targetRom) ? peak >= r.targetRom : r.classification === "complete",
    };
  };
}

/**
 * The still-head readings rule 4 takes off a neck session's peaks, one per
 * calibration that recorded one, or null for other exercises and sessions
 * without a record.
 */
export function neckRestOffsets(detail: SessionRepsDetail): number[] | null {
  if (typeof detail.exerciseId !== "string" || !NECK_REST_EXERCISES.has(detail.exerciseId)) return null;
  const epochs = detail.captureQuality?.neckRest?.epochs;
  if (!epochs) return null;
  return epochs.flatMap((e) => (typeof e.offsetDeg === "number" && Number.isFinite(e.offsetDeg) ? [e.offsetDeg] : []));
}

/** The side's repetitions in the order done, with the values each chart uses. */
export function repRows(detail: SessionRepsDetail, side: "left" | "right", metrics: string[]): RepRow[] {
  const thresholds = recordedWarningThresholds(detail.context);
  const relative = (compensations: unknown, metric: string, key: "peakAbs" | "meanAbs") => {
    const size = numberAt(compensations, "rawFeatures", "compensations", metric, key);
    const threshold = thresholds[metric];
    return size === null || threshold === undefined ? null : size / threshold;
  };
  const firsts = firstRepsOfSets(detail.reps);
  const referenced = restReferenced(detail);
  return sideReps(detail, side).map((r) => {
    const rule = ruleScore(r.compensations);
    const ref = referenced(r);
    return {
      repIndex: r.repIndex,
      setIndex: r.setIndex,
      // Rule 4: a neck peak from the resting position; without a resting
      // reading the saved peak is shown and the repetition is marked.
      peak: ref.referenced ? ref.peak : finite(r.peakValue) ? r.peakValue : null,
      target: finite(r.targetRom) ? r.targetRom : null,
      complete: ref.referenced ? ref.complete : r.classification === "complete",
      raisingS: finite(r.timeToPeakMs) ? r.timeToPeakMs / 1000 : null,
      pauseS: finite(r.holdMs) ? r.holdMs / 1000 : null,
      loweringS: finite(r.descentMs) ? r.descentMs / 1000 : null,
      formScore: rule.score,
      formCounted: rule.counted,
      overThresholdPct: Object.fromEntries(
        metrics.map((metric) => {
          const share = overThresholdShare(r.compensations, metric);
          return [metric, share === null ? null : 100 * share];
        }),
      ),
      peakOverThreshold: Object.fromEntries(metrics.map((m) => [m, relative(r.compensations, m, "peakAbs")])),
      meanOverThreshold: Object.fromEntries(metrics.map((m) => [m, relative(r.compensations, m, "meanAbs")])),
      leftOut: repLeftOut(r.compensations, firsts.has(r.repIndex), !ref.referenced),
    };
  });
}

/** One set's last repetition against the repetitions between its first and its last. */
export interface EndOfSetRow {
  setIndex: number;
  /** The middle repetitions compared, after poorly tracked ones are left out. */
  middleReps: number;
  /** The last repetition's duration (raise + top + lower) over the middle repetitions' median, or null. */
  durationRatio: number | null;
  /** The last repetition's peak minus the middle repetitions' median peak, or null. */
  peakChange: number | null;
}

const medianOf = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const repDurationMs = (r: SessionRepsDetail["reps"][number]): number | null =>
  finite(r.totalMs) ? r.totalMs
    : finite(r.timeToPeakMs) && finite(r.holdMs) && finite(r.descentMs) ? r.timeToPeakMs + r.holdMs + r.descentMs : null;

/**
 * End-of-set gauge, for the therapist: each set's last repetition against the
 * repetitions between its first and its last, in sets with at least four
 * repetitions on the side. The first is left out because its timing includes
 * getting into position. A poorly tracked last repetition gives no comparison,
 * and poorly tracked middle repetitions are left out of the median; at least two
 * must remain. Information only, not a judgement of readiness: the repetitions
 * are paced, so a slower last repetition can be the patient's own choice.
 */
export function endOfSetRows(detail: SessionRepsDetail, side: "left" | "right"): EndOfSetRow[] {
  const bySet = new Map<number, SessionRepsDetail["reps"]>();
  for (const r of sideReps(detail, side)) bySet.set(r.setIndex, [...(bySet.get(r.setIndex) ?? []), r]);
  const rows: EndOfSetRow[] = [];
  for (const [setIndex, reps] of [...bySet].sort((a, b) => a[0] - b[0])) {
    if (reps.length < 4) continue;
    const ordered = [...reps].sort((a, b) => a.repIndex - b.repIndex);
    const last = ordered[ordered.length - 1];
    const middle = ordered.slice(1, -1).filter((r) => !repPoorlyTracked(r.compensations));
    const lastCounts = !repPoorlyTracked(last.compensations);
    const durations = middle.map(repDurationMs).filter(finite);
    const peaks = middle.map((r) => r.peakValue).filter(finite);
    const lastDuration = lastCounts ? repDurationMs(last) : null;
    const lastPeak = lastCounts && finite(last.peakValue) ? last.peakValue : null;
    const middleDuration = durations.length >= 2 ? medianOf(durations) : null;
    rows.push({
      setIndex,
      middleReps: middle.length,
      durationRatio: lastDuration !== null && middleDuration !== null && middleDuration > 0 ? lastDuration / middleDuration : null,
      peakChange: lastPeak !== null && peaks.length >= 2 ? lastPeak - medianOf(peaks) : null,
    });
  }
  return rows;
}

/**
 * The session's repetitions with a tracking record, the poorly tracked ones
 * among them, and whether that leaves the session out of the trend lines
 * (trend data rule 3).
 */
export function sessionTracking(detail: SessionRepsDetail): {
  trackedReps: number; poorReps: number; uncheckedReps: number; heldOut: boolean;
} {
  const trackedReps = detail.reps.filter((r) => repTrackingShare(r.compensations) !== null).length;
  const poorReps = detail.reps.filter((r) => repPoorlyTracked(r.compensations)).length;
  // Display only: repetitions the tracking check could not judge at all.
  const uncheckedReps = detail.reps.filter((r) => repTrackingUnchecked(r.compensations)).length;
  return { trackedReps, poorReps, uncheckedReps, heldOut: sessionPoorlyTracked(trackedReps, poorReps) };
}

/** A saved time as milliseconds: text through the API, a Date when read from the database directly. */
const timeMs = (value: string | number | Date | null | undefined): number | null => {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
};

/** Each set's duration and the rest before it, from the saved set times. */
export function setTimings(detail: SessionRepsDetail): SetTiming[] {
  const sets = [...detail.sets].sort((a, b) => a.setIndex - b.setIndex);
  return sets.map((s, i) => {
    const previousEnd = i > 0 ? timeMs(sets[i - 1].endTs) : null;
    const start = timeMs(s.startTs);
    const rest = previousEnd !== null && start !== null ? start - previousEnd : null;
    return {
      setIndex: s.setIndex,
      durationMs: finite(s.durationMs) ? s.durationMs : null,
      restBeforeMs: rest !== null && rest >= 0 ? rest : null,
    };
  });
}

/** A hold's sets, with the side's time in band, steadiness, distance from the target and drift. */
export function holdRows(detail: SessionRepsDetail, side: "left" | "right"): HoldSetRow[] {
  return detail.sets.map((s) => {
    const error = numberAt(s.holdQuality, side, "meanErrorDeg");
    return {
      setIndex: s.setIndex,
      inBandMs: numberAt(s.holdQuality, side === "left" ? "leftInBandMs" : "rightInBandMs"),
      targetMs: finite(s.targetHoldMs) ? s.targetHoldMs : null,
      steadiness: numberAt(s.holdQuality, side, "sdDeg"),
      distance: error === null ? null : Math.abs(error),
      drift: numberAt(s.holdQuality, side, "droopSlopeDegPerSec"),
      formScore: numberAt(s.holdQuality, "meanCompensationScore"),
      minFormScore: numberAt(s.holdQuality, "minCompensationScore"),
      settleMs: numberAt(s.holdQuality, "settleMs"),
      dropCount: numberAt(s.holdQuality, "dropCount"),
      longestInBandMs: numberAt(s.holdQuality, "longestPairedStreakMs"),
      outOfBandMs: numberAt(s.holdQuality, "outOfPositionMs"),
    };
  });
}

/** The mean of the values present and how many there were: the units that contribute. */
function contributing(values: (number | null)[]): { value: number | null; units: number } {
  const present = values.filter(finite);
  return { value: present.length > 0 ? mean(present) : null, units: present.length };
}

/**
 * A session's value and unit count for one trend measure, rebuilt from its
 * detail, so it equals that chart's point.
 *
 * Holds follow the per-set rule the model was learned and evaluated with: a
 * set contributes to a measure only when it recorded that measure, and time in
 * band is each set's share of its own prescribed hold, averaged over the sets
 * with a positive target. A set without a measurement, or with one quarantined
 * by the set route, adds nothing and is not counted as a unit.
 *
 * Repetitions: a repetition without a value still counts as a repetition, as
 * in the summary; time over a threshold counts the repetitions that recorded it.
 * The trend data rules apply as in the summary: a poorly tracked repetition
 * counts nowhere, raising and lowering time skip each set's first repetition,
 * and a neck side bend's peak measures use the peaks from the resting position,
 * leaving out repetitions without a resting reading (rule 4).
 */
export function measureFromDetail(
  detail: SessionRepsDetail,
  measure: TrendMeasureName,
  side: TrendSide,
): { value: number | null; units: number } {
  const sets = detail.sets.filter((s) => s.exerciseKind === undefined || s.exerciseKind === "isometric");
  const hold = (key: string) => contributing(sets.map((s) => numberAt(s.holdQuality, side, key)));
  switch (measure) {
    case "inBandPct":
      if (side === "card") return { value: null, units: 0 };
      return contributing(sets.map((s) => {
        const inBandMs = numberAt(s.holdQuality, side === "left" ? "leftInBandMs" : "rightInBandMs");
        return inBandMs !== null && finite(s.targetHoldMs) && s.targetHoldMs > 0 ? (100 * inBandMs) / s.targetHoldMs : null;
      }));
    case "holdFormScore":
      return contributing(sets.map((s) => numberAt(s.holdQuality, "meanCompensationScore")));
    case "holdSteadiness":
      return hold("sdDeg");
    case "holdError":
      return contributing(sets.map((s) => {
        const error = numberAt(s.holdQuality, side, "meanErrorDeg");
        return error === null ? null : Math.abs(error);
      }));
    case "holdDroop":
      return hold("droopSlopeDegPerSec");
  }
  const reps = sideReps(detail, side).filter((r) => !repPoorlyTracked(r.compensations));
  const firsts = firstRepsOfSets(detail.reps);
  const timed = reps.filter((r) => !firsts.has(r.repIndex));
  if (measure.startsWith("exposure:")) {
    const metric = measure.slice("exposure:".length);
    const shares = reps.flatMap((r) => {
      const share = overThresholdShare(r.compensations, metric);
      return share === null ? [] : [share];
    });
    return { value: shares.length > 0 ? 100 * mean(shares) : null, units: shares.length };
  }
  const referenced = restReferenced(detail);
  const peakReps = reps.map(referenced).filter((r) => r.referenced);
  const peaks = peakReps.flatMap((r) => (r.peak !== null ? [r.peak] : []));
  switch (measure) {
    case "peak":
      return { value: peaks.length > 0 ? mean(peaks) : null, units: peakReps.length };
    case "formScore": {
      const scores = reps.flatMap((r) => {
        const rule = ruleScore(r.compensations);
        return rule.counted && rule.score !== null ? [rule.score] : [];
      });
      return { value: scores.length > 0 ? mean(scores) : null, units: scores.length };
    }
    case "loweringS": {
      const ms = meanPresent(timed.map((r) => r.descentMs));
      return { value: ms === null ? null : ms / 1000, units: timed.length };
    }
    case "raisingS": {
      const ms = meanPresent(timed.map((r) => r.timeToPeakMs));
      return { value: ms === null ? null : ms / 1000, units: timed.length };
    }
    case "completionPct":
      return {
        value: peakReps.length > 0 ? (100 * peakReps.filter((r) => r.complete).length) / peakReps.length : null,
        units: peakReps.length,
      };
    case "peakSpread":
      return { value: sampleSd(peaks), units: peakReps.length };
    default:
      return { value: null, units: 0 };
  }
}
