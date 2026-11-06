/**
 * Pins trend data rule 4: a neck side bend's peaks are measured from the head's
 * resting position. Each repetition takes the still-head reading of the latest
 * calibration begun before it; left peaks lose it and right peaks gain it, and
 * completion is judged on the corrected peak against the repetition's own
 * target. Repetitions without a reading count in no peak measure but still
 * count for timing; a session with none is drawn hollow at its saved value.
 * Other exercises read as saved.
 * Run with: npx tsx src/lib/analytics/neckRestReference.test.ts
 */
import { measureFromDetail, neckRestOffsets, repRows, type SessionRepsDetail } from "./trendBreakdown";
import { NECK_REST_EXERCISES, TREND_RULES_VERSION, neckRestOffsetAt, neckRestPeak } from "./trendRules";
import { prepareModelSeries, sessionMeasure, type TrendModelSession, type TrendRepSummary } from "./trendSeries";
import {
  NECK_REST_MIN_FRAMES,
  NECK_REST_RULE,
  buildCaptureQualitySummary,
  neckRestRecordFromTally,
  parseCaptureQualitySummary,
  parseNeckRestRecord,
} from "../sessionReadModels";

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
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const near = (a: number | null, b: number, message: string) =>
  assert(a !== null && Math.abs(a - b) < 1e-9, `${message}: ${a} vs ${b}`);

const T0 = "2026-10-19T10:00:00.000Z";
const at = (seconds: number) => new Date(Date.parse(T0) + seconds * 1000).toISOString();

/** Two sets of two bends per side; the still head read 4 toward the right (-4). */
function neckDetail(captureQuality: SessionRepsDetail["captureQuality"], exerciseId = "ex_004"): SessionRepsDetail {
  const rep = (repIndex: number, setIndex: number, side: "left" | "right", peakValue: number, seconds: number) => ({
    repIndex, setIndex, side, peakValue, targetRom: 30,
    classification: peakValue >= 30 ? "complete" : "partial",
    timeToPeakMs: 500, holdMs: 100, descentMs: 400, totalMs: 1000, compensations: null, startTs: at(seconds),
  });
  return {
    exerciseId,
    captureQuality,
    reps: [
      rep(1, 1, "left", 28, 5), rep(2, 1, "right", 48, 6), rep(3, 1, "left", 34, 7), rep(4, 1, "right", 50, 8),
      rep(5, 2, "left", 30, 45), rep(6, 2, "right", 46, 46), rep(7, 2, "left", 32, 47), rep(8, 2, "right", 44, 48),
    ],
    sets: [],
  };
}
const withRest = (offsetDeg: number | null) => ({ neckRest: { epochs: [{ from: T0, offsetDeg, frames: 400 }] } });

console.log("\ntrend data rule 4: neck peaks from the resting position\n");

test("the rules are version 2 and rule 4 covers the neck side bend only", () => {
  assert(TREND_RULES_VERSION === "trend_rules_v2", TREND_RULES_VERSION);
  assert(NECK_REST_EXERCISES.has("ex_004") && NECK_REST_EXERCISES.size === 1, "ex_004 only");
});

test("a repetition takes the reading of the latest calibration begun at or before it", () => {
  const epochs = [
    { from: at(0), offsetDeg: 2, frames: 300 },
    { from: at(300), offsetDeg: -1, frames: 300 },
    { from: at(600), offsetDeg: null, frames: 10 },
  ];
  assert(neckRestOffsetAt(epochs, Date.parse(at(100))) === 2, "first calibration");
  assert(neckRestOffsetAt(epochs, Date.parse(at(300))) === -1, "a repetition starting with the second calibration takes it");
  assert(neckRestOffsetAt(epochs, Date.parse(at(-1))) === null, "before any calibration: none");
  assert(neckRestOffsetAt(epochs, Date.parse(at(700))) === null, "a calibration without a usable reading gives none");
  assert(neckRestOffsetAt(null, Date.parse(at(100))) === null, "no record: none");
  assert(neckRestOffsetAt(epochs, null) === null, "no start time: none");
});

test("left peaks lose the still-head reading and right peaks gain it", () => {
  assert(neckRestPeak("left", 44, 2) === 42, "left");
  assert(neckRestPeak("right", 46, 2) === 48, "right");
  assert(neckRestPeak("left", 33.5, -4) === 37.5, "a reading toward the right raises left peaks");
});

test("the breakdown measures neck peaks and completion from the resting position", () => {
  const detail = neckDetail(withRest(-4));
  near(measureFromDetail(detail, "peak", "left").value, (32 + 38 + 34 + 36) / 4, "left peak");
  near(measureFromDetail(detail, "peak", "right").value, (44 + 46 + 42 + 40) / 4, "right peak");
  assert(measureFromDetail(detail, "peak", "left").units === 4, "every repetition counts");
  near(measureFromDetail(detail, "completionPct", "left").value, 100, "28 saved (partial) is 32 from rest: complete");
  const rows = repRows(detail, "left", []);
  assert(rows[0].peak === 32 && rows[0].complete, "the row shows the corrected peak and completion");
  assert(rows.every((r) => r.leftOut !== "no-rest-reference"), "nothing left out");
  assert(JSON.stringify(neckRestOffsets(detail)) === "[-4]", "the breakdown can say what was taken off");
});

test("neck repetitions without a resting reading count in no peak measure, but timing still counts", () => {
  for (const detail of [neckDetail(null), neckDetail(withRest(null))]) {
    const peak = measureFromDetail(detail, "peak", "left");
    assert(peak.value === null && peak.units === 0, "no peak");
    assert(measureFromDetail(detail, "completionPct", "left").units === 0, "no completion");
    assert(measureFromDetail(detail, "peakSpread", "right").units === 0, "no spread");
    assert(measureFromDetail(detail, "raisingS", "left").units === 2, "timing skips only each set's first repetition");
    const rows = repRows(detail, "left", []);
    assert(rows[1].peak === 34 && rows[1].leftOut === "no-rest-reference", "the saved peak is shown and marked");
  }
});

test("other exercises read as saved, whatever the record says", () => {
  const detail = neckDetail(withRest(-4), "ex_001");
  near(measureFromDetail(detail, "peak", "left").value, (28 + 34 + 30 + 32) / 4, "saved peaks");
  near(measureFromDetail(detail, "completionPct", "left").value, 75, "saved classification");
  assert(neckRestOffsets(detail) === null, "no caption");
});

test("the capture summary keeps each calibration's median still-head reading, or none below the minimum", () => {
  const many = Array.from({ length: NECK_REST_MIN_FRAMES + 1 }, (_, i) => (i % 2 === 0 ? -4 : -3.9));
  const record = neckRestRecordFromTally({
    epochs: [{ from: at(0), readings: many }, { from: at(300), readings: [1, 2, 3] }],
  });
  assert(record !== null && record.rule === NECK_REST_RULE, "a record");
  assert(record.epochs[0].offsetDeg === -4 && record.epochs[0].frames === NECK_REST_MIN_FRAMES + 1, "median of the first");
  assert(record.epochs[1].offsetDeg === null && record.epochs[1].frames === 3, "too few frames: no reading");
  assert(neckRestRecordFromTally({ epochs: [] }) === null, "no calibration: no record");
  const summary = buildCaptureQualitySummary({
    total: 10, ok: 9, rejectedByStatus: {}, dropoutResets: 0,
    neckRest: { epochs: [{ from: at(0), readings: many }] },
  });
  const parsed = parseCaptureQualitySummary(JSON.parse(JSON.stringify(summary)));
  assert(parsed?.neckRest?.epochs[0].offsetDeg === -4, "the record survives saving and reading");
  for (const bad of [
    { rule: "other", epochs: [] },
    { rule: NECK_REST_RULE, epochs: [{ from: "yesterday", offsetDeg: 1, frames: 40 }] },
    { rule: NECK_REST_RULE, epochs: [{ from: at(0), offsetDeg: 90, frames: 40 }] },
    { rule: NECK_REST_RULE, epochs: [{ from: at(0), offsetDeg: 1, frames: -1 }] },
  ]) {
    assert(parseNeckRestRecord(bad) === null, `rejected: ${JSON.stringify(bad)}`);
  }
});

function session(trend: Partial<TrendRepSummary>, plain: Partial<TrendModelSession> = {}): TrendModelSession {
  return {
    exerciseKind: "dynamic", setCount: 2, leftReps: 10, rightReps: 10, completeLeftReps: 9, completeRightReps: 10,
    avgLeftPeakValue: 35, avgRightPeakValue: 48, ...plain,
    trend: {
      rulesVersion: "trend_rules_v2", leftReps: 10, rightReps: 10, completeLeftReps: 10, completeRightReps: 10,
      avgLeftPeakValue: 40, avgRightPeakValue: 44, sdLeftPeakValue: 1, sdRightPeakValue: 1,
      avgLeftFormScore: null, avgRightFormScore: null, leftFormReps: 0, rightFormReps: 0,
      avgLeftLoweringMs: null, avgRightLoweringMs: null, avgLeftRaisingMs: null, avgRightRaisingMs: null,
      leftTimingReps: 8, rightTimingReps: 8, trackedReps: 20, poorlyTrackedReps: 0,
      peakLeftReps: 10, peakRightReps: 10, ...trend,
    },
  };
}

test("the charts count neck peak measures over the repetitions that have a resting reading", () => {
  const partly = session({ peakLeftReps: 6, completeLeftReps: 3 });
  assert(sessionMeasure(partly, "peak", "left").units === 6, "peak units");
  near(sessionMeasure(partly, "completionPct", "left").value, 50, "3 of the 6 measured");
  const before = session({}, {});
  delete before.trend!.peakLeftReps;
  delete before.trend!.peakRightReps;
  assert(sessionMeasure(before, "peak", "left").units === 10, "a v1 summary counts every repetition");
});

test("a neck session without any resting reading is drawn hollow at its saved value", () => {
  const measured = session({});
  const without = session({ peakLeftReps: 0, peakRightReps: 0, avgLeftPeakValue: null, avgRightPeakValue: null,
    completeLeftReps: 0, completeRightReps: 0 });
  const series = prepareModelSeries("ex_004", [measured, without], "peak", "left");
  assert(series.values[0] === 40 && series.values[1] === null, `values ${JSON.stringify(series.values)}`);
  assert(series.heldOut[1]?.value === 35, "the saved value");
  assert(/resting head position/.test(series.heldOut[1]?.reason ?? ""), "with the reason");
  const timing = prepareModelSeries("ex_004", [measured, without], "raisingS", "left");
  assert(timing.heldOut.every((h) => h === null), "timing is not affected");
  const other = prepareModelSeries("ex_001", [measured, without], "peak", "left");
  assert(other.heldOut.every((h) => h === null), "rule 4 applies to the neck side bend only");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exitCode = 1;
