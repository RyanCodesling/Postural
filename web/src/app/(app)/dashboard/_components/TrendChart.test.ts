/**
 * Trend chart hover details: every plotted session gets a hover/tap/focus
 * target carrying its details, the native <title> fallback holds the same
 * text, and no tooltip is shown until a point is selected.
 * Run with: npx tsx src/app/(app)/dashboard/_components/TrendChart.test.ts
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import TrendChart from "./TrendChart";
import { primaryPointDetail, repPointDetail, type TrendSession } from "./ExerciseTrends";

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

test("primary-point details: angle, normalized and hold metrics", () => {
  const angle = { label: "Peak angle (camera estimate)", unit: "", isAngle: true };
  assert(primaryPointDetail(session({}), 95.8, angle, false) === "Peak angle (camera estimate): 96 · 1 set · 24 reps", "angle rounds");
  assert(primaryPointDetail(session({ setCount: 2, totalReps: 1 }), 0.874, { label: "Peak", unit: "", isAngle: false }, false)
    === "Peak: 0.87 · 2 sets · 1 rep", "normalized keeps 2 decimals");
  assert(primaryPointDetail(session({ setCount: 2 }), 29.96, { label: "Hold time", unit: "s", isAngle: false }, true)
    === "Hold time: 30.0s · 2 sets", "hold seconds");
});

test("rep-point details use the app's full-ROM wording, with or without per-side totals", () => {
  assert(repPointDetail(session({ leftReps: 12 }), "left") === "Left: 11/12 met full-ROM target", "with total");
  assert(repPointDetail(session({}), "right") === "Right: 11 met full-ROM target", "without total");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exitCode = 1;
