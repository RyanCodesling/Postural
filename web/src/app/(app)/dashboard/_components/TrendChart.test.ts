/**
 * Trend chart hover details: every plotted session gets a hover/tap/focus
 * target carrying its details, the native <title> fallback holds the same
 * text, and no tooltip is shown until a point is selected.
 * Run with: npx tsx src/app/(app)/dashboard/_components/TrendChart.test.ts
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import TrendChart, { axisTicks } from "./TrendChart";
import { modelChartSeries, primaryPointDetail, repPointDetail, type TrendSession } from "./ExerciseTrends";
import { prepareModelSeries } from "@/lib/analytics/trendSeries";

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`      ${err instanceof Error ? err.message : String(err)}`);
    failed += 1;
  }
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const session = (overrides: Partial<TrendSession>): TrendSession => ({
  exerciseId: "ex_001", exerciseName: "Lateral Arm Raises", exerciseKind: "dynamic",
  startedAt: "2026-09-25T16:48:07.898Z", avgPeakValue: 95.8, completeLeftReps: 11, completeRightReps: 11,
  totalPairedHoldMs: null, setCount: 1, totalReps: 24, ...overrides,
});

console.log("\nTrendChart hover details\n");

test("each point gets a focusable target whose title and label carry its details", () => {
  const html = renderToStaticMarkup(createElement(TrendChart, {
    series: [{ label: "Peak", color: "#15803d", values: [90, 96], pointDetails: ["Peak: 90 · 1 set · 24 reps", "Peak: 96 · 1 set · 24 reps"] }],
    pointTitles: ["Sep 7, 2026, 7:43 PM", "Sep 26, 2026, 12:48 AM"],
  }));
  assert((html.match(/data-point="/g) ?? []).length === 2, "one target per point");
  assert((html.match(/tabindex="0"/g) ?? []).length === 2, "targets are keyboard-focusable");
  assert(html.includes("<title>Sep 26, 2026, 12:48 AM\nPeak: 96 · 1 set · 24 reps</title>"), "native title fallback");
  assert(html.includes('aria-label="Sep 7, 2026, 7:43 PM, Peak: 90 · 1 set · 24 reps"'), "accessible label");
  assert(!html.includes('role="tooltip"'), "no tooltip until a point is selected");
});

test("two series share one target per session and fall back to their values", () => {
  const html = renderToStaticMarkup(createElement(TrendChart, {
    series: [
      { label: "Left", color: "#2563eb", values: [10, 11] },
      { label: "Right", color: "#ea580c", values: [9, 11] },
    ],
    pointTitles: ["Day 1", "Day 2"],
  }));
  assert((html.match(/data-point="/g) ?? []).length === 2, "one target per session, not per dot");
  assert(html.includes("<title>Day 2\nLeft: 11\nRight: 11</title>"), "both sides listed with value fallback");
});

test("a model band is drawn behind its series, and a skipped session gets no dot", () => {
  const html = renderToStaticMarkup(createElement(TrendChart, {
    series: [{
      label: "Left", color: "#2563eb", values: [90, null, 94],
      band: { mean: [90.5, null, 93.5], low: [88, null, 91], high: [93, null, 96] },
    }],
    pointTitles: ["Day 1", "Day 2", "Day 3"],
  }));
  assert(html.includes('data-band="Left"') && html.includes("<polygon"), "band polygon drawn");
  assert((html.match(/<circle/g) ?? []).length === 2, "no dot for the skipped session");
  assert((html.match(/data-point="/g) ?? []).length === 3, "every session keeps a hover target");
  assert(html.includes("<title>Day 2</title>"), "the skipped session lists no value");
});

test("value-axis ticks sit at round steps inside the plotted range", () => {
  assert(axisTicks(57, 104).values.join(",") === "60,80,100", JSON.stringify(axisTicks(57, 104)));
  const seconds = axisTicks(0.45, 0.82);
  assert(seconds.values.join(",") === "0.6,0.8" && seconds.decimals === 1, JSON.stringify(seconds));
  const drift = axisTicks(-0.11, 1.6);
  assert(drift.values.length >= 2 && drift.values.every((v) => v >= -0.11 && v <= 1.6), JSON.stringify(drift));
  const reps = axisTicks(0, 1, 3, 1);
  assert(reps.values.join(",") === "0,1" && reps.decimals === 0, `counts get whole-number ticks: ${JSON.stringify(reps)}`);
});

test("the chart draws axis values, the first and last dates, and the selected session", () => {
  const html = renderToStaticMarkup(createElement(TrendChart, {
    series: [{ label: "Left", color: "#2563eb", values: [80, 90, 100] }],
    pointTitles: ["Day 1", "Day 2", "Day 3"],
    pointDates: ["Sep 7", "Sep 12", "Sep 26"],
    selected: 1,
    onSelect: () => {},
  }));
  assert((html.match(/data-tick="/g) ?? []).length === 3, "value ticks 80, 90, 100");
  assert(html.includes(">Sep 7<") && html.includes(">Sep 26<") && !html.includes(">Sep 12<"), "first and last dates only");
  assert(html.includes('data-selected="1"'), "selected session marked");
});

test("primary-point details: angle, normalized and hold metrics", () => {
  const angle = { label: "Peak angle (camera estimate)", unit: "", isAngle: true };
  assert(primaryPointDetail(session({}), 95.8, angle, false) === "Peak angle (camera estimate): 96 · 1 set · 24 reps", "angle rounds");
  assert(primaryPointDetail(session({ setCount: 2, totalReps: 1 }), 0.874, { label: "Peak", unit: "", isAngle: false }, false)
    === "Peak: 0.87 · 2 sets · 1 rep", "normalized keeps 2 decimals");
  assert(primaryPointDetail(session({ setCount: 2 }), 29.96, { label: "Hold time", unit: "s", isAngle: false }, true)
    === "Hold time: 30.0s · 2 sets", "hold seconds");
});

test("a session left out of the trend is drawn hollow, off the line, with its reason on hover", () => {
  const prepared = prepareModelSeries("ex_001", [
    { exerciseKind: "dynamic", setCount: 1, leftReps: 8, avgLeftPeakValue: 90 },
    { exerciseKind: "dynamic", setCount: 1, leftReps: 8, avgLeftPeakValue: 60,
      trend: { rulesVersion: "trend_rules_v1", leftReps: 8, rightReps: 0, completeLeftReps: 8, completeRightReps: 0,
        avgLeftPeakValue: 60, avgRightPeakValue: null, sdLeftPeakValue: 0, sdRightPeakValue: null,
        avgLeftFormScore: null, avgRightFormScore: null, leftFormReps: 0, rightFormReps: 0,
        avgLeftLoweringMs: null, avgRightLoweringMs: null, avgLeftRaisingMs: null, avgRightRaisingMs: null,
        leftTimingReps: 6, rightTimingReps: 0, trackedReps: 8, poorlyTrackedReps: 5 } },
    { exerciseKind: "dynamic", setCount: 1, leftReps: 8, avgLeftPeakValue: 92 },
  ], "peak", "left");
  const [chartSeries] = modelChartSeries([prepared], (v) => String(Math.round(v)), "", "reps");
  assert(chartSeries.values[1] === null && chartSeries.heldOut?.[1] === 60, "measured value kept as a hollow point");
  assert(chartSeries.pointDetails?.[1] === "Left: 60 · not in the trend: camera tracking was poor in 5 of 8 repetitions",
    chartSeries.pointDetails?.[1] ?? "no detail");
  const html = renderToStaticMarkup(createElement(TrendChart, { series: [chartSeries], onSelect: () => {} }));
  assert((html.match(/data-held-out="/g) ?? []).length === 1, "one hollow point");
  assert(html.includes("not in the trend: camera tracking was poor"), "its reason in the hover target");
  assert((html.match(/<polyline/g) ?? []).length === 1, "the line joins the counted sessions only");
});

test("rep-point details use the app's full-ROM wording, with or without per-side totals", () => {
  assert(repPointDetail(session({ leftReps: 12 }), "left") === "Left: 11/12 met full-ROM target", "with total");
  assert(repPointDetail(session({}), "right") === "Right: 11 met full-ROM target", "without total");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exitCode = 1;
