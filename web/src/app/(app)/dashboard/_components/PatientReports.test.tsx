/**
 * The Reports tab's peak chart follows the trend data rules, as the trend cards
 * do. A poorly tracked session is drawn hollow, off the line, with a note; the
 * shoulder press's normalized readings keep their decimals; the chart is titled
 * with the measure's own label, never "Range of Motion"; and the exercise list
 * tells two setups of one exercise apart.
 * Run with: npx tsx "src/app/(app)/dashboard/_components/PatientReports.test.tsx"
 */
import { strict as assert } from "node:assert";
import { renderToStaticMarkup } from "react-dom/server";
import type { TrendRepSummary } from "@/lib/analytics/trendSeries";
import { groupSessionsByExercise, type TrendSession } from "./ExerciseTrends";
import PatientReports, { setupOptionLabel } from "./PatientReports";

const DAY_MS = 86_400_000;
// Recent days, so that the report's default range (the prior month) includes them.
const daysAgo = (n: number) => new Date(Date.now() - n * DAY_MS).toISOString();

const trend = (over: Partial<TrendRepSummary>): TrendRepSummary => ({
  rulesVersion: "trend_rules_v1",
  leftReps: 4, rightReps: 4, completeLeftReps: 4, completeRightReps: 4,
  avgLeftPeakValue: 80, avgRightPeakValue: 80, sdLeftPeakValue: 1, sdRightPeakValue: 1,
  avgLeftFormScore: null, avgRightFormScore: null, leftFormReps: 0, rightFormReps: 0,
  avgLeftLoweringMs: null, avgRightLoweringMs: null, avgLeftRaisingMs: null, avgRightRaisingMs: null,
  leftTimingReps: 0, rightTimingReps: 0, trackedReps: 8, poorlyTrackedReps: 0,
  ...over,
});
const session = (n: number, peak: number, over: Partial<TrendSession> = {}): TrendSession => ({
  id: n, exerciseId: "ex_001", exerciseName: "Lateral Arm Raises", exerciseKind: "dynamic",
  startedAt: daysAgo(n),
  avgPeakValue: peak, avgLeftPeakValue: peak, avgRightPeakValue: peak,
  completeLeftReps: 4, completeRightReps: 4, leftReps: 4, rightReps: 4,
  totalPairedHoldMs: null, setCount: 1, totalReps: 8, prescribedSide: "both",
  ...over,
});
// Raw peak 120, but 8 of its 16 tracked repetitions were poor: the rules leave it out at 80.
const poorlyTracked = (n: number) => session(n, 120, { trend: trend({ trackedReps: 16, poorlyTrackedReps: 8 }) });

const report = (sessions: TrendSession[]) => {
  const html = renderToStaticMarkup(<PatientReports sessions={sessions} occurrences={[]} />).replace(/<!-- -->/g, "");
  const svg = html.match(/<svg[^>]*aria-label="Peak[^"]* by session"[^>]*>[\s\S]*?<\/svg>/)?.[0];
  assert.ok(svg, "the peak chart renders");
  return { html, svg };
};
const linePoints = (svg: string) =>
  [...svg.matchAll(/<path d="([^"]*)" fill="none"/g)].map((m) => (m[1].match(/[ML]/g) ?? []).length);
const ticks = (svg: string) => [...svg.matchAll(/text-anchor="end"[^>]*>([^<]*)</g)].map((m) => m[1]);

// 1. Tracking: the left-out session is drawn hollow at its rule value, off both lines.
const tracked = report([session(1, 90), poorlyTracked(2), session(3, 70)]);
assert.deepEqual(linePoints(tracked.svg), [2, 2], "each side's line joins the two counted sessions only");
assert.equal((tracked.svg.match(/data-held-out=""/g) ?? []).length, 2, "both sides of the left-out session are hollow");
assert.ok(tracked.svg.includes("Left 80: left out because camera tracking was poor in 8 of 16 repetitions"), "says why");
assert.deepEqual(ticks(tracked.svg), ["0", "23", "45", "68", "90"], "the raw 120 is not drawn");
assert.ok(
  tracked.html.includes("1 session is left out of the lines because the camera tracked half or more of its repetitions poorly."),
  "the chart's note",
);
const clean = report([session(1, 90), session(3, 70)]);
assert.ok(!clean.html.includes("data-held-out-note"), "no note when nothing is left out");

// 2. Normalized press readings keep two decimals and stay apart.
const press = (n: number, value: number) => session(n, value, { exerciseId: "ex_007", exerciseName: "Overhead Shoulder Press" });
const normalized = report([press(1, 0.44), press(2, 0.24)]);
assert.deepEqual(ticks(normalized.svg), ["0.00", "0.25", "0.50", "0.75", "1.00"], "normalized tick labels");
assert.notEqual(normalized.svg, report([press(1, 0), press(2, 0)]).svg, "0.24 and 0.44 are not drawn as zero");

// 3. The chart's title and accessible name are the measure's label, as on the trend cards.
assert.ok(clean.html.includes(">Peak angle (camera estimate)</h3>"), "angles: the camera-estimate label");
assert.ok(clean.svg.includes('aria-label="Peak angle (camera estimate) by session"'), "the chart's accessible name");
assert.ok(normalized.html.includes(">Peak</h3>"), "the press: its normalized reading");
assert.ok(!clean.html.includes("Range of Motion") && !normalized.html.includes("Range of Motion"), "never Range of Motion");

// 4. The exercise list tells two setups of one exercise apart: same side and
// resistance, another measurement version, so the dates and counts differ.
const current = [1, 2, 3].map((n) => session(n, 88, { comparableContextKey: "current", exerciseConfigVersion: "current", prescribedSide: "right" }));
const earlier = session(9, 84, { comparableContextKey: "earlier", exerciseConfigVersion: "earlier", prescribedSide: "right" });
const labels = groupSessionsByExercise([...current, earlier]).map(setupOptionLabel);
assert.equal(labels.length, 2, "two setups");
assert.notEqual(labels[0], labels[1], "their labels differ");
for (const label of labels) {
  assert.match(label, /^Lateral Arm Raises · right side · Legacy resistance not recorded · [A-Z][a-z]{2} \d{1,2}/, label);
}
assert.ok(labels.some((label) => / – .*\(3 sessions\)$/.test(label)), "a date range and its sessions");
assert.ok(labels.some((label) => /\(1 session\)$/.test(label)), "a single session");
const options = [...report([...current, earlier]).html.matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map((m) => m[1]);
assert.deepEqual(options, labels, "the rendered options");

console.log("Reports chart: trend data rules, normalized decimals, the measure's label and distinguishable setups.");
