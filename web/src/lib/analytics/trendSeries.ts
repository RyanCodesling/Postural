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
 *    `measureFromDetail`, which the breakdown shares).
 */
import type { MetricName } from "@/lib/exercises/registry";
import { OVERLAY_LABELS } from "@/lib/pose/drawCompensationOverlay";
import type { PrescribedSide } from "@/lib/prescriptionContext";
import { prescribedOutcomeSides } from "@/lib/sessionOutcomePresentation";
import { measureFromDetail, type SessionRepsDetail } from "./trendBreakdown";
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
  exposure?: Record<string, CompensationExposure> | null;
}

export interface ModelSeries {
  measure: TrendMeasureName;
  side: TrendSide;
  spec: TrendMeasureSpec | null;
  /** One entry per session of the group, oldest → newest; null where the session does not count. */
  values: (number | null)[];
  units: (number | null)[];
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
  const reps = (left ? session.leftReps : session.rightReps) ?? 0;
  if (measure.startsWith("exposure:")) {
    const exposure = session.exposure?.[measure.slice("exposure:".length)];
    const share = left ? exposure?.left : exposure?.right;
    return { value: finite(share) ? 100 * share : null, units: (left ? exposure?.leftN : exposure?.rightN) ?? 0 };
  }
  switch (measure) {
    case "loweringS": {
      const ms = left ? session.avgLeftLoweringMs : session.avgRightLoweringMs;
      return { value: finite(ms) ? ms / 1000 : null, units: reps };
    }
    case "raisingS": {
      const ms = left ? session.avgLeftRaisingMs : session.avgRightRaisingMs;
      return { value: finite(ms) ? ms / 1000 : null, units: reps };
    }
    case "completionPct": {
      const complete = left ? session.completeLeftReps : session.completeRightReps;
      return { value: reps > 0 && finite(complete) ? (100 * complete) / reps : null, units: reps };
    }
    case "peakSpread":
      return { value: (left ? session.sdLeftPeakValue : session.sdRightPeakValue) ?? null, units: reps };
  }
  switch (measure) {
    case "peak":
      return side === "left"
        ? { value: session.avgLeftPeakValue ?? null, units: session.leftReps ?? 0 }
        : { value: session.avgRightPeakValue ?? null, units: session.rightReps ?? 0 };
    case "formScore":
      return side === "left"
        ? { value: session.avgLeftFormScore ?? null, units: session.leftFormReps ?? 0 }
        : { value: session.avgRightFormScore ?? null, units: session.rightFormReps ?? 0 };
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
 * The chart shows measured values only, like any measure without a checked
 * band, until the band is checked under the new target. The frozen settings
 * file is unchanged.
 */
export const BAND_WITHHELD: ReadonlySet<string> = new Set(["ex_005:completionPct"]);

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
  for (const session of sessions) {
    const { value, units: count } = sessionMeasure(session, measure, side);
    const counts = finite(value) && count >= minUnits;
    values.push(counts ? value : null);
    units.push(counts ? count : null);
  }
  const countedIndex = values.flatMap((v, i) => (v === null ? [] : [i]));
  const empty = () => values.map(() => null as number | null);
  return {
    measure, side, spec, values, units, counted: countedIndex.length,
    fit: null, label: spec?.labelled ? "collecting" : null,
    bandMean: empty(), bandLow: empty(), bandHigh: empty(),
  };
}

/** Same fitted values and display bounds for synchronous callers and the worker. */
export function fitModelSeries(series: ModelSeries, config: TrendModelConfig = TREND_MODEL): ModelSeries {
  const { measure, side, spec, values, units } = series;
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
  return { measure, side, spec, values, units, counted: countedIndex.length, fit, label, bandMean, bandLow, bandHigh };
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
      title: `Time over threshold: ${label}`,
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
export function changeText(fit: TrendFit, format: (value: number) => string): string {
  const signed = (v: number) => `${v >= 0 ? "+" : "−"}${format(Math.abs(v))}`;
  return `${signed(fit.meanChange)} (95 % range ${signed(fit.changeLow)} to ${signed(fit.changeHigh)})`;
}
