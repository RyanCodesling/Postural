/**
 * Left-out sessions (trend data rule 3) on the trend card and in the progress
 * PDF. A card whose sessions are all left out draws their hollow points rather
 * than "No ... recorded"; the card says how many sessions are left out, also
 * when they have too few well-tracked repetitions to plot; the PDF counts each
 * left-out session once, whichever side can be plotted.
 * Run with: npx tsx "src/app/(app)/dashboard/_components/ExerciseTrends.heldOut.test.tsx"
 */
import { strict as assert } from "node:assert";
import { renderToStaticMarkup } from "react-dom/server";
import type { TrendRepSummary } from "@/lib/analytics/trendSeries";
import { ExerciseTrendCard, groupSessionsByExercise, type TrendSession } from "./ExerciseTrends";
import { heldOutRow } from "./progressReport";

// Six of twelve tracked repetitions poor: the session is left out (rule 3).
const trend = (over: Partial<TrendRepSummary>): TrendRepSummary => ({
  rulesVersion: "trend_rules_v1",
  leftReps: 3, rightReps: 3, completeLeftReps: 3, completeRightReps: 3,
  avgLeftPeakValue: 88, avgRightPeakValue: 87, sdLeftPeakValue: 1, sdRightPeakValue: 1,
  avgLeftFormScore: null, avgRightFormScore: null, leftFormReps: 0, rightFormReps: 0,
  avgLeftLoweringMs: null, avgRightLoweringMs: null, avgLeftRaisingMs: null, avgRightRaisingMs: null,
  leftTimingReps: 0, rightTimingReps: 0, trackedReps: 12, poorlyTrackedReps: 6,
  ...over,
});
const session = (day: number, over: Partial<TrendRepSummary> = {}): TrendSession => ({
  id: day, exerciseId: "ex_001", exerciseName: "Lateral Arm Raises", exerciseKind: "dynamic",
  startedAt: new Date(Date.UTC(2026, 9, day)).toISOString(),
  avgPeakValue: 88, avgLeftPeakValue: 88, avgRightPeakValue: 87,
  completeLeftReps: 6, completeRightReps: 6, leftReps: 6, rightReps: 6,
  totalPairedHoldMs: null, setCount: 1, totalReps: 12,
  trend: trend(over),
});
const card = (sessions: TrendSession[]) =>
  renderToStaticMarkup(<ExerciseTrendCard group={groupSessionsByExercise(sessions)[0]} />).replace(/<!-- -->/g, "");
const hollow = (html: string) => (html.match(/data-held-out="/g) ?? []).length;

const allLeftOut = card([session(1), session(2)]);
assert.equal(hollow(allLeftOut), 4, "two left-out sessions, both sides, drawn hollow");
assert.ok(!allLeftOut.includes("No peak angle (camera estimate) recorded"), "not reported as unrecorded");
assert.ok(allLeftOut.includes("2 sessions are left out of the trend lines because the camera tracked half or more of their repetitions poorly."),
  "the card says why");

const tooFew = card([session(1, { leftReps: 2, rightReps: 2 }), session(2, { leftReps: 2, rightReps: 2 })]);
assert.equal(hollow(tooFew), 0, "two well-tracked repetitions per side are too few to plot");
assert.ok(tooFew.includes("No peak angle (camera estimate) to plot."), "nothing to plot, not nothing recorded");
assert.ok(tooFew.includes("2 sessions are left out of the trend lines"), "still counted on the card");

const kept = card([{ ...session(1), trend: undefined }, { ...session(2), trend: undefined }]);
assert.ok(!kept.includes("data-held-out-note"), "no note when nothing is left out");

// One session plottable on the left only, the other on the right only, a third on neither: three left out.
assert.deepEqual(
  heldOutRow([session(1, { rightReps: 2 }), session(2, { leftReps: 2 }), session(3, { leftReps: 1, rightReps: 1 }), { ...session(4), trend: undefined }]),
  [["Left out of the trend", "3 sessions: camera tracking was poor"]],
);
assert.deepEqual(heldOutRow([{ ...session(1), trend: undefined }]), [], "no row when nothing is left out");
console.log("Left-out sessions: hollow points drawn, the card's note and the PDF count each session once.");
