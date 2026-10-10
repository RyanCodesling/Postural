/**
 * A session's breakdown must rebuild every point the trend charts plot for it:
 * the same value and unit count as the session summary, one side at a time,
 * with the per-repetition (or per-set) values listed as recorded.
 * Run with: npx tsx src/lib/analytics/trendBreakdown.test.ts
 */
import {
  holdRows,
  measureFromDetail,
  recordedWarningThresholds,
  repRows,
  setTimings,
  type SessionRepsDetail,
} from "./trendBreakdown";
import { minUnitsFor, sessionMeasure, type TrendMeasureName, type TrendModelSession } from "./trendSeries";

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
const close = (a: number | null, b: number | null) => a !== null && b !== null && Math.abs(a - b) < 1e-9;

const over = (fracs: Record<string, unknown>) => ({
  rawFeatures: { compensations: Object.fromEntries(Object.entries(fracs).map(([k, v]) => [k, { overThresholdFrac: v }])) },
});
const repsDetail: SessionRepsDetail = {
  reps: [
    { repIndex: 1, setIndex: 1, side: "left", peakValue: 92, targetRom: 90, classification: "complete", timeToPeakMs: 800, holdMs: 200,
      descentMs: 1000, compensations: { rawRule: { meanScore: 90, coveragePct: 100 }, ...over({ trunkLean: 0.1, shoulderSymmetry: 0.5 }) } },
    { repIndex: 2, setIndex: 1, side: "right", peakValue: 70, targetRom: 90, classification: "partial" },
    { repIndex: 3, setIndex: 1, side: "left", peakValue: 88, targetRom: 90, classification: "partial", timeToPeakMs: 1000, holdMs: 0,
      descentMs: 1400, compensations: { rawRule: { meanScore: 70, coveragePct: 60 }, ...over({ trunkLean: 0.3 }) } },
    { repIndex: 4, setIndex: 2, side: "left", peakValue: null, targetRom: 90, classification: "partial", timeToPeakMs: null, holdMs: null,
      descentMs: 1200, compensations: null },
    { repIndex: 5, setIndex: 2, side: "right", peakValue: 75, targetRom: 90, classification: "partial" },
    { repIndex: 6, setIndex: 2, side: "left", peakValue: 94, targetRom: 90, classification: "complete", timeToPeakMs: 900, holdMs: 100,
      descentMs: 800, compensations: { rawRule: { meanScore: 80, coveragePct: 85 }, ...over({ trunkLean: 0.2, shoulderSymmetry: "x" }) } },
  ],
  sets: [],
};
// The session summary the charts read for the same repetitions, computed by hand
// with the SQL rules (AVG and STDDEV_SAMP skip a missing value; COUNT(*) does not).
const repsSummary: TrendModelSession = {
  exerciseKind: "dynamic", setCount: 2,
  avgLeftPeakValue: 274 / 3, leftReps: 4, completeLeftReps: 2,
  avgLeftFormScore: 85, leftFormReps: 2,
  avgLeftLoweringMs: 1100, avgLeftRaisingMs: 900,
  sdLeftPeakValue: Math.sqrt(56 / 3 / 2),
  exposure: { trunkLean: { left: 0.2, right: null, leftN: 3, rightN: 0 }, shoulderSymmetry: { left: 0.5, right: null, leftN: 1, rightN: 0 } },
  // The same repetitions under the trend data rules: timing leaves out each
  // set's first repetition (left: repetitions 1 and 4), so lowering averages
  // repetitions 3 and 6 (1400, 800) and raising the same two (1000, 900).
  trend: {
    rulesVersion: "trend_rules_v1",
    leftReps: 4, rightReps: 2, completeLeftReps: 2, completeRightReps: 0,
    avgLeftPeakValue: 274 / 3, avgRightPeakValue: 72.5,
    sdLeftPeakValue: Math.sqrt(56 / 3 / 2), sdRightPeakValue: Math.sqrt(12.5),
    avgLeftFormScore: 85, avgRightFormScore: null, leftFormReps: 2, rightFormReps: 0,
    avgLeftLoweringMs: 1100, avgRightLoweringMs: null, avgLeftRaisingMs: 950, avgRightRaisingMs: null,
    leftTimingReps: 2, rightTimingReps: 0, trackedReps: 0, poorlyTrackedReps: 0,
  },
};

console.log("\nTrend point breakdown\n");

test("the minimum is 3 repetitions, or 1 set for a hold", () => {
  assert(minUnitsFor("ex_001", "peak") === 3, "repetitions");
  assert(minUnitsFor("ex_006", "inBandPct") === 1, "hold sets");
});

test("every repetition chart's point is rebuilt from the repetitions", () => {
  const measures: TrendMeasureName[] = ["peak", "formScore", "loweringS", "raisingS", "completionPct", "peakSpread",
    "exposure:trunkLean", "exposure:shoulderSymmetry"];
  for (const measure of measures) {
    const fromReps = measureFromDetail(repsDetail, measure, "left");
    const plotted = sessionMeasure(repsSummary, measure, "left");
    assert(close(fromReps.value, plotted.value) && fromReps.units === plotted.units,
      `${measure}: ${JSON.stringify(fromReps)} vs ${JSON.stringify(plotted)}`);
  }
  assert(measureFromDetail(repsDetail, "exposure:neckTilt", "left").value === null, "a compensation never recorded has no point");
});

test("form scores below 80 % coverage are listed but left out of the average", () => {
  const rows = repRows(repsDetail, "left", ["trunkLean"]);
  assert(rows.map((r) => `${r.formScore}:${r.formCounted}`).join(",") === "90:true,70:false,null:false,80:true", "coverage rule");
  assert(measureFromDetail(repsDetail, "formScore", "left").value === 85, "85 from the two counted scores");
});

test("each repetition row carries the values its charts use, left side only", () => {
  const rows = repRows(repsDetail, "left", ["trunkLean", "shoulderSymmetry"]);
  assert(rows.map((r) => r.repIndex).join(",") === "1,3,4,6", "only left repetitions, in order");
  const [first, , missing, last] = rows;
  assert(first.peak === 92 && first.target === 90 && first.complete, "peak, target, reached");
  assert(first.raisingS === 0.8 && first.pauseS === 0.2 && first.loweringS === 1, "seconds");
  assert(first.overThresholdPct.trunkLean === 10 && first.overThresholdPct.shoulderSymmetry === 50, "time over threshold in %");
  assert(missing.peak === null && missing.raisingS === null && missing.loweringS === 1.2, "missing values stay missing");
  assert(last.overThresholdPct.shoulderSymmetry === null, "a non-number share is not a value");
});

test("every hold chart's point is rebuilt from the sets", () => {
  const detail: SessionRepsDetail = {
    reps: [],
    sets: [
      { setIndex: 1, targetHoldMs: 20000, holdQuality: { leftInBandMs: 18000, rightInBandMs: 15000, meanCompensationScore: 86,
        left: { sdDeg: 4, meanErrorDeg: -3, droopSlopeDegPerSec: -0.1 }, right: { sdDeg: 6, meanErrorDeg: 5, droopSlopeDegPerSec: 0.2 } } },
      { setIndex: 2, targetHoldMs: 20000, holdQuality: { leftInBandMs: 17000, meanCompensationScore: 88,
        left: { sdDeg: 5, meanErrorDeg: 1, droopSlopeDegPerSec: 0.3 } } },
    ],
  };
  // The summary carries the same hold sets; each measure counts the sets that recorded it.
  const summary: TrendModelSession = { exerciseKind: "isometric", setCount: 2, holdSets: detail.sets };
  const expected: [TrendMeasureName, "left" | "right" | "card", number, number][] = [
    ["inBandPct", "left", 87.5, 2], ["inBandPct", "right", 75, 1], ["holdFormScore", "card", 87, 2],
    ["holdSteadiness", "left", 4.5, 2], ["holdSteadiness", "right", 6, 1], ["holdError", "left", 2, 2],
    ["holdError", "right", 5, 1], ["holdDroop", "left", 0.1, 2], ["holdDroop", "right", 0.2, 1],
  ];
  for (const [measure, side, value, units] of expected) {
    const fromSets = measureFromDetail(detail, measure, side);
    const plotted = sessionMeasure(summary, measure, side);
    assert(close(fromSets.value, value) && fromSets.units === units, `${measure} ${side}: ${JSON.stringify(fromSets)}`);
    assert(close(plotted.value, value) && plotted.units === units, `${measure} ${side} plotted: ${JSON.stringify(plotted)}`);
  }
  const [first, second] = holdRows(detail, "left");
  assert(first.inBandMs === 18000 && first.targetMs === 20000 && first.distance === 3 && first.formScore === 86, "set 1");
  assert(second.steadiness === 5 && second.drift === 0.3, "set 2");
  assert(holdRows(detail, "right")[1].inBandMs === null, "a set without the side's time");
});

test("compensation sizes are relative to the session's recorded warning thresholds", () => {
  const context = { exercise: { definition: { compensationMetrics: [
    { name: "trunkLean", warningThreshold: 5 }, { name: "scapularElevation", warningThreshold: 0.04 }, { name: "neckTilt" },
  ] } } };
  assert(JSON.stringify(recordedWarningThresholds(context)) === '{"trunkLean":5,"scapularElevation":0.04}', "recorded thresholds");
  const size = (peakAbs: number, meanAbs: number) => ({ peakAbs, meanAbs, overThresholdFrac: 0 });
  const [row] = repRows({
    context,
    reps: [{ repIndex: 1, setIndex: 1, side: "left", peakValue: 92, classification: "complete",
      compensations: { rawFeatures: { compensations: {
        trunkLean: size(7.5, 2.5), scapularElevation: size(0.1, 0.05), shoulderSymmetry: size(3, 1),
      } } } }],
    sets: [],
  }, "left", ["trunkLean", "scapularElevation", "shoulderSymmetry"]);
  assert(row.peakOverThreshold.trunkLean === 1.5 && row.meanOverThreshold.trunkLean === 0.5, "an angle against its threshold");
  assert(close(row.peakOverThreshold.scapularElevation, 2.5), "a ratio against its own threshold");
  assert(row.peakOverThreshold.shoulderSymmetry === null, "no recorded threshold, no comparison");
});

test("set durations and the rest before each set come from the saved set times", () => {
  const timings = setTimings({
    reps: [],
    sets: [
      { setIndex: 2, targetHoldMs: null, holdQuality: null, durationMs: 14000, startTs: "2026-09-26T10:01:17.000Z", endTs: "2026-09-26T10:01:31.000Z" },
      { setIndex: 1, targetHoldMs: null, holdQuality: null, durationMs: 35000, startTs: "2026-09-26T10:00:00.000Z", endTs: "2026-09-26T10:00:35.000Z" },
      { setIndex: 3, targetHoldMs: null, holdQuality: null, durationMs: null, startTs: null, endTs: null },
    ],
  });
  assert(timings.map((t) => `${t.setIndex}:${t.durationMs}:${t.restBeforeMs}`).join(",") === "1:35000:null,2:14000:42000,3:null:null",
    JSON.stringify(timings));
  const fromDatabase = setTimings({
    reps: [],
    sets: [
      { setIndex: 1, targetHoldMs: null, holdQuality: null, durationMs: 35000, startTs: new Date("2026-09-26T10:00:00Z"), endTs: new Date("2026-09-26T10:00:35Z") },
      { setIndex: 2, targetHoldMs: null, holdQuality: null, durationMs: 14000, startTs: new Date("2026-09-26T10:01:17Z"), endTs: new Date("2026-09-26T10:01:31Z") },
    ],
  });
  assert(fromDatabase[1].restBeforeMs === 42000, "times read from the database directly are Date objects");
});

test("hold sets carry settle time, drops, the longest stretch, time out of the band and the lowest score", () => {
  const [row] = holdRows({
    reps: [],
    sets: [{ setIndex: 1, targetHoldMs: 30000, holdQuality: { leftInBandMs: 21800, settleMs: 1200, dropCount: 2,
      longestPairedStreakMs: 15000, outOfPositionMs: 8200, meanCompensationScore: 79, minCompensationScore: 61 } }],
  }, "left");
  assert(row.settleMs === 1200 && row.dropCount === 2 && row.longestInBandMs === 15000, JSON.stringify(row));
  assert(row.outOfBandMs === 8200 && row.formScore === 79 && row.minFormScore === 61, JSON.stringify(row));
});

test("a hold with no time in band recorded has no point", () => {
  const none = measureFromDetail(
    { reps: [], sets: [{ setIndex: 1, targetHoldMs: 20000, holdQuality: { leftInBandMs: "18000" } }] },
    "inBandPct", "left",
  );
  assert(none.value === null && none.units === 0, JSON.stringify(none));
});

test("a set without a measurement neither dilutes a hold nor counts as a unit", () => {
  const measured = { setIndex: 1, targetHoldMs: 20000, holdQuality: { leftInBandMs: 20000 } };
  const inBand = (sets: SessionRepsDetail["sets"]) => measureFromDetail({ reps: [], sets }, "inBandPct", "left");
  // Absent quality: the offline rule gives 100 % from 1 set, not 50 % from 2.
  const absent = inBand([measured, { setIndex: 2, targetHoldMs: 20000, holdQuality: null }]);
  assert(absent.value === 100 && absent.units === 1, `absent quality ${JSON.stringify(absent)}`);
  // A measurement the set route quarantined is kept only for audit.
  const quarantined = inBand([measured, { setIndex: 2, targetHoldMs: 20000,
    holdQuality: { version: "quarantined_measurement_v1", auditOnly: false, reason: "invalid", original: { leftInBandMs: 5000 } } }]);
  assert(quarantined.value === 100 && quarantined.units === 1, `quarantined ${JSON.stringify(quarantined)}`);
  // Unequal targets: each set's own share, averaged (100 % of 10 s and 0 % of 30 s is 50 %, not 25 %).
  const unequal = inBand([
    { setIndex: 1, targetHoldMs: 10000, holdQuality: { leftInBandMs: 10000 } },
    { setIndex: 2, targetHoldMs: 30000, holdQuality: { leftInBandMs: 0 } },
  ]);
  assert(unequal.value === 50 && unequal.units === 2, `unequal targets ${JSON.stringify(unequal)}`);
  // A set needs a positive target for time in band, but still counts for what it did record.
  const sets = [
    { setIndex: 1, targetHoldMs: 0, holdQuality: { leftInBandMs: 9000, left: { sdDeg: 4, meanErrorDeg: 2 } } },
    { setIndex: 2, targetHoldMs: null, holdQuality: { leftInBandMs: 9000, left: { meanErrorDeg: 4 } } },
    { setIndex: 3, targetHoldMs: 20000, holdQuality: { leftInBandMs: 10000, left: { meanErrorDeg: 6 } } },
  ];
  assert(inBand(sets).value === 50 && inBand(sets).units === 1, "only the set with a positive target");
  const steadiness = measureFromDetail({ reps: [], sets }, "holdSteadiness", "left");
  const error = measureFromDetail({ reps: [], sets }, "holdError", "left");
  assert(steadiness.value === 4 && steadiness.units === 1, `one set recorded steadiness ${JSON.stringify(steadiness)}`);
  assert(error.value === 4 && error.units === 3, `all three recorded the distance ${JSON.stringify(error)}`);
  // Only hold sets count; a dynamic set in the detail is not a hold measurement.
  const mixed = inBand([measured, { setIndex: 2, exerciseKind: "dynamic", targetHoldMs: 20000, holdQuality: { leftInBandMs: 0 } }]);
  assert(mixed.value === 100 && mixed.units === 1, `dynamic set ignored ${JSON.stringify(mixed)}`);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exitCode = 1;
