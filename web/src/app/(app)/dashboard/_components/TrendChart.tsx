"use client";

// Small hand-rolled SVG line chart (no charting dependency — consistent with the
// rest of the UI's hand-rolled SVG). Plots one or two numeric series sharing a
// y-range; used for the per-exercise progress trends. Values are ordered
// oldest → newest. Hovering, tapping or focusing a point shows the details the
// caller supplies for that point, with a native <title> as the fallback.

import { useState } from "react";

export interface TrendSeries {
  label: string;
  color: string; // CSS color for the line + dots
  values: number[];
  /** Optional one-line detail per value, same order, shown on hover. */
  pointDetails?: string[];
}

function fmtNum(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

export default function TrendChart({
  series,
  unitSuffix = "",
  height = 130,
  pointTitles,
}: {
  series: TrendSeries[];
  unitSuffix?: string;
  height?: number;
  /** Optional heading per point index (e.g. the session date). */
  pointTitles?: string[];
}) {
  const [active, setActive] = useState<number | null>(null);
  const VBW = 320;
  const VBH = height;
  const M = { top: 12, right: 12, bottom: 12, left: 12 };
  const plotW = VBW - M.left - M.right;
  const plotH = VBH - M.top - M.bottom;

  const allValues = series.flatMap((s) => s.values);
  const n = Math.max(0, ...series.map((s) => s.values.length));

  if (allValues.length === 0 || n === 0) {
    return <p className="text-xs text-gray-400 py-4 text-center">No data to chart.</p>;
  }

  const dataMin = Math.min(...allValues);
  const dataMax = Math.max(...allValues);
  // Pad a flat series so its line sits mid-plot instead of on an edge.
  let lo = dataMin;
  let hi = dataMax;
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const range = hi - lo;

  // Single point → center it; otherwise spread indices across the plot width.
  const xAt = (i: number) =>
    M.left + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yAt = (v: number) => M.top + plotH - ((v - lo) / range) * plotH;

  // The details for one point index: its heading, then one line per series.
  const detailsAt = (i: number) => ({
    title: pointTitles?.[i],
    lines: series.flatMap((s) =>
      i < s.values.length
        ? [{ color: s.color, text: s.pointDetails?.[i] ?? `${s.label}: ${fmtNum(s.values[i])}${unitSuffix}` }]
        : [],
    ),
  });
  // Each index owns the band halfway to its neighbours, so hovering anywhere
  // near a session selects it — the dots alone are too small to aim at.
  const bandLeft = (i: number) => (i === 0 ? M.left : (xAt(i - 1) + xAt(i)) / 2);
  const bandRight = (i: number) => (i === n - 1 ? VBW - M.right : (xAt(i) + xAt(i + 1)) / 2);

  const shown = active === null ? null : detailsAt(active);
  const shownTop =
    active === null
      ? 0
      : Math.min(...series.flatMap((s) => (active < s.values.length ? [yAt(s.values[active])] : [])));

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
          {active !== null && (
            <line x1={xAt(active)} y1={M.top} x2={xAt(active)} y2={M.top + plotH} stroke="#d1d5db" strokeWidth={1} />
          )}
          {series.map((s) => (
            <g key={s.label}>
              {s.values.length > 1 && (
                <polyline
                  points={s.values.map((v, i) => `${xAt(i)},${yAt(v)}`).join(" ")}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              )}
              {s.values.map((v, i) => (
                <circle key={i} cx={xAt(i)} cy={yAt(v)} r={i === active ? 4.5 : 2.5} fill={s.color} />
              ))}
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
                onClick={() => setActive((a) => (a === i ? null : i))}
              >
                <title>{[d.title, ...d.lines.map((l) => l.text)].filter(Boolean).join("\n")}</title>
              </rect>
            );
          })}
        </svg>

        {active !== null && shown && (
          <div
            role="tooltip"
            className="pointer-events-none absolute z-10 whitespace-nowrap rounded-md bg-gray-900/90 px-2 py-1 text-[11px] leading-4 text-white shadow"
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
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-xs text-gray-500">
        {series.map((s) => {
          const latest = s.values[s.values.length - 1];
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
