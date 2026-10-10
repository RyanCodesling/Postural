/**
 * Pins the trend data rules: timing skips each set's first repetition per side;
 * a repetition tracked poorly for at least a quarter of its frames counts in no
 * measure; a session with at least half its tracked repetitions poorly tracked
 * is drawn hollow and left out of the fit; nothing is left out without a
 * tracking record, and data read before the rules counts every repetition.
 * Run with: npx tsx src/lib/analytics/trendRules.test.ts
 */
import { endOfSetRows, measureFromDetail, repRows, sessionTracking, type SessionRepsDetail } from "./trendBreakdown";
import {
  POOR_TRACKING_SHARE,
  SESSION_POOR_SHARE,
  firstRepsOfSets,
  repPoorlyTracked,
  repTrackingShare,
  repTrackingUnchecked,
  sessionPoorlyTracked,
} from "./trendRules";
import {
  fitModelSeries,
  hasChartPoints,
  heldOutSessionCount,
  prepareModelSeries,
  sessionMeasure,
  type TrendModelSession,
  type TrendRepSummary,
} from "./trendSeries";

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

const tracked = (frames: number, rejectedFrames: number, unsteadyFrames: number, checkedFrames = frames - rejectedFrames) => ({
  tracking: { version: 1, check: "tracking_steadiness_v1", frames, rejectedFrames, checkedFrames, unsteadyFrames },
});

console.log("\nTrend data rules\n");

test("each set's first repetition per side is found by repetition order", () => {
  const firsts = firstRepsOfSets([
    { setIndex: 1, side: "left", repIndex: 3 }, { setIndex: 1, side: "left", repIndex: 1 },
    { setIndex: 1, side: "right", repIndex: 2 }, { setIndex: 2, side: "left", repIndex: 5 },
    { setIndex: 2, side: "left", repIndex: 7 },
  ]);
  assert([...firsts].sort((a, b) => a - b).join(",") === "1,2,5", [...firsts].join(","));
});

test("a quarter of a repetition's frames poorly tracked leaves it out; less does not", () => {
  assert(POOR_TRACKING_SHARE === 0.25, "the share");
  assert(!repPoorlyTracked(tracked(100, 10, 14)), "24 %");
  assert(repPoorlyTracked(tracked(100, 10, 15)), "25 %");
  assert(repPoorlyTracked(tracked(40, 0, 40)), "all unsteady");
  assert(repTrackingShare(tracked(0, 0, 0)) === null, "no frames, no record");
  assert(!repPoorlyTracked(null) && !repPoorlyTracked({ rawRule: {} }), "no record counts");
  assert(!repPoorlyTracked({ tracking: { frames: "40", rejectedFrames: 40, unsteadyFrames: 0 } }), "a malformed record counts");
});

test("a repetition the check could not judge reads as unknown, and still counts", () => {
  const unchecked = tracked(30, 2, 0, 0);
  assert(repTrackingUnchecked(unchecked), "frames passed readiness, none judged");
  assert(!repPoorlyTracked(unchecked), "not left out for it");
  assert(!repTrackingUnchecked(tracked(30, 2, 0)), "judged on every frame");
  assert(!repTrackingUnchecked(tracked(30, 30, 0, 0)), "every frame failed readiness: nothing to judge");
  assert(!repTrackingUnchecked({ tracking: { version: 1, frames: 30, rejectedFrames: 0, unsteadyFrames: 0 } }), "a record without the count");
  const detail: SessionRepsDetail = {
    reps: [unchecked, unchecked, tracked(30, 0, 0)].map((compensations, i) =>
      ({ repIndex: i + 1, setIndex: 1, side: "left", peakValue: 90, classification: "complete", compensations })),
    sets: [],
  };
  const session = sessionTracking(detail);
  assert(session.uncheckedReps === 2 && session.trackedReps === 3 && !session.heldOut, JSON.stringify(session));
});

test("a session is left out when at least half its tracked repetitions were poorly tracked", () => {
  assert(SESSION_POOR_SHARE === 0.5, "the share");
  assert(!sessionPoorlyTracked(0, 0), "no tracking records");
  assert(!sessionPoorlyTracked(3, 1), "one in three");
  assert(sessionPoorlyTracked(4, 2), "two in four");
});

// Left repetitions 1-4 in set 1 and 5-8 in set 2; repetition 3 poorly tracked.
const detail: SessionRepsDetail = {
  reps: [1, 2, 3, 4, 5, 6, 7, 8].map((repIndex) => ({
    repIndex, setIndex: repIndex <= 4 ? 1 : 2, side: "left", targetRom: 90,
    peakValue: repIndex === 3 ? 40 : 90, classification: repIndex === 3 ? "partial" : "complete",
    timeToPeakMs: repIndex === 1 || repIndex === 5 ? 6000 : 800, holdMs: 0, descentMs: 600,
    compensations: {
      ...(repIndex === 3 ? tracked(30, 2, 20) : tracked(30, 0, 0)),
      rawFeatures: { compensations: { trunkLean: { overThresholdFrac: repIndex === 3 ? 1 : 0 } } },
    },
  })),
  sets: [],
};

test("the breakdown applies the rules: timing skips first repetitions, poor tracking counts nowhere", () => {
  const raising = measureFromDetail(detail, "raisingS", "left");
  assert(raising.value === 0.8 && raising.units === 5, `raising ${JSON.stringify(raising)}`);
  const peak = measureFromDetail(detail, "peak", "left");
  assert(peak.value === 90 && peak.units === 7, `peak ${JSON.stringify(peak)}`);
  const completion = measureFromDetail(detail, "completionPct", "left");
  assert(completion.value === 100 && completion.units === 7, `completion ${JSON.stringify(completion)}`);
  const exposure = measureFromDetail(detail, "exposure:trunkLean", "left");
  assert(exposure.value === 0 && exposure.units === 7, `exposure ${JSON.stringify(exposure)}`);
  const rows = repRows(detail, "left", ["trunkLean"]);
  assert(rows.map((r) => r.leftOut ?? "-").join(",") === "first-of-set,-,tracking,-,first-of-set,-,-,-", rows.map((r) => r.leftOut).join(","));
  const session = sessionTracking(detail);
  assert(session.trackedReps === 8 && session.poorReps === 1 && !session.heldOut, JSON.stringify(session));
});

test("the end-of-set gauge compares each set's last repetition with its middle ones", () => {
  const rep = (repIndex: number, setIndex: number, totalMs: number, peakValue: number, compensations: unknown = tracked(30, 0, 0)) =>
    ({ repIndex, setIndex, side: "left", peakValue, classification: "complete", totalMs, compensations });
  const gauge: SessionRepsDetail = {
    reps: [
      // Set 1: a slow first repetition (left out), four middle ones, a slower and shorter last one.
      rep(1, 1, 5000, 99), rep(2, 1, 1000, 90), rep(3, 1, 1100, 92), rep(4, 1, 1200, 94), rep(5, 1, 1300, 96), rep(6, 1, 1500, 88),
      // Set 2: only three repetitions on the side, so no comparison.
      rep(7, 2, 1000, 90), rep(8, 2, 1000, 90), rep(9, 2, 1000, 90),
      // Set 3: the last repetition poorly tracked, so no comparison.
      rep(10, 3, 1000, 90), rep(11, 3, 1000, 90), rep(12, 3, 1000, 90), rep(13, 3, 3000, 70, tracked(30, 0, 20)),
    ],
    sets: [],
  };
  const rows = endOfSetRows(gauge, "left");
  assert(rows.length === 2, `sets with at least 4 repetitions: ${rows.length}`);
  assert(rows[0].setIndex === 1 && rows[0].middleReps === 4, JSON.stringify(rows[0]));
  assert(Math.abs((rows[0].durationRatio ?? 0) - 1500 / 1150) < 1e-9, `ratio ${rows[0].durationRatio}`);
  assert(rows[0].peakChange === 88 - 93, `peak change ${rows[0].peakChange}`);
  assert(rows[1].setIndex === 3 && rows[1].durationRatio === null && rows[1].peakChange === null, JSON.stringify(rows[1]));
  assert(endOfSetRows(gauge, "right").length === 0, "the other side has none");
});

const summary = (trend: Partial<TrendRepSummary>): TrendModelSession => ({
  exerciseKind: "dynamic", setCount: 2,
  leftReps: 8, avgLeftPeakValue: 80, avgLeftLoweringMs: 2000, avgLeftRaisingMs: 3000,
  trend: {
    rulesVersion: "trend_rules_v1",
    leftReps: 7, rightReps: 0, completeLeftReps: 7, completeRightReps: 0,
    avgLeftPeakValue: 90, avgRightPeakValue: null, sdLeftPeakValue: 0, sdRightPeakValue: null,
    avgLeftFormScore: null, avgRightFormScore: null, leftFormReps: 0, rightFormReps: 0,
    avgLeftLoweringMs: 600, avgRightLoweringMs: null, avgLeftRaisingMs: 800, avgRightRaisingMs: null,
    leftTimingReps: 5, rightTimingReps: 0, trackedReps: 8, poorlyTrackedReps: 1,
    ...trend,
  },
});

test("the charts read the rule summary, and data read before the rules counts every repetition", () => {
  const ruled = sessionMeasure(summary({}), "raisingS", "left");
  assert(ruled.value === 0.8 && ruled.units === 5, `ruled ${JSON.stringify(ruled)}`);
  const before = sessionMeasure({ ...summary({}), trend: undefined }, "raisingS", "left");
  assert(before.value === 3 && before.units === 8, `before ${JSON.stringify(before)}`);
});

test("a poorly tracked session is drawn hollow and left out of the fit", () => {
  const sessions = [summary({}), summary({ avgLeftPeakValue: 60, trackedReps: 8, poorlyTrackedReps: 4 }), summary({ avgLeftPeakValue: 91 })];
  const prepared = prepareModelSeries("ex_001", sessions, "peak", "left");
  assert(prepared.values.join(",") === "90,,91", `values ${prepared.values.join(",")}`);
  assert(prepared.heldOut[0] === null && prepared.heldOut[2] === null, "only the poorly tracked session");
  assert(prepared.heldOut[1]?.value === 60, `held out ${JSON.stringify(prepared.heldOut[1])}`);
  assert(prepared.heldOut[1]?.reason === "camera tracking was poor in 4 of 8 repetitions", prepared.heldOut[1]?.reason ?? "");
  assert(prepared.counted === 2, "two sessions fitted");
  const fitted = fitModelSeries(prepared);
  assert(JSON.stringify(fitted.heldOut) === JSON.stringify(prepared.heldOut), "the fit keeps the hollow point");
  assert(fitted.bandMean[1] === null, "no band at the held-out session");
});

test("every left-out session is counted, even one with too few well-tracked repetitions to plot", () => {
  // Two of four tracked repetitions poor: left out, and the two good ones are fewer than a point needs.
  const sparse = summary({ leftReps: 2, avgLeftPeakValue: 90, trackedReps: 4, poorlyTrackedReps: 2 });
  const prepared = prepareModelSeries("ex_001", [summary({}), sparse], "peak", "left");
  assert(prepared.values[1] === null && prepared.heldOut[1] === null, "nothing to draw for it");
  assert(heldOutSessionCount([summary({}), sparse]) === 1, "still counted as left out");
  assert(heldOutSessionCount([{ ...sparse, exerciseKind: "isometric" }]) === 0, "rule 3 never applies to holds");
});

test("a chart whose sessions are all left out still has hollow points to draw", () => {
  const held = summary({ avgLeftPeakValue: 60, trackedReps: 6, poorlyTrackedReps: 3 });
  const prepared = prepareModelSeries("ex_001", [held, held], "peak", "left");
  assert(prepared.counted === 0, "nothing fitted");
  assert(hasChartPoints(prepared), "the hollow points are drawable");
  const empty = prepareModelSeries("ex_001", [summary({ leftReps: 0, avgLeftPeakValue: null })], "peak", "left");
  assert(!hasChartPoints(empty), "a series with no value has nothing to draw");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exitCode = 1;
