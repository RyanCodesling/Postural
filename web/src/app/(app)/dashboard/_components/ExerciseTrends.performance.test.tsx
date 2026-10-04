import { strict as assert } from "node:assert";
import { renderToStaticMarkup } from "react-dom/server";
import { ExerciseTrendCard, groupSessionsByExercise, type TrendSession } from "./ExerciseTrends";

const sessions: TrendSession[] = Array.from({ length: 100 }, (_, i): TrendSession => ({
  id: i + 1, exerciseId: "ex_001", exerciseName: "Lateral Arm Raises", exerciseKind: "dynamic",
  startedAt: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
  avgPeakValue: 80 + i / 10, avgLeftPeakValue: 80 + i / 10, avgRightPeakValue: 81 + i / 10,
  completeLeftReps: 10, completeRightReps: 10, leftReps: 10, rightReps: 10,
  totalPairedHoldMs: null, setCount: 1, totalReps: 20,
  avgLeftFormScore: 90, avgRightFormScore: 90, leftFormReps: 10, rightFormReps: 10,
  avgLeftLoweringMs: 600, avgRightLoweringMs: 650,
})).reverse();
const group = groupSessionsByExercise(sessions)[0];
const html = renderToStaticMarkup(<ExerciseTrendCard group={group} />);
assert.ok(html.includes("Calculating trend"), "initial render defers eligible model fitting");
assert.ok(html.includes("Measured values are available"), "initial render explains measured-only pending state");
assert.ok(html.includes("More measures"), "extras remain discoverable");
assert.ok(!html.includes("Lowering time (descent control)"), "collapsed extras are not rendered or fitted");
assert.ok(!html.includes("Collecting data"), "loading is not misreported as insufficient data");
console.log("Trend card renders measured points and defers model fitting and collapsed charts.");
