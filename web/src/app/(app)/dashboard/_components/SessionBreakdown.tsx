"use client";

// How one session's points on a trend card were formed: each prescribed side's
// repetitions (or, for a hold, its sets) with every value the card's charts use,
// loaded from the session detail when a point is chosen. The column behind the
// chart that was clicked is highlighted, and the last row rebuilds each chart's
// point by that chart's rule. Left and right stay separate; angles keep the
// camera-estimate label, with no degree sign.

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  endOfSetRows,
  holdRows,
  measureFromDetail,
  neckRestOffsets,
  repRows,
  sessionTracking,
  setTimings,
  type EndOfSetRow,
  type RepRow,
  type SessionRepsDetail,
} from "@/lib/analytics/trendBreakdown";
import { NECK_REST_EXERCISES } from "@/lib/analytics/trendRules";
import { exposureMetrics, minUnitsFor, type TrendMeasureName, type TrendSide } from "@/lib/analytics/trendSeries";
import { formatPainAfter, formatPreSessionPain, preSessionPainFromContext } from "@/lib/prescriptionContext";
import { ANGLE_ESTIMATE_LABEL, sideLabel } from "@/lib/sessionOutcomePresentation";

type Side = "left" | "right";
/** The chart a point was chosen on: a trend measure, or the completed-reps chart. */
export type BreakdownFocus = TrendMeasureName | "completeReps";
/** The main chart's measure; `precise` shows single repetitions, e.g. angles to one decimal. */
type MainMeasure = { label: string; unit: string; format: (value: number) => string; precise?: (value: number) => string };

interface Column<R> {
  key: string;
  header: string;
  /** The charts this column is behind. */
  focus: BreakdownFocus[];
  cell: (row: R, index: number) => ReactNode;
  /** The chart's point for this session, or a plain summary. */
  total: ReactNode;
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const fixed = (value: number | null, digits: number, unit = "") => (value === null ? "—" : `${value.toFixed(digits)}${unit}`);

/** How the chart that opened the panel turns this session into its point. */
function focusRule(focus: BreakdownFocus): string {
  switch (focus) {
    case "formScore":
      return "its point is the average of the highlighted scores with at least 80 % tracking coverage (scores marked * are left out)";
    case "completionPct":
      return "its point is the share of repetitions that reached the target";
    case "completeReps":
      return "its point is the number of repetitions that reached the target";
    case "peakSpread":
      return "its point is the spread (standard deviation) of the highlighted column";
    case "inBandPct":
      return "its point is the average of the sets' in-band percentages, over the sets that recorded one";
    case "holdFormScore":
      return "its point is the average of the sets' form scores";
    case "holdSteadiness":
    case "holdError":
    case "holdDroop":
      return "its point is the average of the highlighted column over the sets";
    default:
      return "its point is the average of the highlighted column";
  }
}

export default function SessionBreakdown({
  sessionId,
  title,
  exerciseId,
  exerciseKind,
  sides,
  focus,
  focusTitle,
  main,
  onClose,
}: {
  sessionId: number;
  /** The session's heading, as on the charts (its date). */
  title: string;
  exerciseId: string;
  exerciseKind: "dynamic" | "isometric";
  sides: { side: Side; color: string }[];
  focus: BreakdownFocus;
  /** The title of the chart the point was chosen on. */
  focusTitle: string;
  /** The main chart's measure label, unit and number format. */
  main: MainMeasure;
  onClose: () => void;
}) {
  const [state, setState] = useState<{ kind: "loading" } | { kind: "error" } | { kind: "ready"; detail: SessionRepsDetail }>(
    { kind: "loading" },
  );
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/sessions/${sessionId}`, { cache: "no-store" });
        if (!response.ok) throw new Error(`session detail returned ${response.status}`);
        const { session } = (await response.json()) as { session?: SessionRepsDetail };
        if (!session || !Array.isArray(session.reps) || !Array.isArray(session.sets)) {
          throw new Error("session detail has no repetitions or sets");
        }
        if (!cancelled) setState({ kind: "ready", detail: session });
      } catch (error) {
        console.error("Session breakdown failed to load:", error);
        if (!cancelled) setState({ kind: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // Bring the panel into view once it has its content; it can open below the fold.
  useEffect(() => {
    if (state.kind === "ready") panel.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [state.kind]);

  const isHold = exerciseKind === "isometric";
  return (
    <section
      ref={panel}
      className="mt-4 rounded-lg border border-gray-100 bg-gray-50 p-3"
      aria-label={`${title}: how the points were formed`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-gray-700">{title}: how the points were formed</p>
          <p className="text-[11px] leading-4 text-gray-500 mt-0.5">
            Opened from &ldquo;{focusTitle}&rdquo;: {focusRule(focus)}. The last row of each table gives every
            chart&apos;s point for this session.
          </p>
        </div>
        <button type="button" onClick={onClose} className="shrink-0 text-xs text-gray-500 hover:text-gray-800">
          Close
        </button>
      </div>

      {state.kind === "loading" && <p className="text-xs text-gray-400 mt-3">Loading…</p>}
      {state.kind === "error" && (
        <p className="text-xs text-red-600 mt-3">The {isHold ? "sets" : "repetitions"} could not be loaded.</p>
      )}
      {state.kind === "ready" && (
        <div className="mt-3 space-y-5">
          <SessionLine detail={state.detail} />
          {isHold ? (
            <>
              {sides.map(({ side, color }) => (
                <HoldSide key={side} detail={state.detail} side={side} color={color} exerciseId={exerciseId} focus={focus} />
              ))}
              <HoldWhole detail={state.detail} exerciseId={exerciseId} focus={focus} />
            </>
          ) : (
            <>
              {sides.map(({ side, color }) => (
                <RepSide
                  key={side}
                  detail={state.detail}
                  side={side}
                  color={color}
                  exerciseId={exerciseId}
                  focus={focus}
                  main={main}
                />
              ))}
              <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-500">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2 w-2 rounded-full bg-gray-500" />
                  reached the target range (counted in completed reps)
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2 w-2 rounded-full border border-gray-500" />
                  did not
                </span>
                <span>dotted line: target · dashed line: average · click a dot or a row to match them</span>
              </p>
            </>
          )}
          <p className="text-[11px] leading-4 text-gray-400">
            The shaded band on each chart is the trend model&apos;s estimate across sessions, so it can sit away from a
            single session&apos;s point.
          </p>
        </div>
      )}
    </section>
  );
}

const durationText = (ms: number | null) => (ms === null ? "—" : `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`);

/** Pain before and after, and how long each set took with the rest between them. */
function SessionLine({ detail }: { detail: SessionRepsDetail }) {
  const timings = setTimings(detail);
  const sets = timings
    .map((t) =>
      `${t.restBeforeMs === null ? "" : `rest ${durationText(t.restBeforeMs)} · `}set ${t.setIndex} ${durationText(t.durationMs)}`,
    )
    .join(" · ");
  return (
    <p className="text-[11px] leading-4 text-gray-600">
      Pain before: {formatPreSessionPain(preSessionPainFromContext(detail.context))} · after:{" "}
      {detail.painReport ? formatPainAfter(detail.painReport) : "not reported"}
      {timings.length > 0 && <> · {sets}</>}
    </p>
  );
}

function Swatch({ color }: { color: string }) {
  return <span className="inline-block h-2 w-2 rounded-sm mr-1.5" style={{ backgroundColor: color }} />;
}

/** The chart's point for a session and side, and whether the session counts for the trend model. */
/**
 * Trend data rule 4, for a neck side bend: how its peaks were measured. They are
 * taken from the resting head position, so the still-head reading between sets
 * is taken off left peaks and added to right peaks.
 */
function neckRestCaption(detail: SessionRepsDetail, exerciseId: string): string {
  if (!NECK_REST_EXERCISES.has(exerciseId)) return "";
  const offsets = neckRestOffsets(detail) ?? [];
  if (offsets.length === 0) {
    return "No resting head position was recorded in this session, so its peaks are shown as measured against the camera tilt at the start and are left out of the peak trends.";
  }
  const readings = offsets.map((o) => `${o > 0 ? "+" : ""}${o.toFixed(1)}`).join(", ");
  return `Peaks are measured from the resting head position: the still-head reading between sets (${readings}, camera estimate) is taken off left peaks and added to right peaks.`;
}

function chartPoint(detail: SessionRepsDetail, exerciseId: string, measure: TrendMeasureName, side: TrendSide) {
  const { value, units } = measureFromDetail(detail, measure, side);
  return { value, units, counted: value !== null && units >= minUnitsFor(exerciseId, measure) };
}

function Point({ text, counted }: { text: string; counted: boolean }) {
  return (
    <>
      {text}
      {!counted && text !== "—" && <span className="block font-normal text-gray-400">not counted</span>}
    </>
  );
}

function BreakdownTable<R>({
  columns,
  rows,
  rowKey,
  focus,
  activeKey,
  onPick,
  caption,
}: {
  columns: Column<R>[];
  rows: R[];
  rowKey: (row: R) => number;
  focus: BreakdownFocus;
  activeKey?: number | null;
  onPick?: (key: number) => void;
  caption?: string;
}) {
  const focused = (col: Column<R>) => col.focus.includes(focus);
  return (
    <div className="overflow-x-auto mt-2">
      <table className="min-w-full border-collapse text-[11px] leading-4 text-gray-600">
        {caption && <caption className="caption-bottom pt-1 text-left text-gray-400">{caption}</caption>}
        <thead>
          <tr className="border-b border-gray-200 text-gray-500">
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={`px-1.5 py-1 text-right font-medium align-bottom first:text-left ${focused(col) ? "bg-green-50 text-green-800" : ""}`}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const key = rowKey(row);
            return (
              <tr
                key={key}
                data-row={key}
                onClick={onPick ? () => onPick(key) : undefined}
                className={`border-b border-gray-100 ${onPick ? "cursor-pointer" : ""} ${activeKey === key ? "bg-amber-50" : ""}`}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`px-1.5 py-0.5 text-right tabular-nums first:text-left ${focused(col) ? "bg-green-50" : ""}`}
                  >
                    {col.cell(row, i)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-gray-300 font-medium text-gray-700">
            {columns.map((col) => (
              <td
                key={col.key}
                className={`px-1.5 py-1 text-right align-top tabular-nums first:text-left ${
                  focused(col) ? "bg-green-50 font-semibold text-green-800" : ""
                }`}
              >
                {col.total}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function RepSide({
  detail,
  side,
  color,
  exerciseId,
  focus,
  main,
}: {
  detail: SessionRepsDetail;
  side: Side;
  color: string;
  exerciseId: string;
  focus: BreakdownFocus;
  main: MainMeasure;
}) {
  const [activeRep, setActiveRep] = useState<number | null>(null);
  const metrics = exposureMetrics(exerciseId);
  const rows = repRows(detail, side, metrics.map((m) => m.metric));
  const point = (measure: TrendMeasureName) => chartPoint(detail, exerciseId, measure, side);
  const targets = [...new Set(rows.map((r) => r.target).filter(finite))];
  const target = targets.length === 1 ? targets[0] : null;
  const exact = main.precise ?? main.format;
  // Peaks at full precision, so a repetition just under the target does not read as reaching it.
  const shown = (value: number | null) => (value === null ? "—" : `${exact(value)}${main.unit}`);
  const targetText = (value: number) => `${main.format(value)}${main.unit}`;
  const pauses = rows.map((r) => r.pauseS).filter(finite);

  const peak = point("peak");
  const spread = point("peakSpread");
  const completion = point("completionPct");
  const raising = point("raisingS");
  const lowering = point("loweringS");
  const form = point("formScore");
  const completeCount = rows.filter((r) => r.complete).length;
  const tracking = sessionTracking(detail);
  // Timing of each set's first repetition is left out of the trend (trend data rule 1).
  const timing = (r: RepRow, value: number | null) =>
    r.leftOut === "first-of-set" && value !== null ? (
      <span className="text-gray-400" title="First repetition of the set: its timing includes getting into position, so it is left out of the timing trend">
        {fixed(value, 2)}†
      </span>
    ) : (
      fixed(value, 2)
    );

  const columns: Column<RepRow>[] = [
    { key: "rep", header: "Rep", focus: [], cell: (_, i) => i + 1, total: "Chart point" },
    { key: "set", header: "Set", focus: [], cell: (r) => r.setIndex, total: "" },
    {
      key: "counted",
      header: "In the trends",
      focus: [],
      cell: (r) =>
        r.leftOut === "tracking" ? (
          <span className="text-amber-700" title="The camera tracked this repetition poorly, so it counts in no trend">No: camera tracking</span>
        ) : r.leftOut === "no-rest-reference" ? (
          <span className="text-amber-700" title="No resting head position was recorded to measure this peak from, so it counts in no peak trend">
            Yes, peak left out
          </span>
        ) : r.leftOut === "first-of-set" ? (
          "Yes, timing left out"
        ) : (
          "Yes"
        ),
      total: "",
    },
    {
      key: "peak",
      header: main.label,
      focus: ["peak", "peakSpread"],
      cell: (r) => shown(r.peak),
      total: (
        <>
          <Point text={shown(peak.value)} counted={peak.counted} />
          <span className={`block ${focus === "peakSpread" ? "" : "font-normal text-gray-500"}`}>
            spread {spread.value === null ? "—" : spread.value.toFixed(1)}
          </span>
        </>
      ),
    },
    {
      key: "reached",
      header: target !== null ? `Reached target (${targetText(target)} or more)` : "Reached target",
      focus: ["completionPct", "completeReps"],
      cell: (r) => (r.complete ? "Yes" : "No"),
      total: (
        <Point
          text={`${completeCount} of ${rows.length}${completion.value === null ? "" : ` (${completion.value.toFixed(0)}%)`}`}
          counted={completion.counted}
        />
      ),
    },
    {
      key: "raising",
      header: "Raising (s)",
      focus: ["raisingS"],
      cell: (r) => timing(r, r.raisingS),
      total: <Point text={fixed(raising.value, 2)} counted={raising.counted} />,
    },
    {
      key: "pause",
      header: "Pause at top (s)",
      focus: [],
      cell: (r) => fixed(r.pauseS, 2),
      total: <span className="font-normal text-gray-500">{pauses.length ? fixed(pauses.reduce((a, b) => a + b, 0) / pauses.length, 2) : "—"}</span>,
    },
    {
      key: "lowering",
      header: "Lowering (s)",
      focus: ["loweringS"],
      cell: (r) => timing(r, r.loweringS),
      total: <Point text={fixed(lowering.value, 2)} counted={lowering.counted} />,
    },
    {
      key: "tempo",
      header: "Lowering ÷ raising",
      focus: [],
      cell: (r) => (r.loweringS !== null && r.raisingS ? (r.loweringS / r.raisingS).toFixed(2) : "—"),
      total: (
        <span className="font-normal text-gray-500">
          {lowering.value !== null && raising.value ? (lowering.value / raising.value).toFixed(2) : "—"}
        </span>
      ),
    },
    {
      key: "form",
      header: "Form score (rule-based)",
      focus: ["formScore"],
      cell: (r) =>
        r.formScore === null ? (
          "—"
        ) : r.formCounted ? (
          r.formScore.toFixed(0)
        ) : (
          <span className="text-gray-400" title="Tracking coverage under 80 %: left out of the average">
            {r.formScore.toFixed(0)}*
          </span>
        ),
      total: <Point text={fixed(form.value, 0)} counted={form.counted} />,
    },
    ...metrics.map(({ metric, label }): Column<RepRow> => {
      const exposure = point(`exposure:${metric}`);
      const peaks = rows.map((r) => r.peakOverThreshold[metric]).filter(finite);
      return {
        key: metric,
        header: label,
        focus: [`exposure:${metric}`],
        cell: (r) => {
          const peak = r.peakOverThreshold[metric];
          const mean = r.meanOverThreshold[metric];
          return (
            <span
              title={
                peak === null
                  ? undefined
                  : `Raw-signal peak ${peak.toFixed(2)}× and average ${mean === null ? "—" : mean.toFixed(2)}× the configured threshold; not cue exposure`
              }
            >
              {fixed(r.overThresholdPct[metric] ?? null, 0, "%")}
              {/* Two decimals, so a peak just under the threshold never reads as reaching it. */}
              {peak !== null && <span className="block text-gray-400">{peak.toFixed(2)}×</span>}
            </span>
          );
        },
        total: (
          <>
            <Point text={fixed(exposure.value, 0, "%")} counted={exposure.counted} />
            {peaks.length > 0 && (
              <span className="block font-normal text-gray-500">highest {Math.max(...peaks).toFixed(2)}×</span>
            )}
          </>
        ),
      };
    }),
  ];

  return (
    <div className="min-w-0">
      <p className="text-xs text-gray-700">
        <Swatch color={color} />
        <span className="font-medium">{sideLabel(side)}</span> · {rows.length} repetition{rows.length === 1 ? "" : "s"}
        {peak.value !== null && <> · average {shown(peak.value)}</>}
        {target !== null && <> · target {targetText(target)}</>}
        {!peak.counted && rows.length > 0 && (
          <span className="text-gray-500">
            {" "}
            · not counted by the trend model: fewer than {minUnitsFor(exerciseId, "peak")} repetitions
          </span>
        )}
      </p>
      {tracking.heldOut && (
        <p className="text-[11px] text-amber-700 mt-1">
          This session is left out of the trend lines, drawn hollow where enough well-tracked repetitions remain to plot: the
          camera tracked {tracking.poorReps} of its {tracking.trackedReps} repetitions poorly.
        </p>
      )}
      {tracking.uncheckedReps > 0 && (
        <p className="text-[11px] text-gray-500 mt-1" data-tracking-unchecked="">
          The tracking check could not judge {tracking.uncheckedReps} of this session&apos;s {tracking.trackedReps} repetitions,
          usually because the computer was processing too few frames a second, so their tracking is unknown. They still
          count in the trends.
        </p>
      )}
      {rows.length === 0 ? (
        <p className="text-[11px] text-gray-400 mt-1">No repetitions on this side.</p>
      ) : (
        <>
          <RepStrip rows={rows} average={peak.value} target={target} color={color} main={main} activeRep={activeRep} onPick={setActiveRep} />
          <BreakdownTable
            columns={columns}
            rows={rows}
            rowKey={(r) => r.repIndex}
            focus={focus}
            activeKey={activeRep}
            onPick={setActiveRep}
            caption={[
              "Lowering ÷ raising above 1 means the repetition came down more slowly than it went up.",
              "† Each set's first repetition is left out of the raising and lowering trends, because its timing includes getting into position.",
              neckRestCaption(detail, exerciseId),
              metrics.length > 0
                ? "Compensation columns summarize raw signals: the share of observed repetition time above the configured threshold, and " +
                  "below it the raw peak as a multiple of that threshold (1.00× is at the threshold; hover for the average). " +
                  "These values do not account for expected movement or cue timing and selection. They are not time a cue was shown or time in incorrect form."
                : "",
            ].join(" ")}
          />
          <EndOfSet rows={endOfSetRows(detail, side)} main={main} />
        </>
      )}
    </div>
  );
}

/**
 * Each set's last repetition against its middle ones, for the therapist to read
 * across sessions. Information only, never a judgement of readiness.
 */
function EndOfSet({ rows, main }: { rows: EndOfSetRow[]; main: MainMeasure }) {
  const compared = rows.filter((r) => r.durationRatio !== null || r.peakChange !== null);
  if (compared.length === 0) return null;
  const exact = main.precise ?? main.format;
  const change = (v: number) => `${v >= 0 ? "+" : "−"}${exact(Math.abs(v))}${main.unit}`;
  return (
    <div className="mt-2 text-[11px] text-gray-700" data-end-of-set="">
      <p>
        <span className="font-medium">End of set:</span>{" "}
        {compared.map((r, i) => (
          <span key={r.setIndex}>
            {i > 0 && " · "}
            set {r.setIndex}, the last repetition took{" "}
            {r.durationRatio === null ? "—" : `${r.durationRatio.toFixed(2)}×`} as long as the middle ones
            {r.peakChange !== null && <>, {main.label.charAt(0).toLowerCase() + main.label.slice(1)} {change(r.peakChange)}</>}
          </span>
        ))}
      </p>
      <p className="text-gray-400 mt-0.5">
        Each set&apos;s last repetition against the ones between its first and last (sets with at least 4 repetitions on this
        side; poorly tracked repetitions left out). Information only, not a judgement of readiness: repetitions are paced, so a
        slower last repetition can be the patient&apos;s own choice, and repetitions vary, so compare it across sessions.
      </p>
    </div>
  );
}

/** Each repetition as a dot in the order done, with the target as a dotted line and the average as a dashed one. */
function RepStrip({
  rows,
  average,
  target,
  color,
  main,
  activeRep,
  onPick,
}: {
  rows: RepRow[];
  average: number | null;
  target: number | null;
  color: string;
  main: MainMeasure;
  activeRep: number | null;
  onPick: (repIndex: number) => void;
}) {
  const values = rows.flatMap((r) => (r.peak === null ? [] : [r.peak]));
  if (values.length === 0) return null;
  // Wide and flat, with no text inside: the strip scales with the card, and the
  // average and target are named in the side's heading instead.
  const W = 600;
  const H = 60;
  const M = { top: 8, right: 8, bottom: 8, left: 8 };
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  let lo = Math.min(...values, ...(target === null ? [] : [target]));
  let hi = Math.max(...values, ...(target === null ? [] : [target]));
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const xAt = (i: number) => M.left + (rows.length === 1 ? plotW / 2 : (i / (rows.length - 1)) * plotW);
  const yAt = (v: number) => M.top + plotH - ((v - lo) / (hi - lo)) * plotH;
  const shown = (v: number) => `${(main.precise ?? main.format)(v)}${main.unit}`;
  const described = `${rows.length} repetition${rows.length === 1 ? "" : "s"}${
    average === null ? "" : `, average ${shown(average)}`
  }${target === null ? "" : `, target ${shown(target)}`}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto mt-1" role="img" aria-label={described}>
      <line x1={M.left} y1={M.top} x2={W - M.right} y2={M.top} stroke="#e5e7eb" strokeWidth={1} />
      <line x1={M.left} y1={M.top + plotH} x2={W - M.right} y2={M.top + plotH} stroke="#e5e7eb" strokeWidth={1} />
      {rows.map((r, i) =>
        i > 0 && r.setIndex !== rows[i - 1].setIndex ? (
          <line
            key={`set-${i}`}
            x1={(xAt(i - 1) + xAt(i)) / 2}
            y1={M.top}
            x2={(xAt(i - 1) + xAt(i)) / 2}
            y2={M.top + plotH}
            stroke="#d1d5db"
            strokeWidth={1}
            strokeDasharray="2 2"
          />
        ) : null,
      )}
      {target !== null && (
        <line
          data-target={target}
          x1={M.left}
          y1={yAt(target)}
          x2={W - M.right}
          y2={yAt(target)}
          stroke="#6b7280"
          strokeWidth={1}
          strokeDasharray="1 3"
        />
      )}
      {average !== null && (
        <line
          data-average={average}
          x1={M.left}
          y1={yAt(average)}
          x2={W - M.right}
          y2={yAt(average)}
          stroke={color}
          strokeWidth={1.25}
          strokeDasharray="4 3"
        />
      )}
      {rows.map((r, i) =>
        r.peak === null ? null : (
          <circle
            key={r.repIndex}
            data-rep={r.repIndex}
            cx={xAt(i)}
            cy={yAt(r.peak)}
            r={activeRep === r.repIndex ? 5.5 : 3.5}
            fill={r.complete ? color : "#ffffff"}
            stroke={activeRep === r.repIndex ? "#111827" : color}
            strokeWidth={1.5}
            tabIndex={0}
            style={{ cursor: "pointer", outline: "none" }}
            onClick={() => onPick(r.repIndex)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onPick(r.repIndex);
              }
            }}
          >
            <title>
              {`Repetition ${i + 1} (set ${r.setIndex}): ${shown(r.peak)}${r.complete ? "" : ", did not reach the target range"}`}
            </title>
          </circle>
        ),
      )}
    </svg>
  );
}

function HoldSide({
  detail,
  side,
  color,
  exerciseId,
  focus,
}: {
  detail: SessionRepsDetail;
  side: Side;
  color: string;
  exerciseId: string;
  focus: BreakdownFocus;
}) {
  const rows = holdRows(detail, side);
  const point = (measure: TrendMeasureName) => chartPoint(detail, exerciseId, measure, side);
  const inBand = point("inBandPct");
  const steadiness = point("holdSteadiness");
  const distance = point("holdError");
  const drift = point("holdDroop");
  const sum = (values: (number | null)[]) => {
    const present = values.filter(finite);
    return present.length ? present.reduce((a, b) => a + b, 0) : null;
  };
  const seconds = (ms: number | null) => (ms === null ? "—" : (ms / 1000).toFixed(1));
  type Row = (typeof rows)[number];
  const columns: Column<Row>[] = [
    { key: "set", header: "Set", focus: [], cell: (r) => r.setIndex, total: "Chart point" },
    {
      key: "inBand",
      header: "In the target band (s)",
      focus: [],
      cell: (r) => seconds(r.inBandMs),
      total: <span className="font-normal text-gray-500">{seconds(sum(rows.map((r) => r.inBandMs)))} in all</span>,
    },
    {
      key: "target",
      header: "Prescribed (s)",
      focus: [],
      cell: (r) => seconds(r.targetMs),
      total: <span className="font-normal text-gray-500">{seconds(sum(rows.map((r) => r.targetMs)))} in all</span>,
    },
    {
      key: "share",
      header: "In band, % of prescribed",
      focus: ["inBandPct"],
      cell: (r) => {
        const share = r.inBandMs !== null && r.targetMs ? (100 * r.inBandMs) / r.targetMs : null;
        return (
          <>
            {fixed(share, 0, "%")}
            {share !== null && (
              <span className="mt-0.5 block h-1 rounded bg-gray-200">
                <span className="block h-1 rounded" style={{ width: `${Math.min(100, share)}%`, backgroundColor: color }} />
              </span>
            )}
          </>
        );
      },
      total: <Point text={fixed(inBand.value, 0, "%")} counted={inBand.counted} />,
    },
    {
      key: "steadiness",
      header: `Spread of the ${ANGLE_ESTIMATE_LABEL}`,
      focus: ["holdSteadiness"],
      cell: (r) => fixed(r.steadiness, 1),
      total: <Point text={fixed(steadiness.value, 1)} counted={steadiness.counted} />,
    },
    {
      key: "distance",
      header: `Distance from the target ${ANGLE_ESTIMATE_LABEL}`,
      focus: ["holdError"],
      cell: (r) => fixed(r.distance, 1),
      total: <Point text={fixed(distance.value, 1)} counted={distance.counted} />,
    },
    {
      key: "drift",
      header: `Drift of the ${ANGLE_ESTIMATE_LABEL} per second`,
      focus: ["holdDroop"],
      cell: (r) => fixed(r.drift, 2),
      total: <Point text={fixed(drift.value, 2)} counted={drift.counted} />,
    },
  ];
  return (
    <div className="min-w-0">
      <p className="text-xs text-gray-700">
        <Swatch color={color} />
        <span className="font-medium">{sideLabel(side)}</span> · {rows.length} set{rows.length === 1 ? "" : "s"}
      </p>
      {rows.length === 0 ? (
        <p className="text-[11px] text-gray-400 mt-1">No sets recorded.</p>
      ) : (
        <BreakdownTable columns={columns} rows={rows} rowKey={(r) => r.setIndex} focus={focus} />
      )}
    </div>
  );
}

/**
 * What a hold records for the hold as a whole, one row per set: its form score,
 * and how it reached and stayed in the band.
 */
function HoldWhole({ detail, exerciseId, focus }: { detail: SessionRepsDetail; exerciseId: string; focus: BreakdownFocus }) {
  const rows = holdRows(detail, "left");
  if (rows.length === 0) return null;
  const form = chartPoint(detail, exerciseId, "holdFormScore", "card");
  const secs = (ms: number | null) => (ms === null ? "—" : (ms / 1000).toFixed(1));
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
  const settles = rows.map((r) => r.settleMs).filter(finite);
  const drops = rows.map((r) => r.dropCount).filter(finite);
  const longest = rows.map((r) => r.longestInBandMs).filter(finite);
  const outOfBand = rows.map((r) => r.outOfBandMs).filter(finite);
  const lowest = rows.map((r) => r.minFormScore).filter(finite);
  const plain = (text: string) => <span className="font-normal text-gray-500">{text}</span>;
  type Row = (typeof rows)[number];
  const columns: Column<Row>[] = [
    { key: "set", header: "Set", focus: [], cell: (r) => r.setIndex, total: "Chart point" },
    {
      key: "settle",
      header: "Reached the band after (s)",
      focus: [],
      cell: (r) => secs(r.settleMs),
      total: plain(settles.length ? `average ${secs(sum(settles) / settles.length)}` : "—"),
    },
    {
      key: "drops",
      header: "Drops out of the band",
      focus: [],
      cell: (r) => (r.dropCount === null ? "—" : r.dropCount),
      total: plain(drops.length ? `${sum(drops)} in all` : "—"),
    },
    {
      key: "longest",
      header: "Longest unbroken time in the band (s)",
      focus: [],
      cell: (r) => secs(r.longestInBandMs),
      total: plain(longest.length ? `longest ${secs(Math.max(...longest))}` : "—"),
    },
    {
      key: "outOfBand",
      header: "Time out of the band (s)",
      focus: [],
      cell: (r) => secs(r.outOfBandMs),
      total: plain(outOfBand.length ? `${secs(sum(outOfBand))} in all` : "—"),
    },
    {
      key: "form",
      header: "Form score (rule-based)",
      focus: ["holdFormScore"],
      cell: (r) => fixed(r.formScore, 0),
      total: <Point text={fixed(form.value, 0)} counted={form.counted} />,
    },
    {
      key: "lowest",
      header: "Lowest form score",
      focus: [],
      cell: (r) => fixed(r.minFormScore, 0),
      total: plain(lowest.length ? `lowest ${Math.min(...lowest).toFixed(0)}` : "—"),
    },
  ];
  return (
    <div className="min-w-0">
      <p className="text-xs text-gray-700 font-medium">The hold as a whole</p>
      <BreakdownTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.setIndex}
        focus={focus}
        caption="Counted for the hold as a whole rather than per side."
      />
    </div>
  );
}
