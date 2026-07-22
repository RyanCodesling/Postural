/**
 * Dynamic per-repetition quality regression tests.
 *
 * USAGE
 *   npx tsx src/lib/pose/repQuality.test.ts
 */

import { EXERCISE_REGISTRY, getCompensationScoring } from "@/lib/exercises/registry";
import type { RepEvent } from "./repCounter";
import {
  DynamicRepQualityBuffer,
  isDynamicRepQualityV1,
  type DynamicRepQualitySample,
} from "./repQuality";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`      ${error instanceof Error ? error.message : String(error)}`);
    failed += 1;
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function assertClose(
  actual: number,
  expected: number,
  tolerance: number,
  label: string,
): void {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label}: expected ${expected} ± ${tolerance}, got ${actual}`);
  }
}

function event(startTimeMs = 0, endTimeMs = 1000): RepEvent {
  return {
    index: 1,
    startTimeMs,
    peakTimeMs: startTimeMs + (endTimeMs - startTimeMs) / 2,
    endTimeMs,
    peakValue: 50,
    ascentDurationMs: (endTimeMs - startTimeMs) / 2,
    holdDurationMs: 0,
    descentDurationMs: (endTimeMs - startTimeMs) / 2,
    totalDurationMs: endTimeMs - startTimeMs,
    classification: "partial",
  };
}

const scoredEx001 = EXERCISE_REGISTRY.ex_001.compensationMetrics.filter(
  (spec) => getCompensationScoring(spec).mode !== "off",
);

function triangleSamples(
  liveScore: (tMs: number) => number | null,
): DynamicRepQualitySample[] {
  return Array.from({ length: 11 }, (_, index) => {
    const tMs = index * 100;
    const rawPrimary = tMs <= 500 ? tMs / 10 : (1000 - tMs) / 10;
    return {
      tMs,
      rawPrimary,
      liveScore: liveScore(tMs),
      rawRuleScore: 70,
      rawCompensations: {
        trunkLean: tMs / 100,
        scapularElevation: tMs / 20_000,
        shoulderSymmetry: 2,
      },
    };
  });
}

console.log("\nDynamicRepQualityBuffer — raw/live separation tests\n");

test("live score is duration-weighted rather than sample-count weighted", () => {
  const buffer = new DynamicRepQualityBuffer();
  buffer.add("single", {
    tMs: 0,
    rawPrimary: 0,
    liveScore: 100,
    rawRuleScore: 90,
    rawCompensations: { trunkLean: 0 },
  });
  buffer.add("single", {
    tMs: 100,
    rawPrimary: 20,
    liveScore: 80,
    rawRuleScore: 80,
    rawCompensations: { trunkLean: 2 },
  });
  buffer.add("single", {
    tMs: 300,
    rawPrimary: 0,
    liveScore: 40,
    rawRuleScore: 70,
    rawCompensations: { trunkLean: 4 },
  });
  const quality = buffer.finalize("single", event(0, 300), scoredEx001);
  assert(quality.liveRule !== null, "expected liveRule summary");
  assertClose(quality.liveRule!.meanScore, 53.33, 0.01, "weighted mean");
  assert(quality.liveRule!.minScore === 40, "minimum score should be 40");
  assert(quality.liveRule!.scoredDurationMs === 300, "duration should be 300 ms");
  assert(quality.liveRule!.coveragePct === 100, "coverage should be 100%");
  assert(quality.rawRule !== null, "expected rawRule summary");
  assertClose(quality.rawRule!.meanScore, 73.33, 0.01, "raw weighted mean");
});

test("raw features use raw samples and match the versioned ML feature contract", () => {
  const buffer = new DynamicRepQualityBuffer();
  for (const sample of triangleSamples(() => 90)) buffer.add("left", sample);
  const quality = buffer.finalize("left", event(), scoredEx001);
  const raw = quality.rawFeatures;
  assert(raw !== null, "expected raw features");
  assert(raw!.source === "raw-unsmoothed", "raw source tag changed");
  assert(raw!.boundarySource === "smoothed-rep-counter", "boundary source changed");
  assert(raw!.featureDefinition === "ml.features.extract.rep-v1", "feature version changed");
  assert(raw!.resampledHz === 30, "expected 30 Hz resampling");
  assert(raw!.coveragePct === 100, "expected full raw coverage");
  assert(raw!.mlEligible, "full-coverage rep should be ML eligible");
  assert(
    raw!.scoredCompensationNames.length === scoredEx001.length,
    "expected scored compensation manifest",
  );
  assert(raw!.sampleCount === 11, "original sample count changed");
  assert(typeof raw!.negLogDimensionlessJerk === "number", "jerk feature missing");
  assert(raw!.shapeP50 > 0.9, "triangle midpoint should be near peak");
  assert(raw!.compensations.trunkLean !== undefined, "trunkLean aggregate missing");
  assert(isDynamicRepQualityV1(quality), "generated payload should pass API validation");

  const missingChannel = new DynamicRepQualityBuffer();
  for (const sample of triangleSamples(() => 90)) {
    missingChannel.add("single", {
      ...sample,
      rawCompensations: { trunkLean: sample.rawCompensations.trunkLean },
    });
  }
  const incomplete = missingChannel.finalize("single", event(), scoredEx001);
  assert(
    incomplete.rawFeatures?.mlEligible === false,
    "missing scored compensation channel should block ML eligibility",
  );
});

test("changing the smoothed live score cannot alter raw ML features", () => {
  const clean = new DynamicRepQualityBuffer();
  const poor = new DynamicRepQualityBuffer();
  for (const sample of triangleSamples(() => 95)) clean.add("single", sample);
  for (const sample of triangleSamples(() => 25)) poor.add("single", sample);
  const cleanQuality = clean.finalize("single", event(), scoredEx001);
  const poorQuality = poor.finalize("single", event(), scoredEx001);
  assert(
    JSON.stringify(cleanQuality.rawFeatures) === JSON.stringify(poorQuality.rawFeatures),
    "raw features changed with live score",
  );
  assert(
    JSON.stringify(cleanQuality.rawRule) === JSON.stringify(poorQuality.rawRule),
    "raw rule aggregate changed with live score",
  );
  assert(
    cleanQuality.liveRule?.meanScore !== poorQuality.liveRule?.meanScore,
    "live rule summaries should remain independent",
  );
});

test("left and right quality channels remain isolated", () => {
  const buffer = new DynamicRepQualityBuffer();
  for (const sample of triangleSamples(() => 90)) {
    buffer.add("left", sample);
    buffer.add("right", {
      ...sample,
      rawCompensations: { ...sample.rawCompensations, trunkLean: 20 },
    });
  }
  const left = buffer.finalize("left", event(), scoredEx001);
  const right = buffer.finalize("right", event(), scoredEx001);
  const leftLean = left.rawFeatures?.compensations.trunkLean?.meanAbs;
  const rightLean = right.rawFeatures?.compensations.trunkLean?.meanAbs;
  assert(typeof leftLean === "number" && typeof rightLean === "number", "missing side aggregates");
  assert(rightLean! > leftLean!, "right-side samples leaked into left-side aggregate");
});

test("long raw-sample gaps are retained as low coverage and marked ineligible", () => {
  const buffer = new DynamicRepQualityBuffer();
  buffer.add("single", {
    tMs: 0,
    rawPrimary: 0,
    liveScore: 90,
    rawRuleScore: 90,
    rawCompensations: { trunkLean: 0 },
  });
  buffer.add("single", {
    tMs: 1000,
    rawPrimary: 0,
    liveScore: 90,
    rawRuleScore: 90,
    rawCompensations: { trunkLean: 0 },
  });
  const raw = buffer.finalize("single", event(), scoredEx001).rawFeatures;
  assert(raw !== null, "coverage metadata should still be persisted");
  assert(raw!.coveragePct < 80, "long gap should reduce coverage");
  assert(!raw!.mlEligible, "low-coverage rep must not be ML eligible");
});

test("reset discards in-progress raw samples", () => {
  const buffer = new DynamicRepQualityBuffer();
  for (const sample of triangleSamples(() => 90)) buffer.add("single", sample);
  buffer.reset();
  const quality = buffer.finalize("single", event(), scoredEx001);
  assert(quality.liveRule === null, "reset should clear live samples");
  assert(quality.rawRule === null, "reset should clear raw score samples");
  assert(quality.rawFeatures === null, "reset should clear raw samples");
});

test("validator rejects malformed or oversized payloads", () => {
  assert(!isDynamicRepQualityV1({ version: 1, liveRule: null }), "missing rawFeatures accepted");
  assert(
    !isDynamicRepQualityV1({
      version: 1,
      liveRule: { meanScore: 101, minScore: 0, scoredDurationMs: 1, coveragePct: 1 },
      rawRule: null,
      rawFeatures: null,
    }),
    "out-of-range score accepted",
  );
  assert(
    !isDynamicRepQualityV1({
      version: 1,
      liveRule: null,
      rawRule: null,
      rawFeatures: null,
      padding: "x".repeat(40_000),
    }),
    "oversized payload accepted",
  );
  const buffer = new DynamicRepQualityBuffer();
  for (const sample of triangleSamples(() => 90)) buffer.add("single", sample);
  const inconsistent = JSON.parse(
    JSON.stringify(buffer.finalize("single", event(), scoredEx001)),
  ) as Record<string, unknown>;
  (inconsistent.rawFeatures as Record<string, unknown>).mlEligible = false;
  assert(
    !isDynamicRepQualityV1(inconsistent),
    "inconsistent ML eligibility metadata accepted",
  );
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
