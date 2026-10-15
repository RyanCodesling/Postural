"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useDemoClock } from "@/lib/DemoClockContext";
import { heldOutSessionCount, prepareGroupModelSeries } from "@/lib/analytics/trendSeries";
import { groupSessionsByExercise, primaryMetricMeta, type TrendSession } from "./ExerciseTrends";
import ConsistencyCalendar from "../patient/ConsistencyCalendar";
import type { OccurrenceStatus } from "@/lib/exercises/occurrences";

type RangeKey = "week" | "month" | "all";

const DAY_MS = 86_400_000;
const LEFT = "#16a34a";
const RIGHT = "#0f766e";

interface ReportOccurrence {
  due_date: string;
  makeup_until: string;
  status: OccurrenceStatus;
}

function dayKey(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
}

function shiftDay(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10);
}

function shortLabel(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function Card({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl bg-white p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-gray-900">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

function Legend() {
  return (
    <div className="flex items-center gap-3 text-xs text-gray-600">
      <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full" style={{ background: LEFT }} />Left</span>
      <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full" style={{ background: RIGHT }} />Right</span>
    </div>
  );
}

interface Point {
  label: string;
  left: number | null;
  right: number | null;
  /** A session the trend data rules leave out: drawn hollow, off the line, with why. */
  leftHeld?: number | null;
  rightHeld?: number | null;
  heldReason?: string | null;
}

function niceMax(value: number): number {
  if (value <= 0) return 10;
  const step = Math.pow(10, Math.floor(Math.log10(value)));
  return Math.ceil(value / step) * step;
}

function LineChart({ points, format }: { points: Point[]; format: (value: number) => string }) {
  const W = 480;
  const H = 220;
  const pad = { l: 34, r: 12, t: 12, b: 26 };
  const values = points
    .flatMap((p) => [p.left, p.right, p.leftHeld ?? null, p.rightHeld ?? null])
    .filter((v): v is number => v != null);
  const top = niceMax(Math.max(...values, 1));
  const x = (i: number) =>
    pad.l + (points.length === 1 ? (W - pad.l - pad.r) / 2 : (i * (W - pad.l - pad.r)) / (points.length - 1));
  const y = (v: number) => pad.t + (1 - v / top) * (H - pad.t - pad.b);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * top);
  const every = Math.max(1, Math.ceil(points.length / 7));

  const path = (pick: (p: Point) => number | null) => {
    let d = "";
    points.forEach((p, i) => {
      const v = pick(p);
      if (v != null) d += `${d ? "L" : "M"} ${x(i)} ${y(v)} `;
    });
    return d;
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Range of motion by session">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#e5efe7" />
          <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" fontSize="9" fill="#6b7280">{format(t)}</text>
        </g>
      ))}
      <path d={path((p) => p.left)} fill="none" stroke={LEFT} strokeWidth="2" />
      <path d={path((p) => p.right)} fill="none" stroke={RIGHT} strokeWidth="2" strokeDasharray="5 3" />
      {points.map((p, i) => (
        <g key={`${p.label}-${i}`}>
          {p.left != null && <circle cx={x(i)} cy={y(p.left)} r="4" fill="#fff" stroke={LEFT} strokeWidth="2" />}
          {p.right != null && <circle cx={x(i)} cy={y(p.right)} r="4" fill="#fff" stroke={RIGHT} strokeWidth="2" />}
          {[
            { v: p.leftHeld, color: LEFT, side: "Left" },
            { v: p.rightHeld, color: RIGHT, side: "Right" },
          ].map(({ v, color, side }) =>
            v == null ? null : (
              <circle key={side} cx={x(i)} cy={y(v)} r="4" fill="#fff" stroke={color} strokeWidth="1.5" strokeDasharray="2 2" data-held-out="">
                <title>{`${side} ${format(v)}: left out because ${p.heldReason}`}</title>
              </circle>
            ),
          )}
          {i % every === 0 && (
            <text x={x(i)} y={H - 8} textAnchor="middle" fontSize="9" fill="#6b7280">{p.label}</text>
          )}
        </g>
      ))}
    </svg>
  );
}

function BarChart({ points }: { points: Point[] }) {
  const W = 480;
  const H = 220;
  const pad = { l: 30, r: 8, t: 16, b: 26 };
  const values = points.flatMap((p) => [p.left, p.right]).filter((v): v is number => v != null);
  const top = niceMax(Math.max(...values, 1));
  const slot = (W - pad.l - pad.r) / points.length;
  const bar = Math.min(18, slot / 2 - 3);
  const y = (v: number) => pad.t + (1 - v / top) * (H - pad.t - pad.b);
  const base = y(0);
  const every = Math.max(1, Math.ceil(points.length / 7));
  const showValues = points.length <= 8;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Repetitions by session">
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={pad.l} x2={W - pad.r} y1={y(f * top)} y2={y(f * top)} stroke="#e5efe7" />
          <text x={pad.l - 6} y={y(f * top) + 3} textAnchor="end" fontSize="9" fill="#6b7280">{Math.round(f * top)}</text>
        </g>
      ))}
      {points.map((p, i) => {
        const cx = pad.l + slot * i + slot / 2;
        return (
          <g key={`${p.label}-${i}`}>
            {[
              { v: p.left, dx: -bar / 2 - 1, color: LEFT, tag: "L" },
              { v: p.right, dx: bar / 2 + 1, color: RIGHT, tag: "R" },
            ].map(({ v, dx, color, tag }) =>
              v == null ? null : (
                <g key={tag}>
                  <rect x={cx + dx - bar / 2} y={y(v)} width={bar} height={Math.max(base - y(v), 1)} rx="3" fill={color} />
                  {showValues && (
                    <text x={cx + dx} y={y(v) - 3} textAnchor="middle" fontSize="8" fill="#374151">{v}</text>
                  )}
                  {bar >= 12 && base - y(v) > 14 && (
                    <text x={cx + dx} y={base - 4} textAnchor="middle" fontSize="7" fontWeight="700" fill="#fff">{tag}</text>
                  )}
                </g>
              ),
            )}
            {i % every === 0 && (
              <text x={cx} y={H - 8} textAnchor="middle" fontSize="9" fill="#6b7280">{p.label}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/**
 * The Reports tab of a patient profile: a range-of-motion line chart, a
 * repetitions bar chart and the adherence calendar for one exercise over a
 * chosen date range. Values are the camera's estimates.
 */
export default function PatientReports({
  sessions,
  occurrences,
}: {
  sessions: TrendSession[];
  occurrences: ReportOccurrence[];
}) {
  const { todayKey } = useDemoClock();
  const [range, setRange] = useState<RangeKey>("month");
  const groups = useMemo(() => groupSessionsByExercise(sessions), [sessions]);
  const [selected, setSelected] = useState<string | null>(null);
  const group = groups.find((g) => g.contextKey === selected) ?? groups[0];

  const from = range === "week" ? shiftDay(todayKey, -6) : range === "month" ? shiftDay(todayKey, -29) : null;
  const inRange = (group?.sessions ?? []).filter((s) => {
    const day = dayKey(s.startedAt);
    return (from === null || day >= from) && day <= todayKey;
  });

  const isIsometric = group?.exerciseKind === "isometric";
  const meta = group ? primaryMetricMeta(group.exerciseKind, group.primaryMetric) : null;
  // The shoulder press's normalized readings keep two decimals; angles and seconds are whole numbers.
  const format = !isIsometric && meta && !meta.isAngle ? (v: number) => v.toFixed(2) : (v: number) => String(Math.round(v));
  // Peaks follow the trend data rules, as on the trend cards: a poorly tracked
  // repetition counts nowhere, a side needs enough repetitions to plot, and a
  // poorly tracked session is drawn hollow, off the line.
  const series = group && !isIsometric
    ? prepareGroupModelSeries(group.exerciseId, group.prescribedSide, inRange, "peak", true)
    : [];
  const leftSeries = series.find((s) => s.side === "left");
  const rightSeries = series.find((s) => s.side === "right");
  const romPoints: Point[] = inRange.map((s, i) =>
    isIsometric
      ? {
          label: shortLabel(dayKey(s.startedAt)),
          left: (s.totalLeftHoldMs ?? s.totalPairedHoldMs ?? null) != null ? Math.round((s.totalLeftHoldMs ?? s.totalPairedHoldMs ?? 0) / 1000) : null,
          right: (s.totalRightHoldMs ?? null) != null ? Math.round((s.totalRightHoldMs ?? 0) / 1000) : null,
        }
      : {
          label: shortLabel(dayKey(s.startedAt)),
          left: leftSeries?.values[i] ?? null,
          right: rightSeries?.values[i] ?? null,
          leftHeld: leftSeries?.heldOut[i]?.value ?? null,
          rightHeld: rightSeries?.heldOut[i]?.value ?? null,
          heldReason: leftSeries?.heldOut[i]?.reason ?? rightSeries?.heldOut[i]?.reason ?? null,
        },
  );
  const leftOut = isIsometric ? 0 : heldOutSessionCount(inRange);
  const repPoints: Point[] = inRange.map((s) => ({
    label: shortLabel(dayKey(s.startedAt)),
    left: s.leftReps ?? s.completeLeftReps ?? null,
    right: s.rightReps ?? s.completeRightReps ?? null,
  }));
  const hasReps = repPoints.some((p) => (p.left ?? 0) > 0 || (p.right ?? 0) > 0);

  const buttons: Array<{ key: RangeKey; label: string }> = [
    { key: "week", label: "Prior Week" },
    { key: "month", label: "Prior Month" },
    { key: "all", label: "All" },
  ];
  const rangeText = from ? `${shortLabel(from)} – ${shortLabel(todayKey)}` : "All sessions";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {groups.length > 0 ? (
          <select
            value={group?.contextKey}
            onChange={(event) => setSelected(event.target.value)}
            aria-label="Exercise"
            className="max-w-full rounded-lg border border-green-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 outline-none focus:border-green-500"
          >
            {groups.map((g) => (
              <option key={g.contextKey} value={g.contextKey}>
                {g.exerciseName} · {g.prescribedSide}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-sm text-gray-500">No recorded sessions yet.</span>
        )}
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <span className="rounded-lg bg-green-600 px-3 py-2 text-xs font-medium text-white">{rangeText}</span>
          {buttons.map((b) => (
            <button
              key={b.key}
              type="button"
              onClick={() => setRange(b.key)}
              aria-pressed={range === b.key}
              className={`rounded-lg px-3 py-2 text-xs font-medium transition ${
                range === b.key ? "bg-green-100 text-green-800" : "bg-[#eef4ef] text-gray-600 hover:bg-green-50"
              }`}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card title={isIsometric ? "Hold Time" : "Range of Motion"} right={<Legend />}>
          {romPoints.length === 0 ? (
            <p className="py-10 text-center text-sm text-gray-400">No sessions in this range.</p>
          ) : (
            <>
              <LineChart points={romPoints} format={format} />
              <p className="mt-1 text-[11px] text-gray-400">
                {isIsometric
                  ? "Seconds held per side."
                  : `${meta?.label ?? "Peak"} per session, without poorly tracked repetitions. Camera estimates, not clinical measurements.`}
              </p>
              {leftOut > 0 && (
                <p className="mt-1 text-[11px] leading-4 text-amber-700" data-held-out-note="">
                  {leftOut} session{leftOut === 1 ? " is" : "s are"} left out of the lines because the camera tracked half or
                  more of {leftOut === 1 ? "its" : "their"} repetitions poorly. {leftOut === 1 ? "It shows" : "They show"} as
                  dashed hollow points where enough well-tracked repetitions remain to plot.
                </p>
              )}
            </>
          )}
        </Card>

        <Card title="Program Adherence">
          <ConsistencyCalendar sessions={sessions} occurrences={occurrences} embedded />
        </Card>

        <Card title="Repetitions" right={<Legend />}>
          {!hasReps ? (
            <p className="py-10 text-center text-sm text-gray-400">
              {isIsometric ? "Hold exercises count seconds, not repetitions." : "No repetitions in this range."}
            </p>
          ) : (
            <BarChart points={repPoints} />
          )}
        </Card>

        <Card title="Sessions in Range">
          {inRange.length === 0 ? (
            <p className="py-10 text-center text-sm text-gray-400">No sessions in this range.</p>
          ) : (
            <dl className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-lg bg-[#f3f8f4] p-3">
                <dt className="text-xs text-gray-500">Sessions</dt>
                <dd className="text-2xl font-bold text-green-700">{inRange.length}</dd>
              </div>
              <div className="rounded-lg bg-[#f3f8f4] p-3">
                <dt className="text-xs text-gray-500">Total reps</dt>
                <dd className="text-2xl font-bold text-green-700">{inRange.reduce((n, s) => n + s.totalReps, 0)}</dd>
              </div>
              <div className="rounded-lg bg-[#f3f8f4] p-3">
                <dt className="text-xs text-gray-500">Sets</dt>
                <dd className="text-2xl font-bold text-green-700">{inRange.reduce((n, s) => n + s.setCount, 0)}</dd>
              </div>
            </dl>
          )}
        </Card>
      </div>
    </div>
  );
}
