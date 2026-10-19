"use client";

// Small hand-rolled SVG line chart (no charting dependency — consistent with the
// rest of the UI's hand-rolled SVG). Plots one or two numeric series sharing a
// y-range; used for the per-exercise progress trends. Values are ordered
// oldest → newest; a null value is a session that does not count for that
// series and is skipped. A series may carry the trend model's band (estimated
// level and 95 % range), drawn behind its points. Hovering, tapping or
// focusing a point shows the details the caller supplies for that point, with a
// native <title> as the fallback. A caller can also take a clicked point (or one
// chosen with Enter or Space) and keep it marked.

import { useState } from "react";

export interface TrendBand {
  mean: (number | null)[];
  low: (number | null)[];
  high: (number | null)[];
}

export interface TrendSeries {
  label: string;
  color: string; // CSS color for the line + dots
  values: (number | null)[];
  /** Optional one-line detail per value, same order, shown on hover. */
  pointDetails?: (string | null)[];
  /** Optional model band, same order as `values`. */
  band?: TrendBand;
  /**
   * Optional sessions drawn hollow, not joined by the line: measured but left
   * out of the trend (same order as `values`; the reason goes in `pointDetails`).
   */
  heldOut?: (number | null)[];
}

function fmtNum(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/**
 * Value-axis ticks inside [lo, hi] at a round step (1, 2 or 5 times a power of
 * ten, about `target` steps across), with the decimals that step needs. Counts
 * pass `minStep` 1 so they never get fractional ticks.
 */
export function axisTicks(lo: number, hi: number, target = 3, minStep = 0): { values: number[]; decimals: number } {
  if (!(hi > lo)) return { values: [lo], decimals: 0 };
  const raw = (hi - lo) / target;
  const power = 10 ** Math.floor(Math.log10(raw));
  const base = raw / power;
  const step = Math.max(minStep, (base <= 1 ? 1 : base <= 2 ? 2 : base <= 5 ? 5 : 10) * power);
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  const values: number[] = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step) {
    values.push(Number(v.toFixed(decimals)));
  }
  return { values, decimals };
}

const isNum = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

export default function TrendChart({
  series,
  unitSuffix = "",
  height = 130,
  pointTitles,
  pointDates,
  onSelect,
  selected = null,
  counts = false,
}: {
  series: TrendSeries[];
  unitSuffix?: string;
  height?: number;
  /** Optional heading per point index (e.g. the session date). */
  pointTitles?: string[];
  /** Optional short date per point index; the first and last label the time axis. */
  pointDates?: string[];
  /** Called with a point's index when it is clicked or chosen with Enter or Space. */
  onSelect?: (index: number) => void;
  /** A point index to keep marked, e.g. the session whose breakdown is open. */
  selected?: number | null;
  /** The values are counts, so the value axis uses whole numbers. */
  counts?: boolean;
}) {
  const [active, setActive] = useState<number | null>(null);
  const VBW = 320;
  const VBH = height;
  // Room on the left for the value axis and, with dates, below for the time axis.
  const M = { top: 10, right: 10, bottom: pointDates ? 20 : 10, left: 30 };
  const plotW = VBW - M.left - M.right;
  const plotH = VBH - M.top - M.bottom;

  const allValues = series.flatMap((s) => [...s.values, ...(s.heldOut ?? [])].filter(isNum));
  const bandValues = series.flatMap((s) => (s.band ? [...s.band.low, ...s.band.high].filter(isNum) : []));
  const n = Math.max(0, ...series.map((s) => s.values.length));

  if (allValues.length === 0 || n === 0) {
    return <p className="text-sm text-gray-400 py-4 text-center">No data to chart.</p>;
  }

  const dataMin = Math.min(...allValues);
  const dataMax = Math.max(...allValues);
  // The plot range also holds the bands; pad a flat series so its line sits mid-plot.
  let lo = Math.min(dataMin, ...bandValues);
  let hi = Math.max(dataMax, ...bandValues);
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const range = hi - lo;
  const ticks = axisTicks(lo, hi, 3, counts ? 1 : 0);
  const axisUnit = unitSuffix.trim();

  // Single point → center it; otherwise spread indices across the plot width.
  const xAt = (i: number) =>
    M.left + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yAt = (v: number) => M.top + plotH - ((v - lo) / range) * plotH;

  // The details for one point index: its heading, then one line per series with a value there.
  const detailsAt = (i: number) => ({
    title: pointTitles?.[i],
    lines: series.flatMap((s) => {
      const v = isNum(s.values[i]) ? s.values[i] : s.heldOut?.[i];
      return isNum(v)
        ? [{ color: s.color, text: s.pointDetails?.[i] ?? `${s.label}: ${fmtNum(v)}${unitSuffix}` }]
        : [];
    }),
  });
  const valueAt = (s: TrendSeries, i: number) => (isNum(s.values[i]) ? s.values[i] : s.heldOut?.[i]);
  // Each index owns the band halfway to its neighbours, so hovering anywhere
  // near a session selects it — the dots alone are too small to aim at.
  const bandLeft = (i: number) => (i === 0 ? M.left : (xAt(i - 1) + xAt(i)) / 2);
  const bandRight = (i: number) => (i === n - 1 ? VBW - M.right : (xAt(i) + xAt(i + 1)) / 2);

  const shown = active === null ? null : detailsAt(active);
  const activeYs = active === null ? [] : series.flatMap((s) => {
    const v = valueAt(s, active);
    return isNum(v) ? [yAt(v)] : [];
  });
  const shownTop = activeYs.length ? Math.min(...activeYs) : M.top + plotH / 2;

  const points = (values: (number | null)[]) =>
    values.flatMap((v, i) => (isNum(v) ? [`${xAt(i)},${yAt(v)}`] : [])).join(" ");

  return (
    <div>
      <div className="relative">
        <svg viewBox={`0 0 ${VBW} ${VBH}`} className="w-full h-auto" role="img" aria-label="trend chart">
          {/* faint top/bottom guide lines (max / min) */}
          <line x1={M.left} y1={M.top} x2={VBW - M.right} y2={M.top} stroke="#e5e7eb" strokeWidth={1} />
          <line
            x1={M.left}
            y1={M.top + plotH}
            x2={VBW - M.right}
            y2={M.top + plotH}
            stroke="#e5e7eb"
            strokeWidth={1}
          />
          {ticks.values.map((v) => (
            <g key={`tick-${v}`} data-tick={v}>
              <line x1={M.left} y1={yAt(v)} x2={VBW - M.right} y2={yAt(v)} stroke="#f3f4f6" strokeWidth={1} />
              <text x={M.left - 4} y={yAt(v) + 3} textAnchor="end" fontSize={10} fill="#9ca3af">
                {v.toFixed(ticks.decimals)}
                {axisUnit}
              </text>
            </g>
          ))}
          {pointDates && pointDates.length > 0 && (
            <g data-dates="">
              <text x={xAt(0)} y={VBH - 5} textAnchor={n === 1 ? "middle" : "start"} fontSize={10} fill="#9ca3af">
                {pointDates[0]}
              </text>
              {n > 1 && (
                <text x={xAt(n - 1)} y={VBH - 5} textAnchor="end" fontSize={10} fill="#9ca3af">
                  {pointDates[n - 1]}
                </text>
              )}
            </g>
          )}
          {selected !== null && selected < n && (
            <line
              data-selected={selected}
              x1={xAt(selected)}
              y1={M.top}
              x2={xAt(selected)}
              y2={M.top + plotH}
              stroke="#15803d"
              strokeOpacity={0.5}
              strokeWidth={1.5}
              strokeDasharray="3 2"
            />
          )}
          {active !== null && active !== selected && (
            <line x1={xAt(active)} y1={M.top} x2={xAt(active)} y2={M.top + plotH} stroke="#d1d5db" strokeWidth={1} />
          )}
          {/* Model bands first, so the measured points sit on top. */}
          {series.map((s) => {
            if (!s.band) return null;
            const idx = s.band.mean.flatMap((m, i) => (isNum(m) && isNum(s.band!.low[i]) && isNum(s.band!.high[i]) ? [i] : []));
            if (idx.length < 2) return null;
            const upper = idx.map((i) => `${xAt(i)},${yAt(s.band!.high[i] as number)}`);
            const lower = [...idx].reverse().map((i) => `${xAt(i)},${yAt(s.band!.low[i] as number)}`);
            return (
              <g key={`band-${s.label}`} data-band={s.label}>
                <polygon points={[...upper, ...lower].join(" ")} fill={s.color} fillOpacity={0.12} stroke="none" />
                <polyline
                  points={points(s.band.mean)}
                  fill="none"
                  stroke={s.color}
                  strokeOpacity={0.55}
                  strokeWidth={1.25}
                  strokeDasharray="4 3"
                />
              </g>
            );
          })}
          {series.map((s) => (
            <g key={s.label}>
              {s.values.filter(isNum).length > 1 && (
                <polyline
                  points={points(s.values)}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              )}
              {s.values.map((v, i) =>
                isNum(v) ? <circle key={i} cx={xAt(i)} cy={yAt(v)} r={i === active || i === selected ? 4.5 : 2.5} fill={s.color} /> : null,
              )}
              {s.heldOut?.map((v, i) =>
                isNum(v) ? (
                  <circle key={`held-${i}`} data-held-out={i} cx={xAt(i)} cy={yAt(v)} r={i === active || i === selected ? 4.5 : 2.8}
                    fill="white" stroke={s.color} strokeWidth={1.5} />
                ) : null,
              )}
            </g>
          ))}
          {/* Hover, tap and keyboard targets, drawn last so they sit on top. */}
          {Array.from({ length: n }, (_, i) => {
            const d = detailsAt(i);
            const label = [d.title, ...d.lines.map((l) => l.text)].filter(Boolean).join(", ");
            return (
              <rect
                key={i}
                data-point={i}
                x={bandLeft(i)}
                y={0}
                width={Math.max(1, bandRight(i) - bandLeft(i))}
                height={VBH}
                fill="transparent"
                tabIndex={0}
                aria-label={label}
                style={{ cursor: "pointer", outline: "none" }}
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                onClick={() => {
                  setActive((a) => (a === i ? null : i));
                  onSelect?.(i);
                }}
                onKeyDown={(e) => {
                  if (onSelect && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    onSelect(i);
                  }
                }}
              >
                <title>{[d.title, ...d.lines.map((l) => l.text)].filter(Boolean).join("\n")}</title>
              </rect>
            );
          })}
        </svg>

        {active !== null && shown && (
          <div
            role="tooltip"
            className="pointer-events-none absolute z-10 whitespace-nowrap rounded-md bg-gray-900/90 px-2 py-1 text-[13px] leading-4 text-white shadow"
            style={{
              left: `${(xAt(active) / VBW) * 100}%`,
              top: `${(shownTop / VBH) * 100}%`,
              // Keep the box inside the card near the edges; drop it below the
              // point when the point sits near the top of the plot.
              transform: `translate(${xAt(active) > VBW * 0.66 ? "-100%" : xAt(active) < VBW * 0.33 ? "0%" : "-50%"}, ${
                shownTop < VBH * 0.4 ? "10px" : "calc(-100% - 10px)"
              })`,
            }}
          >
            {shown.title && <div className="font-semibold">{shown.title}</div>}
            {shown.lines.length === 0 && <div>Not counted for this chart</div>}
            {shown.lines.map((line, k) => (
              <div key={k} className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: line.color }} />
                {line.text}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Legend + latest value(s), with the data min/max for scale. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-sm text-gray-500">
        {series.map((s) => {
          const present = s.values.filter(isNum);
          if (present.length === 0) return null;
          const latest = present[present.length - 1];
          return (
            <span key={s.label} className="flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
              {s.label}:{" "}
              <span className="font-semibold text-gray-700">
                {fmtNum(latest)}
                {unitSuffix}
              </span>
            </span>
          );
        })}
        <span className="ml-auto text-gray-400">
          min {fmtNum(dataMin)}
          {unitSuffix} · max {fmtNum(dataMax)}
          {unitSuffix}
        </span>
      </div>
    </div>
  );
}
