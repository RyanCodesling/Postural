/**
 * Trend series building: the data rules the model was evaluated with (prescribed
 * side only, at least 3 repetitions per side, holds as % of the prescribed hold),
 * labels only on the labelled measures, and the band mapped back onto sessions.
 * Run with: npx tsx src/lib/analytics/trendSeries.test.ts
 */
import {
  changeText,
  extraTrendMeasures,
  groupModelSeries,
  modelSeries,
  sessionMeasure,
  type TrendModelSession,
} from "./trendSeries";
import { fitTrend, type TrendFit } from "./trendModel";

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

const rep = (left: number, right: number, reps = 12, extra: Partial<TrendModelSession> = {}): TrendModelSession => ({
  exerciseKind: "dynamic", setCount: 2,
  avgLeftPeakValue: left, avgRightPeakValue: right, leftReps: reps, rightReps: reps,
  avgLeftFormScore: 95, avgRightFormScore: 96, leftFormReps: reps, rightFormReps: reps, ...extra,
});

console.log("\nTrend series and data rules\n");

test("only the prescribed side is modelled", () => {
  const series = groupModelSeries("ex_001", "left", [rep(90, 50), rep(92, 50), rep(94, 50)], "peak", true);
  assert(series.length === 1 && series[0].side === "left", "one left series");
  assert(series[0].values.join(",") === "90,92,94", `left values ${series[0].values}`);
});

test("a side with fewer than 3 repetitions does not count for that session", () => {
  const sessions = [rep(90, 91), rep(60, 91, 2), rep(92, 93), rep(94, 95)];
  const left = modelSeries("ex_001", sessions, "peak", "left");
  assert(left.values[1] === null && left.units[1] === null, "aborted attempt left out");
  assert(left.counted === 3, `counted ${left.counted}`);
  assert(left.bandMean[1] === null && left.bandMean[0] !== null && left.bandMean[3] !== null, "band only on counted sessions");
});

test("holds use time in band as a percentage of the prescribed hold", () => {
  const set = (setIndex: number, left: number, right: number, score: number) =>
    ({ setIndex, targetHoldMs: 20000, holdQuality: { leftInBandMs: left, rightInBandMs: right, meanCompensationScore: score } });
  const hold: TrendModelSession = { exerciseKind: "isometric", setCount: 2, holdSets: [set(1, 18000, 15000, 86), set(2, 18000, 15000, 90)] };
  assert(sessionMeasure(hold, "inBandPct", "left").value === 90, "left 90 %");
  assert(sessionMeasure(hold, "inBandPct", "right").value === 75, "right 75 %");
  assert(sessionMeasure(hold, "inBandPct", "left").units === 2, "sets are the units");
  const noTarget = { ...hold, holdSets: hold.holdSets!.map((s) => ({ ...s, targetHoldMs: 0 })) };
  assert(sessionMeasure(noTarget, "inBandPct", "left").value === null, "no target, no value");
  assert(sessionMeasure(hold, "holdFormScore", "card").value === 88, "hold form score");
  assert(sessionMeasure({ exerciseKind: "isometric", setCount: 1 }, "inBandPct", "left").units === 0, "no sets, no units");
});

test("the main measure is labelled; the form score has a band but no label", () => {
  const sessions = [rep(80, 81), rep(84, 85), rep(88, 89), rep(92, 93), rep(96, 97)];
  const peak = modelSeries("ex_001", sessions, "peak", "left");
  const form = modelSeries("ex_001", sessions, "formScore", "left");
  assert(peak.label === "rising", `peak label ${peak.label}`);
  assert(form.label === null && form.fit !== null, "form: fitted, not labelled");
});

test("too few counted sessions reads as collecting data", () => {
  const peak = modelSeries("ex_001", [rep(90, 90)], "peak", "left");
  assert(peak.fit === null && peak.label === "collecting", `label ${peak.label}`);
  const two = modelSeries("ex_001", [rep(90, 90), rep(99, 99)], "peak", "left");
  assert(two.fit !== null && two.label === "collecting", "two sessions: band shown, no call yet");
});

test("an exercise without a trend model gets no band or label", () => {
  const series = modelSeries("ex_002", [rep(90, 90), rep(92, 92), rep(94, 94)], "peak", "left");
  assert(series.spec === null && series.fit === null && series.label === null, "no model");
  assert(series.values.every((v) => v !== null), "values still charted");
});

test("extra measures map from the saved summaries", () => {
  const s: TrendModelSession = {
    ...rep(90, 91), completeLeftReps: 9, completeRightReps: 12,
    avgLeftLoweringMs: 850, avgRightLoweringMs: 900, avgLeftRaisingMs: 1200, avgRightRaisingMs: 1100,
    sdLeftPeakValue: 2.5, sdRightPeakValue: 3.5,
    exposure: { trunkLean: { left: 0.1, right: 0.25, leftN: 12, rightN: 11 } },
  };
  assert(sessionMeasure(s, "loweringS", "left").value === 0.85, "lowering seconds");
  assert(sessionMeasure(s, "raisingS", "right").value === 1.1, "raising seconds");
  assert(sessionMeasure(s, "completionPct", "left").value === 75, "9 of 12 complete");
  assert(sessionMeasure(s, "peakSpread", "right").value === 3.5, "peak spread");
  const exposure = sessionMeasure(s, "exposure:trunkLean", "right");
  assert(exposure.value === 25 && exposure.units === 11, `exposure ${JSON.stringify(exposure)}`);
  assert(sessionMeasure(s, "exposure:neckTilt", "left").value === null, "metric not recorded");
  const hold: TrendModelSession = {
    exerciseKind: "isometric", setCount: 2,
    holdSets: [
      { setIndex: 1, targetHoldMs: 30000, holdQuality: { left: { sdDeg: 4, droopSlopeDegPerSec: -0.1 }, right: { meanErrorDeg: -6 } } },
      { setIndex: 2, targetHoldMs: 30000, holdQuality: { left: { sdDeg: 5, droopSlopeDegPerSec: -0.3 } } },
    ],
  };
  assert(sessionMeasure(hold, "holdSteadiness", "left").value === 4.5, "steadiness");
  assert(sessionMeasure(hold, "holdError", "right").value === 6 && sessionMeasure(hold, "holdError", "right").units === 1,
    "distance from target, from the one set that recorded it");
  assert(sessionMeasure(hold, "holdDroop", "left").value === -0.2 && sessionMeasure(hold, "holdDroop", "left").units === 2, "drift");
});

test("a measure without a checked band shows measured values only", () => {
  const sessions = [80, 82, 84, 86].map((p, i) => ({ ...rep(p, p), avgLeftLoweringMs: 800 + 20 * i, avgRightLoweringMs: 800 }));
  const lowering = modelSeries("ex_001", sessions, "loweringS", "left");
  assert(lowering.spec?.band === false, "lateral-raise lowering time failed its band check");
  assert(lowering.fit === null && lowering.label === null && lowering.values.every((v) => v !== null), "values without a band");
  const sideBends = modelSeries("ex_005", sessions, "loweringS", "left");
  assert(sideBends.spec?.band !== false && sideBends.fit !== null && sideBends.label === null, "side-bend lowering has a band, no label");
});

test("rep-to-rep spread is session level and needs 3 repetitions", () => {
  const sessions = [2.1, 2.4, 1.9, 2.2].map((sd, i) => ({ ...rep(90, 90, i === 1 ? 2 : 12), sdLeftPeakValue: sd }));
  const spread = modelSeries("ex_001", sessions, "peakSpread", "left");
  assert(spread.spec?.sessionLevel === true && spread.spec.sigmaU === 0, "session-level spec");
  assert(spread.values[1] === null && spread.counted === 3 && spread.fit !== null, "two-repetition session left out");
});

test("ranges are cut to the values a measure can take", () => {
  const sessions = [0, 6, 12, 12].map((complete) => ({ ...rep(90, 90), completeLeftReps: complete, completeRightReps: complete }));
  const series = modelSeries("ex_001", sessions, "completionPct", "left");
  const raw = fitTrend([0, 50, 100, 100], [12, 12, 12, 12], series.spec!);
  assert(raw.changeHigh > 100 || Math.min(...raw.levelLow) < 0 || Math.max(...raw.levelHigh) > 100, "the raw model reaches past a limit");
  assert(series.fit!.changeHigh <= 100 && series.fit!.changeLow >= -100, "change within ±100 points");
  assert(series.bandLow.every((v) => v === null || v >= 0) && series.bandHigh.every((v) => v === null || v <= 100), "band within 0–100 %");
  assert(series.fit!.pRising === raw.pRising && series.fit!.label === raw.label, "probability and label as fitted");
  const peak = modelSeries("ex_001", [80, 84, 88].map((p) => rep(p, p)), "peak", "left");
  const rawPeak = fitTrend([80, 84, 88], [12, 12, 12], peak.spec!);
  assert(peak.fit!.changeHigh === rawPeak.changeHigh, "an open measure is not cut");
});

test("compensation charts use the app's own labels", () => {
  const titles = extraTrendMeasures("ex_001", "dynamic").map((d) => d.title);
  assert(titles.includes("Lowering time (descent control)"), "descent control listed");
  assert(titles.includes("Time over threshold: Shoulder / head position"), "the region label, not a movement");
  assert(extraTrendMeasures("ex_006", "isometric").map((d) => d.measure).join(",") === "holdSteadiness,holdError,holdDroop", "hold measures");
});

test("change text shows the signed estimate and its 95 % range", () => {
  const fit = { meanChange: 8.2, changeLow: -1.5, changeHigh: 14.04 } as TrendFit;
  assert(changeText(fit, (v) => v.toFixed(0)) === "+8 (95 % range −2 to +14)", changeText(fit, (v) => v.toFixed(0)));
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exitCode = 1;
