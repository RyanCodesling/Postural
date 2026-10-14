/**
 * Builds the trend model's input series from saved session summaries and maps
 * the fitted model back onto the chart's session axis.
 *
 * The data rules match the model's evaluation:
 *  - only the prescribed side(s) count;
 *  - a repetition measure counts for a session only when that side has at least
 *    3 repetitions behind it (an aborted attempt is not a session measurement);
 *  - holds use each set's time in the target band as a percentage of its own
 *    prescribed hold, so a change of hold length is not read as a trend; a
 *    hold measure counts only the sets that recorded it (see
 *    `measureFromDetail`, which the breakdown shares);
 *  - repetitions and sessions follow the trend data rules (`trendRules.ts`):
 *    timing skips each set's first repetition, a poorly tracked repetition
 *    counts nowhere, and a poorly tracked session is drawn but left out of the
 *    trend line.
 */
import type { MetricName } from "@/lib/exercises/registry";
import { OVERLAY_LABELS } from "@/lib/pose/drawCompensationOverlay";
import type { PrescribedSide } from "@/lib/prescriptionContext";
import { prescribedOutcomeSides } from "@/lib/sessionOutcomePresentation";
import { measureFromDetail, type SessionRepsDetail } from "./trendBreakdown";
import { sessionPoorlyTracked } from "./trendRules";
import {
  fitTrend,
  TREND_MODEL,
  trendMeasureSpec,
  type TrendFit,
  type TrendLabel,
  type TrendMeasureSpec,
  type TrendModelConfig,
} from "./trendModel";

export type TrendMeasureName =
  | "peak" | "formScore" | "inBandPct" | "holdFormScore"
  | "loweringS" | "raisingS" | "completionPct" | "peakSpread" | `exposure:${string}`
  | "holdSteadiness" | "holdError" | "holdDroop";
export type TrendSide = "left" | "right" | "card";

export interface CompensationExposure {
  left: number | null;
  right: number | null;
  leftN: number;
  rightN: number;
}

/** The per-session fields the model reads; `GET /api/sessions` rows satisfy it. */
export interface TrendModelSession {
  exerciseKind: "dynamic" | "isometric" | null;
  setCount: number;
  avgLeftPeakValue?: number | null;
  avgRightPeakValue?: number | null;
  leftReps?: number;
  rightReps?: number;
  completeLeftReps?: number;
  completeRightReps?: number;
  avgLeftFormScore?: number | null;
  avgRightFormScore?: number | null;
  leftFormReps?: number;
  rightFormReps?: number;
  /** A hold session's sets with their measurements; every hold measure comes from these. */
  holdSets?: SessionRepsDetail["sets"] | null;
  avgLeftLoweringMs?: number | null;
  avgRightLoweringMs?: number | null;
  avgLeftRaisingMs?: number | null;
  avgRightRaisingMs?: number | null;
  sdLeftPeakValue?: number | null;
  sdRightPeakValue?: number | null;
  /** Time over each threshold; the session list already leaves poorly tracked repetitions out. */
  exposure?: Record<string, CompensationExposure> | null;
  /**
   * The session's repetitions under the trend data rules. Without it (data
   * read before the rules) the fields above are used and every repetition counts.
   */
  trend?: TrendRepSummary | null;
}

/** A session's repetition summary under the trend data rules (`trendRules.ts`). */
export interface TrendRepSummary {
  rulesVersion: string;
  leftReps: number;
  rightReps: number;
  completeLeftReps: number;
  completeRightReps: number;
  avgLeftPeakValue: number | null;
  avgRightPeakValue: number | null;
  sdLeftPeakValue: number | null;
  sdRightPeakValue: number | null;
  avgLeftFormScore: number | null;
  avgRightFormScore: number | null;
  leftFormReps: number;
  rightFormReps: number;
  avgLeftLoweringMs: number | null;
  avgRightLoweringMs: number | null;
  avgLeftRaisingMs: number | null;
  avgRightRaisingMs: number | null;
  /** Repetitions behind the timing measures: each set's first is left out. */
  leftTimingReps: number;
  rightTimingReps: number;
  /** Repetitions with a tracking record, and the poorly tracked ones among them. */
  trackedReps: number;
  poorlyTrackedReps: number;
}

type RepValues = Omit<TrendRepSummary, "rulesVersion" | "trackedReps" | "poorlyTrackedReps">;

/** The repetition values a session's trend points use: its rule summary, or the plain fields before it. */
function repValues(session: TrendModelSession): RepValues {
  if (session.trend) return session.trend;
  return {
    leftReps: session.leftReps ?? 0,
    rightReps: session.rightReps ?? 0,
    completeLeftReps: session.completeLeftReps ?? 0,
    completeRightReps: session.completeRightReps ?? 0,
    avgLeftPeakValue: session.avgLeftPeakValue ?? null,
    avgRightPeakValue: session.avgRightPeakValue ?? null,
    sdLeftPeakValue: session.sdLeftPeakValue ?? null,
    sdRightPeakValue: session.sdRightPeakValue ?? null,
    avgLeftFormScore: session.avgLeftFormScore ?? null,
    avgRightFormScore: session.avgRightFormScore ?? null,
    leftFormReps: session.leftFormReps ?? 0,
    rightFormReps: session.rightFormReps ?? 0,
    avgLeftLoweringMs: session.avgLeftLoweringMs ?? null,
    avgRightLoweringMs: session.avgRightLoweringMs ?? null,
    avgLeftRaisingMs: session.avgLeftRaisingMs ?? null,
    avgRightRaisingMs: session.avgRightRaisingMs ?? null,
    leftTimingReps: session.leftReps ?? 0,
    rightTimingReps: session.rightReps ?? 0,
  };
}

/** Why a session is drawn but left out of the trend line (rule 3), or null. */
export function sessionHeldOutReason(session: TrendModelSession): string | null {
  const t = session.trend;
  if (!t || !sessionPoorlyTracked(t.trackedReps, t.poorlyTrackedReps)) return null;
  return `camera tracking was poor in ${t.poorlyTrackedReps} of ${t.trackedReps} repetitions`;
}

/**
 * Sessions rule 3 leaves out of the trend lines, counted per session: a chart
 * draws a left-out session hollow only where enough well-tracked repetitions
 * remain to plot, so the worst-tracked sessions may have no point at all.
 * Holds carry no tracking record, so rule 3 never applies to them.
 */
export function heldOutSessionCount(sessions: readonly TrendModelSession[]): number {
  return sessions.filter((s) => s.exerciseKind !== "isometric" && sessionHeldOutReason(s) !== null).length;
}

/** Whether a chart of the series has anything to draw: counted points or hollow ones. */
export function hasChartPoints(series: Pick<ModelSeries, "counted" | "heldOut">): boolean {
  return series.counted > 0 || series.heldOut.some((held) => held !== null);
}

export interface ModelSeries {
  measure: TrendMeasureName;
  side: TrendSide;
  spec: TrendMeasureSpec | null;
  /** One entry per session of the group, oldest → newest; null where the session does not count. */
  values: (number | null)[];
  units: (number | null)[];
  /** Sessions drawn but left out of the trend line (trend data rule 3), with the measured value and why. */
  heldOut: ({ value: number; reason: string } | null)[];
  counted: number;
  fit: TrendFit | null;
  label: TrendLabel | null;
  bandMean: (number | null)[];
  bandLow: (number | null)[];
  bandHigh: (number | null)[];
}

const finite = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value);

export function sessionMeasure(
  session: TrendModelSession,
  measure: TrendMeasureName,
  side: TrendSide,
): { value: number | null; units: number } {
  if (HOLD_UNIT_MEASURES.has(measure)) {
    return measureFromDetail({ reps: [], sets: session.holdSets ?? [] }, measure, side);
  }
  const left = side === "left";
  const r = repValues(session);
  const reps = left ? r.leftReps : r.rightReps;
  if (measure.startsWith("exposure:")) {
    const exposure = session.exposure?.[measure.slice("exposure:".length)];
    const share = left ? exposure?.left : exposure?.right;
    return { value: finite(share) ? 100 * share : null, units: (left ? exposure?.leftN : exposure?.rightN) ?? 0 };
  }
  switch (measure) {
    case "loweringS": {
      const ms = left ? r.avgLeftLoweringMs : r.avgRightLoweringMs;
      return { value: finite(ms) ? ms / 1000 : null, units: left ? r.leftTimingReps : r.rightTimingReps };
    }
    case "raisingS": {
      const ms = left ? r.avgLeftRaisingMs : r.avgRightRaisingMs;
      return { value: finite(ms) ? ms / 1000 : null, units: left ? r.leftTimingReps : r.rightTimingReps };
    }
    case "completionPct": {
      const complete = left ? r.completeLeftReps : r.completeRightReps;
      return { value: reps > 0 && finite(complete) ? (100 * complete) / reps : null, units: reps };
    }
    case "peakSpread":
      return { value: (left ? r.sdLeftPeakValue : r.sdRightPeakValue) ?? null, units: reps };
  }
  switch (measure) {
    case "peak":
      return side === "left"
        ? { value: r.avgLeftPeakValue, units: r.leftReps }
        : { value: r.avgRightPeakValue, units: r.rightReps };
    case "formScore":
      return side === "left"
        ? { value: r.avgLeftFormScore, units: r.leftFormReps }
        : { value: r.avgRightFormScore, units: r.rightFormReps };
    default:
      return { value: null, units: 0 };
  }
}

const HOLD_UNIT_MEASURES = new Set<string>(["inBandPct", "holdFormScore", "holdSteadiness", "holdError", "holdDroop"]);

/** The fewest repetitions (or sets, for holds) a session needs to count for a measure. */
export function minUnitsFor(exerciseId: string, measure: TrendMeasureName, config: TrendModelConfig = TREND_MODEL): number {
  return trendMeasureSpec(exerciseId, measure, config)?.minUnits ?? (HOLD_UNIT_MEASURES.has(measure) ? 1 : 3);
}

/**
 * Bands withheld after the model's settings were frozen, because the measure
 * itself changed. The side-bend target moved from 25 to 17 on 2026-10-02 by
 * user decision; this band's variation had been learned under 25, when almost
 * no repetitions reached the target, and the share now behaves differently.
 * The lateral arm raise target moved from 90 to 85 on 2026-10-11 by user
 * decision, for the same kind of reason (a horizontal arm reads just under
 * 90); its share's variation had been learned under 90, and the share now
 * reads higher for the same raises. The chart shows measured values only,
 * like any measure without a checked band, until the band is checked under
 * the new target. The frozen settings file is unchanged.
 *
 * The side bend's form score and the arm hold's hold form score are withheld
 * for the same kind of reason. On 2026-10-14, by user decision, the measures
 * that cannot identify a fault on those exercises stopped counting in the
 * score (`excludedFromFormScore` in the registry): the side bend's neck tilt
 * and shoulder height, and the hold's shoulder height. Their bands were learned
 * while those measures still cost correct movements points. The side bend now
 * has no scored measure, so new sessions record no form score for it.
 */
export const BAND_WITHHELD: ReadonlySet<string> = new Set([
  "ex_005:completionPct",
  "ex_001:completionPct",
  "ex_005:formScore",
  "ex_006:holdFormScore",
]);

/** The measure's settings as the charts use them: a withheld band reads as no band. */
export function displayMeasureSpec(
  exerciseId: string,
  measure: TrendMeasureName,
  config: TrendModelConfig = TREND_MODEL,
): TrendMeasureSpec | null {
  const spec = trendMeasureSpec(exerciseId, measure, config);
  return spec && BAND_WITHHELD.has(`${exerciseId}:${measure}`) ? { ...spec, band: false } : spec;
}

/**
 * The values a measure can take. Time in band can pass 100 % when a hold runs
 * past the prescribed time; peaks and drift are left open.
 */
export function measureBounds(measure: TrendMeasureName): [number, number] {
  if (measure === "completionPct" || measure === "formScore" || measure === "holdFormScore" || measure.startsWith("exposure:")) {
    return [0, 100];
  }
  if (measure === "peak" || measure === "holdDroop") return [-Infinity, Infinity];
  return [0, Infinity];
}

/**
 * The model's ranges are Gaussian, so near a limit they can reach past it (a
 * completion change of +104 points). For display they are cut to the values
 * the measure can take, which cannot lower the chance that a range holds the
 * true value; the probability and label stay as fitted.
 */
function withinBounds(fit: TrendFit, [lo, hi]: [number, number]): TrendFit {
  const cut = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
  const level = (v: number) => cut(v, lo, hi);
  const change = (v: number) => cut(v, lo - hi, hi - lo);
  return {
    ...fit,
    meanChange: change(fit.meanChange),
    changeLow: change(fit.changeLow),
    changeHigh: change(fit.changeHigh),
    levelMean: fit.levelMean.map(level),
    levelLow: fit.levelLow.map(level),
    levelHigh: fit.levelHigh.map(level),
  };
}

/** The main (labelled) measure and the form measure for an exercise kind. */
export function trendMeasures(kind: TrendModelSession["exerciseKind"]): {
  primary: TrendMeasureName;
  form: TrendMeasureName;
  formPerSide: boolean;
} {
  return kind === "isometric"
    ? { primary: "inBandPct", form: "holdFormScore", formPerSide: false }
    : { primary: "peak", form: "formScore", formPerSide: true };
}

/** Cheap data preparation, also used to show measured points while a worker fits. */
export function prepareModelSeries(
  exerciseId: string,
  sessions: TrendModelSession[],
  measure: TrendMeasureName,
  side: TrendSide,
  config: TrendModelConfig = TREND_MODEL,
): ModelSeries {
  const spec = displayMeasureSpec(exerciseId, measure, config);
  const minUnits = minUnitsFor(exerciseId, measure, config);
  const values: (number | null)[] = [];
  const units: (number | null)[] = [];
  const heldOut: ModelSeries["heldOut"] = [];
  for (const session of sessions) {
    const { value, units: count } = sessionMeasure(session, measure, side);
    const counts = finite(value) && count >= minUnits;
    // Rule 3: a poorly tracked session is drawn, hollow, but not fitted.
    const reason = counts && !HOLD_UNIT_MEASURES.has(measure) ? sessionHeldOutReason(session) : null;
    values.push(counts && reason === null ? value : null);
    units.push(counts && reason === null ? count : null);
    heldOut.push(reason === null ? null : { value: value as number, reason });
  }
  const countedIndex = values.flatMap((v, i) => (v === null ? [] : [i]));
  const empty = () => values.map(() => null as number | null);
  return {
    measure, side, spec, values, units, heldOut, counted: countedIndex.length,
    fit: null, label: spec?.labelled ? "collecting" : null,
    bandMean: empty(), bandLow: empty(), bandHigh: empty(),
  };
}

/** Same fitted values and display bounds for synchronous callers and the worker. */
export function fitModelSeries(series: ModelSeries, config: TrendModelConfig = TREND_MODEL): ModelSeries {
  const { measure, side, spec, values, units, heldOut } = series;
  const countedIndex = values.flatMap((v, i) => (v === null ? [] : [i]));
  const empty = () => values.map(() => null as number | null);
  const bandMean = empty();
  const bandLow = empty();
  const bandHigh = empty();
  let fit: TrendFit | null = null;
  if (spec && spec.band !== false && countedIndex.length >= 2) {
    fit = withinBounds(
      fitTrend(
        countedIndex.map((i) => values[i] as number),
        // A session-level value has no within-session units of its own.
        countedIndex.map((i) => (spec.sessionLevel ? 1 : (units[i] as number))),
        spec,
        config,
      ),
      measureBounds(measure),
    );
    countedIndex.forEach((sessionIndex, k) => {
      bandMean[sessionIndex] = fit!.levelMean[k];
      bandLow[sessionIndex] = fit!.levelLow[k];
      bandHigh[sessionIndex] = fit!.levelHigh[k];
    });
  }
  let label: TrendLabel | null = null;
  if (spec?.labelled) {
    label = fit ? fit.label : "collecting";
  }
  return { measure, side, spec, values, units, heldOut, counted: countedIndex.length, fit, label, bandMean, bandLow, bandHigh };
}

export function modelSeries(
  exerciseId: string,
  sessions: TrendModelSession[],
  measure: TrendMeasureName,
  side: TrendSide,
  config: TrendModelConfig = TREND_MODEL,
): ModelSeries {
  return fitModelSeries(prepareModelSeries(exerciseId, sessions, measure, side, config), config);
}

export function prepareGroupModelSeries(
  exerciseId: string,
  prescribedSide: PrescribedSide,
  sessions: TrendModelSession[],
  measure: TrendMeasureName,
  perSide: boolean,
  config: TrendModelConfig = TREND_MODEL,
): ModelSeries[] {
  const sides: TrendSide[] = perSide ? prescribedOutcomeSides(prescribedSide) : ["card"];
  return sides.map((side) => prepareModelSeries(exerciseId, sessions, measure, side, config));
}

/** Model series for the group's prescribed side(s), or one card-level series. */
export function groupModelSeries(
  exerciseId: string,
  prescribedSide: PrescribedSide,
  sessions: TrendModelSession[],
  measure: TrendMeasureName,
  perSide: boolean,
  config: TrendModelConfig = TREND_MODEL,
): ModelSeries[] {
  const sides: TrendSide[] = perSide ? prescribedOutcomeSides(prescribedSide) : ["card"];
  return sides.map((side) => modelSeries(exerciseId, sessions, measure, side, config));
}

export interface ExtraMeasureDefinition {
  measure: TrendMeasureName;
  title: string;
  unit: string;
  /** Unit of a change, e.g. percentage points for a share. */
  changeUnit: string;
  format: (value: number) => string;
}

/** The compensations whose time over threshold is charted for an exercise, with the app's overlay labels. */
export function exposureMetrics(
  exerciseId: string,
  config: TrendModelConfig = TREND_MODEL,
): { metric: string; label: string }[] {
  const prefix = `${exerciseId}:exposure:`;
  return Object.keys(config.measures)
    .filter((key) => key.startsWith(prefix))
    .map((key) => {
      const metric = key.slice(prefix.length);
      return { metric, label: OVERLAY_LABELS[metric as MetricName] ?? metric };
    });
}

/**
 * The extra measures charted under "More measures": model bands and change
 * estimates, never a label. Compensation names are the app's own overlay labels.
 */
export function extraTrendMeasures(
  exerciseId: string,
  kind: TrendModelSession["exerciseKind"],
  config: TrendModelConfig = TREND_MODEL,
): ExtraMeasureDefinition[] {
  const seconds = (v: number) => v.toFixed(2);
  const whole = (v: number) => v.toFixed(0);
  const one = (v: number) => v.toFixed(1);
  if (kind === "isometric") {
    return [
      { measure: "holdSteadiness", title: "Hold steadiness: angle spread within the hold (camera estimate; lower is steadier)", unit: "", changeUnit: "", format: one },
      { measure: "holdError", title: "Distance from the target angle (camera estimate)", unit: "", changeUnit: "", format: one },
      { measure: "holdDroop", title: "Drift during the hold (angle change per second, camera estimate)", unit: "", changeUnit: "", format: (v) => v.toFixed(2) },
    ];
  }
  return [
    { measure: "loweringS", title: "Lowering time (descent control)", unit: " s", changeUnit: " s", format: seconds },
    { measure: "raisingS", title: "Raising time", unit: " s", changeUnit: " s", format: seconds },
    { measure: "completionPct", title: "Repetitions reaching the target range", unit: "%", changeUnit: " points", format: whole },
    { measure: "peakSpread", title: "Rep-to-rep spread of the peak (lower is more consistent)", unit: "", changeUnit: "", format: one },
    ...exposureMetrics(exerciseId, config).map(({ metric, label }): ExtraMeasureDefinition => ({
      measure: `exposure:${metric}`,
      title: `${label}: share of repetition time above the app's threshold`,
      unit: "%",
      changeUnit: " points",
      format: whole,
    })),
  ];
}

export const TREND_LABEL_TEXT: Record<TrendLabel, string> = {
  rising: "Rising",
  no_clear_change: "No clear change",
  falling: "Falling",
  collecting: "Collecting data",
};

/** "+8.2 (95 % range +2.1 to +14.0)" in the measure's own display format. */
/** The signed change estimate and its 95 % range; `between` goes after the estimate (the PDF's "since the first counted session"). */
export function changeText(fit: TrendFit, format: (value: number) => string, between = ""): string {
  const signed = (v: number) => `${v >= 0 ? "+" : "−"}${format(Math.abs(v))}`;
  return `${signed(fit.meanChange)}${between} (95 % range ${signed(fit.changeLow)} to ${signed(fit.changeHigh)})`;
}
