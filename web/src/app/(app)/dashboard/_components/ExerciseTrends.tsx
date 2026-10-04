"use client";

// Shared per-exercise progress-trend rendering, used by both the therapist
// patient-detail page and the patient "My Progress" view, over already-persisted
// per-session summaries. The Rising / No clear change / Falling labels and the
// shaded bands come from the machine-learning trend model (lib/analytics): a
// label appears only when a side's change since its first session is larger than
// normal session-to-session variation. Supplementary information, not a
// diagnosis. Left/right are never summed.

import { useMemo, useState } from "react";
import { getExerciseDefinition } from "@/lib/exercises/registry";
import { TREND_MODEL } from "@/lib/analytics/trendModel";
import {
  changeText,
  extraTrendMeasures,
  prepareGroupModelSeries,
  TREND_LABEL_TEXT,
  trendMeasures,
  type ExtraMeasureDefinition,
  type ModelSeries,
  type TrendModelSession,
} from "@/lib/analytics/trendSeries";
import type { TrendLabel } from "@/lib/analytics/trendModel";
import { useTrendFits } from "@/lib/analytics/useTrendFits";
import {
  comparableContextKey,
  formatResistanceContext,
  recordedExercise,
  type PrescribedSide,
  type ResistanceContext,
} from "@/lib/prescriptionContext";
import {
  ANGLE_ESTIMATE_LABEL,
  fullRomOutcomeText,
  prescribedOutcomeSides,
  prescribedValue,
  sideLabel,
} from "@/lib/sessionOutcomePresentation";
import SessionBreakdown, { type BreakdownFocus } from "./SessionBreakdown";
import TrendChart, { type TrendSeries } from "./TrendChart";

/** The per-session fields the trends need, including every field the trend model
 *  reads. Both dashboards' session shapes (from GET /api/sessions →
 *  getSessionsForPatient) structurally satisfy this. */
export interface TrendSession extends TrendModelSession {
  /** Lets a chart point open the session's repetitions. */
  id?: number;
  exerciseId: string;
  exerciseName: string;
  exerciseKind: "dynamic" | "isometric" | null;
  startedAt: string;
  avgPeakValue: number | null;
  avgLeftPeakValue?: number | null;
  avgRightPeakValue?: number | null;
  completeLeftReps: number;
  completeRightReps: number;
  leftReps?: number;
  rightReps?: number;
  totalPairedHoldMs: number | null;
  totalLeftHoldMs?: number | null;
  totalRightHoldMs?: number | null;
  totalTargetHoldMs?: number | null;
  /** Rule form score per side (repetitions with >= 80 % score coverage) and its repetition count. */
  avgLeftFormScore?: number | null;
  avgRightFormScore?: number | null;
  leftFormReps?: number;
  rightFormReps?: number;
  /** Rule compensation score of a hold session. */
  avgCompensationScore?: number | null;
  setCount: number;
  totalReps: number;
  comparableContextKey?: string;
  prescribedSide?: PrescribedSide;
  resistance?: ResistanceContext;
  exerciseConfigVersion?: string | null;
  /** Start context: what kind and metric the exercise had when recorded. */
  context?: unknown;
}

export type TrendStatus = "improving" | "plateau" | "regressing";

export interface TrendGroup<S extends TrendSession = TrendSession> {
  contextKey: string;
  exerciseId: string;
  exerciseName: string;
  exerciseKind: TrendSession["exerciseKind"];
  /** The recorded primary metric; decides angle vs normalized units. */
  primaryMetric: string | null;
  prescribedSide: PrescribedSide;
  resistance: ResistanceContext;
  exerciseConfigVersion: string;
  sessions: S[]; // oldest → newest
}

const LABEL_STYLE: Record<TrendLabel, string> = {
  rising: "bg-green-100 text-green-700",
  no_clear_change: "bg-gray-100 text-gray-600",
  falling: "bg-amber-100 text-amber-700",
  collecting: "bg-gray-50 text-gray-400",
};

const SIDE_COLOR = { left: "#2563eb", right: "#ea580c", card: "#15803d" } as const;

const LEGACY_RESISTANCE: ResistanceContext = {
  type: "unknown",
  value: null,
  unit: null,
  label: null,
};

function sessionContext(s: TrendSession) {
  const prescribedSide = s.prescribedSide ?? "both";
  const resistance = s.resistance ?? LEGACY_RESISTANCE;
  const exerciseConfigVersion = s.exerciseConfigVersion ?? "legacy-unversioned";
  return {
    prescribedSide,
    resistance,
    exerciseConfigVersion,
    contextKey:
      s.comparableContextKey ??
      comparableContextKey({
        exerciseId: s.exerciseId,
        prescribedSide,
        resistance,
        exerciseConfigVersion,
      }),
  };
}

// Group sessions by exact exercise + prescription + scoring configuration.
// This prevents a side/load/threshold change from being presented as one
// continuous clinical trend. Outcome-bearing sessions only (a started-then-
// abandoned session has no reps/sets and would add spurious zero points). Input
// is newest-first (the API orders started_at DESC), so each group is reversed to
// oldest→newest for the time axis; groups are ordered by most-recent activity.
export function groupSessionsByExercise<S extends TrendSession>(sessions: S[]): TrendGroup<S>[] {
  const real = sessions.filter((s) => s.setCount > 0 || s.totalReps > 0);
  const map = new Map<string, S[]>();
  for (const s of real) {
    const key = sessionContext(s).contextKey;
    const arr = map.get(key) ?? [];
    arr.push(s);
    map.set(key, arr);
  }
  return Array.from(map.entries())
    .map(([contextKey, list]) => {
      const context = sessionContext(list[0]);
      // A group is one saved configuration, so the kind and primary metric its
      // sessions recorded describe it. The current registry is only a fallback:
      // an exercise can change between configurations (ex_004 went from a hold
      // to repetitions), and old sessions keep their own meaning. Any session
      // with a kind will do, since a newest session can lack one.
      const recorded = list.map((s) => recordedExercise(s.context)).find((r) => r !== null) ?? null;
      const current = getExerciseDefinition(list[0].exerciseId);
      return {
        contextKey,
        exerciseId: list[0].exerciseId,
        exerciseName: list[0].exerciseName,
        exerciseKind:
          list.find((s) => s.exerciseKind != null)?.exerciseKind ??
          recorded?.kind ??
          current?.kind ??
          null,
        primaryMetric:
          recorded?.primaryMetric ??
          (current?.kind === "dynamic" ? current.primaryMetric.name : null),
        prescribedSide: context.prescribedSide,
        resistance: context.resistance,
        exerciseConfigVersion: context.exerciseConfigVersion,
        sessions: [...list].reverse(),
      };
    })
    .sort((a, b) =>
      b.sessions[b.sessions.length - 1].startedAt.localeCompare(
        a.sessions[a.sessions.length - 1].startedAt,
      ),
    );
}

// The session's primary trend value: ROM (avgPeakValue) for dynamic exercises,
// hold seconds for isometric. Null when the session didn't record it.
export function sessionPrimaryValue(s: TrendSession): number | null {
  const side = s.prescribedSide ?? "both";
  if (s.exerciseKind === "isometric") {
    const holdMs = prescribedValue(
      side,
      {
        left: s.totalLeftHoldMs ?? s.totalPairedHoldMs,
        right: s.totalRightHoldMs ?? s.totalPairedHoldMs,
      },
      s.totalPairedHoldMs,
    );
    return holdMs != null ? holdMs / 1000 : null;
  }
  return prescribedValue(
    side,
    {
      left: s.avgLeftPeakValue ?? s.avgPeakValue,
      right: s.avgRightPeakValue ?? s.avgPeakValue,
    },
    s.avgPeakValue,
  );
}

// Label / unit / whether the metric is an angle (the latter drives the badge
// deadband — hold seconds and ex_007's normalized units are not angles).
export function primaryMetricMeta(
  kind: TrendSession["exerciseKind"],
  primaryMetric: string | null,
): { label: string; unit: string; isAngle: boolean } {
  if (kind === "isometric") return { label: "Hold time", unit: "s", isAngle: false };
  // ex_007's overhead reach is in normalized units; the other readings are angles.
  const angle = primaryMetric !== "wristShoulderVertical";
  // Angles are camera estimates in pipeline units, so no degree sign.
  return { label: angle ? `Peak ${ANGLE_ESTIMATE_LABEL}` : "Peak", unit: "", isAngle: angle };
}

// The previous trend label, kept as the evaluation's comparison rule (B0): a
// least-squares slope over the session values (oldest → newest) whose projected
// change must clear max(3 for angle metrics, 5 % of the mean). The trend model
// replaced it on the dashboard and in the progress report because, at the
// session-to-session variation measured in recorded sessions, this rule labels
// many histories with no real change as improving or regressing.
export function trendStatus(values: number[], isAngle: boolean): TrendStatus | null {
  const n = values.length;
  if (n < 3) return null;
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - meanX) * (values[i] - meanY);
    den += (i - meanX) ** 2;
  }
  if (den === 0) return "plateau";
  const projected = (num / den) * (n - 1); // change across the whole window
  const deadband = Math.max(isAngle ? 3 : 0, 0.05 * Math.abs(meanY));
  if (projected > deadband) return "improving";
  if (projected < -deadband) return "regressing";
  return "plateau";
}

function fmtTrendDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

/** Month and day, for the charts' time axis. */
function fmtAxisDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Hover detail for a primary-trend point: its value, then the session's volume. */
export function primaryPointDetail(
  s: TrendSession,
  value: number,
  meta: { label: string; unit: string; isAngle: boolean },
  isIso: boolean,
): string {
  const shown = isIso
    ? value.toFixed(1)
    : meta.isAngle
      ? String(Math.round(value))
      : value.toFixed(2);
  const sets = `${s.setCount} set${s.setCount === 1 ? "" : "s"}`;
  return isIso
    ? `${meta.label}: ${shown}${meta.unit} · ${sets}`
    : `${meta.label}: ${shown}${meta.unit} · ${sets} · ${s.totalReps} rep${s.totalReps === 1 ? "" : "s"}`;
}

/** Hover detail for one side of the completed-reps trend. */
export function repPointDetail(s: TrendSession, side: "left" | "right"): string {
  const complete = side === "left" ? s.completeLeftReps : s.completeRightReps;
  const total = side === "left" ? s.leftReps : s.rightReps;
  return `${sideLabel(side)}: ${
    typeof total === "number" ? fullRomOutcomeText(complete, total) : `${complete} met full-ROM target`
  }`;
}

/**
 * Label, unit and number format of the trend model's main measure for a group.
 * `changeUnit` labels a change: for holds it is percentage points of the
 * prescribed hold, not a relative percentage.
 */
export function modelMeasureMeta(
  kind: TrendSession["exerciseKind"],
  primaryMetric: string | null,
): { label: string; unit: string; changeUnit: string; format: (value: number) => string } {
  if (kind === "isometric") {
    return { label: "Time in target band", unit: "%", changeUnit: " points", format: (v) => v.toFixed(0) };
  }
  const meta = primaryMetricMeta(kind, primaryMetric);
  return {
    label: meta.label,
    unit: meta.unit,
    changeUnit: meta.unit,
    format: meta.isAngle ? (v) => String(Math.round(v)) : (v) => v.toFixed(2),
  };
}

function seriesName(series: ModelSeries): string {
  return series.side === "card" ? "Session" : sideLabel(series.side);
}

/** Chart series for model series: measured points, and the model band where fitted. */
export function modelChartSeries(
  series: ModelSeries[],
  format: (value: number) => string,
  unit: string,
  unitsWord: string,
): TrendSeries[] {
  return series.map((s) => ({
    label: seriesName(s),
    color: SIDE_COLOR[s.side],
    values: s.values,
    band: s.fit ? { mean: s.bandMean, low: s.bandLow, high: s.bandHigh } : undefined,
    pointDetails: s.values.map((v, i) => {
      if (v === null) return null;
      const mean = s.bandMean[i];
      const low = s.bandLow[i];
      const high = s.bandHigh[i];
      const model =
        mean !== null && low !== null && high !== null
          ? ` · model ${format(mean)}${unit} (${format(low)}–${format(high)})`
          : "";
      const units = s.units[i];
      return `${seriesName(s)}: ${format(v)}${unit}${model} · ${units} ${units === 1 ? unitsWord.replace(/s$/, "") : unitsWord}`;
    }),
  }));
}

/** One line per side: the model's change estimate, or why there is none. */
export function extraMeasureSummary(series: ModelSeries[], def: ExtraMeasureDefinition): string {
  return series
    .filter((s) => s.counted > 0)
    .map((s) => {
      const side = s.side === "card" ? "" : `${sideLabel(s.side)}: `;
      if (s.spec?.band === false) return `${side}measured values only (no model band for this measure yet)`;
      if (!s.fit) return `${side}needs at least 2 counted sessions`;
      return `${side}change ${changeText(s.fit, (v) => `${def.format(v)}${def.changeUnit}`)}`;
    })
    .join(" · ");
}

function TrendBadges({ series, format, unit }: { series: ModelSeries[]; format: (v: number) => string; unit: string }) {
  const labelled = series.filter((s) => s.label !== null);
  if (labelled.length === 0) {
    return (
      <span className="shrink-0 text-xs px-3 py-1 rounded-full font-medium bg-gray-50 text-gray-400">
        No trend model
      </span>
    );
  }
  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      {labelled.map((s) => (
        <span
          key={s.side}
          className={`text-xs px-3 py-1 rounded-full font-medium ${LABEL_STYLE[s.label!]}`}
          title={
            s.fit
              ? `Change since the first counted session: ${changeText(s.fit, (v) => `${format(v)}${unit}`)}`
              : "Needs at least 3 counted sessions"
          }
        >
          {s.side === "card" ? "" : `${seriesName(s)}: `}
          {TREND_LABEL_TEXT[s.label!]}
        </span>
      ))}
    </div>
  );
}

export function ExerciseTrendCard({ group }: { group: TrendGroup }) {
  const {
    exerciseId,
    exerciseName,
    exerciseKind,
    prescribedSide,
    resistance,
    sessions,
  } = group;
  const isIso = exerciseKind === "isometric";
  const measures = trendMeasures(exerciseKind);
  const meta = modelMeasureMeta(exerciseKind, group.primaryMetric);
  const unitsWord = isIso ? "sets" : "reps";
  const [extrasOpen, setExtrasOpen] = useState(false);
  const prepared = useMemo(() => {
    const measures = trendMeasures(exerciseKind);
    return {
      primary: prepareGroupModelSeries(exerciseId, prescribedSide, sessions, measures.primary, true),
      form: prepareGroupModelSeries(exerciseId, prescribedSide, sessions, measures.form, measures.formPerSide),
      extras: extraTrendMeasures(exerciseId, exerciseKind)
        .map(def => ({ def, series: prepareGroupModelSeries(exerciseId, prescribedSide, sessions, def.measure, true) }))
        .filter(({ series }) => series.some(s => s.counted > 0)),
    };
  }, [exerciseId, exerciseKind, prescribedSide, sessions]);
  const requested = useMemo(() => [
    ...prepared.primary, ...prepared.form,
    ...(extrasOpen ? prepared.extras.flatMap(extra => extra.series) : []),
  ], [prepared, extrasOpen]);
  const { entries, retry } = useTrendFits(group.contextKey, requested);
  const primaryEntries = entries.filter(entry => entry.series.measure === measures.primary);
  const primarySeries = primaryEntries.map(entry => entry.series);
  const formSeries = entries.filter(entry => entry.series.measure === measures.form).map(entry => entry.series);
  const pendingPrimary = primaryEntries.some(entry => entry.status === "loading");
  const failedPrimary = primaryEntries.some(entry => entry.status === "error");
  const pending = entries.some(entry => entry.status === "loading");
  const failed = entries.some(entry => entry.status === "error");
  const titles = sessions.map((session) => fmtTrendDate(session.startedAt));
  const hasPrimary = primarySeries.some((s) => s.counted > 0);
  const hasForm = formSeries.some((s) => s.counted > 0);
  const extras = prepared.extras.map(({ def, series }) => {
    const fitted = entries.filter(entry => entry.series.measure === def.measure);
    return { def, series: extrasOpen ? fitted.map(entry => entry.series) : series,
      pending: fitted.some(entry => entry.status === "loading"), failed: fitted.some(entry => entry.status === "error") };
  });
  const formatScore = (v: number) => v.toFixed(0);
  const dates = sessions.map((session) => fmtAxisDate(session.startedAt));
  const primaryTitle = `${meta.label} over time${isIso ? " (% of the prescribed hold)" : ""}`;
  const completedTitle =
    prescribedSide === "both" ? "Completed reps — left vs right" : "Completed reps — prescribed side";
  const formTitle = "Form score over time (rule-based, 0–100)";

  // The session whose repetitions are open, by id so a refresh that adds
  // sessions keeps the same one, and the chart it was opened from.
  const [selected, setSelected] = useState<{ id: number; focus: BreakdownFocus; title: string } | null>(null);
  const selectedIndex = selected === null ? -1 : sessions.findIndex((s) => s.id === selected.id);
  const selectedSession = selectedIndex >= 0 ? sessions[selectedIndex] : null;
  const canOpenSessions = sessions.some((s) => typeof s.id === "number");
  // Every chart shares the dates and the selected session; a click opens (or
  // closes) that session's repetitions with the chart's own column highlighted.
  const chartProps = (focus: BreakdownFocus, title: string) => ({
    pointTitles: titles,
    pointDates: dates,
    ...(canOpenSessions
      ? {
          onSelect: (i: number) => {
            const id = sessions[i]?.id;
            if (typeof id !== "number") return;
            setSelected((current) => (current?.id === id && current.focus === focus ? null : { id, focus, title }));
          },
          selected: selectedIndex >= 0 ? selectedIndex : null,
        }
      : {}),
  });
  const openedFromExtras = selected !== null && extras.some(({ def }) => def.measure === selected.focus);
  const breakdown = selected !== null && selectedSession !== null && typeof selectedSession.id === "number" && (
    <SessionBreakdown
      key={selectedSession.id}
      sessionId={selectedSession.id}
      title={titles[selectedIndex]}
      exerciseId={exerciseId}
      exerciseKind={isIso ? "isometric" : "dynamic"}
      sides={prescribedOutcomeSides(prescribedSide).map((side) => ({ side, color: SIDE_COLOR[side] }))}
      focus={selected.focus}
      focusTitle={selected.title}
      main={{ ...meta, precise: primaryMetricMeta(exerciseKind, group.primaryMetric).isAngle ? (v) => v.toFixed(1) : meta.format }}
      onClose={() => setSelected(null)}
    />
  );

  const first = sessions[0];
  const last = sessions[sessions.length - 1];

  return (
    <div className="rounded-xl border border-gray-100 p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-green-700">{exerciseName}</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {prescribedSide === "both"
              ? "Both sides"
              : `${prescribedSide[0].toUpperCase()}${prescribedSide.slice(1)} side`}
            {" · "}
            {formatResistanceContext(resistance)}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            {sessions.length} session{sessions.length === 1 ? "" : "s"}
            {sessions.length > 1 && (
              <>
                {" · "}
                {fmtTrendDate(first.startedAt)} → {fmtTrendDate(last.startedAt)}
              </>
            )}
          </p>
        </div>
        {pendingPrimary || failedPrimary ? (
          <span className="shrink-0 text-xs text-gray-500">
            {failedPrimary ? "Trend unavailable" : "Calculating trend…"}
          </span>
        ) : <TrendBadges series={primarySeries} format={meta.format} unit={meta.changeUnit} />}
      </div>

      {(pending || failed) && (
        <p role="status" className="text-xs text-gray-500 mb-3">
          {failed
            ? "Some trend bands could not be calculated. Measured values remain available."
            : "Calculating trend bands. Measured values are available while you wait."}
          {failed && <button type="button" className="ml-2 underline text-green-700" onClick={retry}>Retry trend calculation</button>}
        </p>
      )}

      {sessions.length < 2 ? (
        <p className="text-xs text-gray-400 py-4 text-center">Needs ≥2 sessions to chart.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <p className="text-xs font-medium text-gray-500 mb-1">{primaryTitle}</p>
            {hasPrimary ? (
              <>
                <TrendChart
                  series={modelChartSeries(primarySeries, meta.format, meta.unit, unitsWord)}
                  unitSuffix={meta.unit}
                  {...chartProps(measures.primary, primaryTitle)}
                />
                {canOpenSessions && (
                  <p className="text-[11px] leading-4 text-gray-400 mt-1">
                    Click or tap a point on any chart to see the {isIso ? "sets" : "repetitions"} behind it.
                  </p>
                )}
              </>
            ) : (
              <p className="text-xs text-gray-400 py-4 text-center">
                No {meta.label.toLowerCase()} recorded.
              </p>
            )}
          </div>

          {!isIso && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">{completedTitle}</p>
              <TrendChart
                series={prescribedOutcomeSides(prescribedSide).map((side) => ({
                  label: sideLabel(side),
                  color: side === "left" ? "#2563eb" : "#ea580c",
                  values: sessions.map((session) =>
                    side === "left"
                      ? session.completeLeftReps
                      : session.completeRightReps,
                  ),
                  pointDetails: sessions.map((session) => repPointDetail(session, side)),
                }))}
                counts
                {...chartProps("completeReps", completedTitle)}
              />
            </div>
          )}

          {hasForm && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">{formTitle}</p>
              <TrendChart
                series={modelChartSeries(formSeries, formatScore, "", unitsWord)}
                {...chartProps(measures.form, formTitle)}
              />
            </div>
          )}
        </div>
      )}

      {sessions.length >= 2 && !openedFromExtras && breakdown}

      {sessions.length >= 2 && extras.length > 0 && (
        <details className="mt-4" open={extrasOpen} onToggle={event => setExtrasOpen(event.currentTarget.open)}>
          <summary className="cursor-pointer select-none text-xs font-medium text-green-700">
            More measures ({extras.length}):{" "}
            {isIso ? "steadiness, distance from the target and drift" : "descent control, consistency and compensations"}
          </summary>
          {extrasOpen && <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-3">
            {extras.map(({ def, series, pending, failed }) => (
              <div key={def.measure}>
                <p className="text-xs font-medium text-gray-500 mb-1">{def.title}</p>
                <TrendChart
                  series={modelChartSeries(series, def.format, def.unit, unitsWord)}
                  unitSuffix={def.unit}
                  {...chartProps(def.measure, def.title)}
                />
                <p className="text-[11px] leading-4 text-gray-400 mt-1">
                  {failed ? "Trend band unavailable; measured values shown." : pending ? "Calculating trend band…" : extraMeasureSummary(series, def)}
                </p>
              </div>
            ))}
          </div>}
          {openedFromExtras && breakdown}
          <p className="text-[11px] leading-4 text-gray-400 mt-3">
            These measures show the trend model&apos;s band and estimated change but never a Rising or Falling label.
            Where a measure has no band, its range did not pass the model&apos;s check, or it has no learned
            variation yet, so only the measured values are shown.
            {!isIso && " Compensation threshold shares describe raw signals, not time a cue was shown or time in incorrect form."}
          </p>
        </details>
      )}

      {sessions.length >= 2 && (
        <p className="text-[11px] leading-4 text-gray-400 mt-3">
          Shaded bands are the trend model&apos;s estimate of the underlying level, with a 95 % range. Rising or
          Falling appears only when a side&apos;s change since its first counted session is larger than normal
          session-to-session variation; the form score has a band but no label.{" "}
          {isIso
            ? "Holds are compared as time in the target band relative to the prescribed hold."
            : "Sessions with fewer than 3 repetitions on a side are not counted."}{" "}
          Supplementary information, not a diagnosis. Model {TREND_MODEL.version}.
        </p>
      )}
    </div>
  );
}
