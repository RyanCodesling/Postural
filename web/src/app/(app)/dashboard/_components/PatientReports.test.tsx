/**
 * The Reports tab's range chart and the patient's range-of-motion gauge follow
 * the trend data rules, as the trend cards do. A poorly tracked session is drawn
 * hollow, off the line, with a note; the shoulder press's normalized readings
 * keep their decimals; and the gauge compares the sessions of one exercise
 * setup, under the same rules.
 * Run with: npx tsx "src/app/(app)/dashboard/_components/PatientReports.test.tsx"
 */
import { strict as assert } from "node:assert";
import { renderToStaticMarkup } from "react-dom/server";
import type { TrendRepSummary } from "@/lib/analytics/trendSeries";
import type { TrendSession } from "./ExerciseTrends";
import PatientReports from "./PatientReports";
import PatientProgramView, { gaugeHistory } from "../patient/PatientProgramView";

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
  const svg = html.match(/<svg[^>]*aria-label="Range of motion by session"[^>]*>[\s\S]*?<\/svg>/)?.[0];
  assert.ok(svg, "the range chart renders");
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

// 3. The gauge: the newest setup only, under the trend data rules.
const right85 = session(1, 85, { comparableContextKey: "new-setup", exerciseConfigVersion: "new", prescribedSide: "right" });
const left145 = session(2, 145, { comparableContextKey: "old-setup", exerciseConfigVersion: "old", prescribedSide: "left" });
assert.deepEqual(gaugeHistory([right85, left145]), { exerciseName: "Lateral Arm Raises", values: [85] }, "another setup is not compared");
assert.deepEqual(gaugeHistory([session(1, 90), poorlyTracked(2), session(3, 70)])?.values, [70, 90], "a left-out session is not on the gauge");
const uneven = session(1, 0, { trend: trend({ avgLeftPeakValue: 80, leftReps: 6, avgRightPeakValue: 60, rightReps: 3 }) });
assert.ok(Math.abs((gaugeHistory([uneven])?.values[0] ?? 0) - (80 * 6 + 60 * 3) / 9) < 1e-9, "both sides weighted by repetitions");
assert.equal(gaugeHistory([session(1, 90, { leftReps: 2 })]), null, "a side with too few repetitions does not count");
assert.equal(gaugeHistory([press(1, 0.44)]), null, "normalized readings are not on the degree gauge");
const sideBend = session(1, 40, { exerciseId: "ex_005", exerciseName: "Standing Side Bend", trend: trend({ trackedReps: 16, poorlyTrackedReps: 8 }) });
assert.equal(gaugeHistory([sideBend, session(2, 88)])?.exerciseName, "Lateral Arm Raises", "an exercise with nothing counted is skipped");

const program = renderToStaticMarkup(
  <PatientProgramView
    patientName="Test patient"
    occurrences={[]}
    sessions={[right85, left145]}
    today={daysAgo(0).slice(0, 10)}
    tagFor={() => ({ label: "", classes: "" })}
    isActionable={() => false}
    onStart={() => {}}
    calendar={null}
  />,
).replace(/<!-- -->/g, "");
assert.match(program, /Latest[^]*?>85<[^]*?Best[^]*?>85<[^]*?First[^]*?>85</, "the rendered gauge uses one setup");

console.log("Reports chart and gauge: trend data rules, normalized decimals and one exercise setup.");
