"use client";

// Small hand-rolled SVG line chart (no charting dependency — consistent with the
// rest of the UI's hand-rolled SVG). Plots one or two numeric series sharing a
// y-range; used for the per-exercise progress trends. Values are ordered
// oldest → newest.

export interface TrendSeries {
  label: string;
  color: string; // CSS color for the line + dots
  values: number[];
}

function fmtNum(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

export default function TrendChart({
  series,
  unitSuffix = "",
  height = 130,
}: {
  series: TrendSeries[];
  unitSuffix?: string;
  height?: number;
}) {
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

  return (
    <div>
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
              <circle key={i} cx={xAt(i)} cy={yAt(v)} r={2.5} fill={s.color} />
            ))}
          </g>
        ))}
      </svg>

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
