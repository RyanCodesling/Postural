/**
 * compensationScore.test.ts
 *
 * Regression pins for `computeCompensationScore` — the rule-based 0–100
 * compensation quality score. These cases pin the exact numeric behavior:
 * banded linear interpolation per metric, equal weighting across the metrics
 * available in a frame (weight redistribution when some are null), the
 * null-when-no-signal contract (null ≠ 100), and the rule that warning-only
 * compensation metrics (no scored deduction band) contribute nothing to the
 * score and do not dilute the weighting of scored metrics.
 *
 * The pinned values double as a refactor guard: any change to the scoring
 * code that alters today's numbers fails here loudly.
 *
 * USAGE
 * ─────
 *   npx tsx src/lib/pose/compensationScore.test.ts
 *
 * Same minimal-deps style as the sibling tests — no framework, inline asserts.
 *
 * HAND-DERIVED EXPECTATIONS
 * ─────────────────────────
 * GLOBAL deduction bands (per metric, linear within band, clamped past last),
 * in the aspect-corrected unit since 2026-10-21 (D-48; the pipeline-unit knots
 * they were converted from are in brackets):
 *   trunkLean:          3.6→0  8.8→35   17.4→75  32.9→100   [2, 5, 10, 20]
 *   shoulderSymmetry:   1.7→0  4→35     6.8→75   11.6→100   [3, 7, 12, 20]
 *   neckTilt:           2.8→0  5.7→35   11.6→75  18→100     [5, 10, 20, 30]
 *   scapularElevation:  0.02→0 0.04→35  0.06→75  0.10→100   (unchanged)
 * PER-EXERCISE band overrides (Stage-2 scoring retune):
 *   trunkLean (ex_001, ex_004):        10.6→0  17.4→35  25.5→75  39.7→100   [6, 10, 15, 25]
 *   shoulderSymmetry (ex_001, ex_006): 4→0     6.8→35   9.8→75   14.7→100   [7, 12, 17, 25]
 * Several metrics are now `primary-coupled` (ex_001/ex_006 scap, ex_005
 * neckTilt+scap): with NO primaryValue passed they fall back to static |value|,
 * so the by-name knot pins below still exercise the global knots.
 * score = round(100 − Σ (deduction_i / 100) · (100 / N_available))
 */

import {
  computeCompensationScore,
  worstSideCompensationScore,
} from "./poseMetrics";
import {
  EXERCISE_REGISTRY,
  getCompensationScoring,
  type ExerciseDefinition,
} from "@/lib/exercises/registry";

// ─────────────────────────────────────────────────────────────────────────────
// MICRO ASSERTION HELPER
// ─────────────────────────────────────────────────────────────────────────────

let testsPassed = 0;
let testsFailed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    testsPassed += 1;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`      ${err instanceof Error ? err.message : String(err)}`);
    testsFailed += 1;
  }
}

function assertEq(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const ex001 = EXERCISE_REGISTRY.ex_001;
const ex004 = EXERCISE_REGISTRY.ex_004;
const ex005 = EXERCISE_REGISTRY.ex_005;
const ex006 = EXERCISE_REGISTRY.ex_006;
const ex007 = EXERCISE_REGISTRY.ex_007;
const ex008 = EXERCISE_REGISTRY.ex_008;

// ─────────────────────────────────────────────────────────────────────────────
// BANDED INTERPOLATION VALUES (single active metric → its deduction is the score)
// ex_004 scores trunkLean and shoulderSymmetry (restored 2026-09-24 with the
// active version). The shoulderSymmetry: null inputs below mark that metric
// unavailable, so trunkLean's deduction is the whole score.
// ─────────────────────────────────────────────────────────────────────────────

test("ex_004 trunkLean override knots: 10.6→100, 17.4→65, 25.5→25, 39.7→0, clamp past 39.7", () => {
  // ex_004 uses the per-exercise trunkLean override [0,10.6,17.4,25.5,39.7]→[0,0,35,75,100].
  const score = (v: number) =>
    computeCompensationScore(ex004, { trunkLean: v, shoulderSymmetry: null });
  assertEq(score(10.6), 100, "10.6 (dead-band edge)");
  assertEq(score(17.4), 65, "17.4");
  assertEq(score(25.5), 25, "25.5");
  assertEq(score(39.7), 0, "39.7");
  assertEq(score(60), 0, "60 (clamped)");
});

test("ex_004 weights trunkLean and shoulderSymmetry equally: 17.4 + 6.8 → 65", () => {
  // trunkLean 17.4 → override deduction 35; shoulderSymmetry 6.8 → asymmetric
  // override deduction 35. Each carries half the weight: 100 − 17.5 − 17.5.
  assertEq(computeCompensationScore(ex004, { trunkLean: 17.4, shoulderSymmetry: 6.8 }), 65, "both metrics");
  assertEq(computeCompensationScore(ex004, { trunkLean: 0, shoulderSymmetry: 4 }), 100, "resting asymmetry is free");
});

test("ex_004 trunkLean override mid-band: 14 → deduction 17.5 → score 83", () => {
  assertEq(
    computeCompensationScore(ex004, { trunkLean: 14, shoulderSymmetry: null }),
    83,
    "14, halfway from 10.6 to 17.4 (round(82.5) = 83, half-up)",
  );
});

test("negative values are scored by magnitude: −17.4 trunkLean → 65", () => {
  assertEq(
    computeCompensationScore(ex004, { trunkLean: -17.4, shoulderSymmetry: null }),
    65,
    "−17.4 (override knot at 17.4)",
  );
});

test("primary-coupled ex_005 channels are unavailable without a primary value", () => {
  const score = (v: number) =>
    computeCompensationScore(ex005, { neckTilt: v, scapularElevation: null });
  assertEq(score(5), null, "5°");
  assertEq(score(7.5), null, "7.5°");
  assertEq(score(10), null, "10°");
});

test("primary-coupled scapular elevation is unavailable without a primary value", () => {
  assertEq(
    computeCompensationScore(ex005, { scapularElevation: 0.04, neckTilt: null }),
    null,
    "0.04 torso-lengths",
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// EQUAL WEIGHTING + NULL REDISTRIBUTION (ex_006: scap + trunkLean + shoulderSym)
// ─────────────────────────────────────────────────────────────────────────────

test("three metrics each at their 35-deduction knot → score 65", () => {
  // scap 0.04 (coupled→static fallback, no primary) → 35; trunkLean 8.8 (ex_006
  // keeps GLOBAL trunkLean) → 35; shoulderSymmetry 6.8 (ex_006 uses the floor-4
  // override [0,4,6.8,9.8,14.7], whose 35-knot is at 6.8) → 35.
  assertEq(
    computeCompensationScore(ex006, {
      scapularElevation: 0.04,
      trunkLean: 8.8,
      shoulderSymmetry: 6.8,
    }),
    65,
    "35 across all three at weight 1/3 each",
  );
});

test("null metric redistributes weight: trunkLean 17.4 + shoulderSym 1.7 (scap null) → 63", () => {
  // active = 2 → 50 weight each; deductions 75 and 0 → total 37.5 → round(62.5) = 63
  assertEq(
    computeCompensationScore(ex006, {
      scapularElevation: null,
      trunkLean: 17.4,
      shoulderSymmetry: 1.7,
    }),
    63,
    "two-metric redistribution",
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// NULL CONTRACT (no signal ≠ perfect score)
// ─────────────────────────────────────────────────────────────────────────────

test("all compensation metrics null → null (not 100)", () => {
  assertEq(
    computeCompensationScore(ex004, { trunkLean: null, shoulderSymmetry: null }),
    null,
    "no readings",
  );
});

test("exercise with no compensation metrics → null", () => {
  const bare: ExerciseDefinition = {
    id: "ex_test",
    name: "Test Exercise",
    kind: "dynamic",
    bilateral: false,
    primaryMetric: {
      name: "shoulderAbduction",
      thresholds: {
        startThreshold: 20,
        repCompleteThreshold: 10,
        minimumPeakThreshold: 45,
        targetROM: 90,
      },
    },
    compensationMetrics: [],
  };
  assertEq(computeCompensationScore(bare, {}), null, "empty compensation list");
});

// ─────────────────────────────────────────────────────────────────────────────
// WARNING-ONLY METRICS (ex_007/ex_008 elbowFlexion): excluded from the score
// AND from the weighting — a scored metric alongside one keeps full weight.
// ─────────────────────────────────────────────────────────────────────────────

test("ex_008: elbowFlexion never deducts and never dilutes (trunkLean keeps full weight)", () => {
  // Badly bent elbows (120 interior, well under the warning line) must not
  // move the score; trunkLean 8.8 at FULL weight → 65, not 83.
  assertEq(
    computeCompensationScore(ex008, { trunkLean: 8.8, elbowFlexion: 120 }),
    65,
    "trunkLean undiluted",
  );
  assertEq(
    computeCompensationScore(ex008, { trunkLean: 3.6, elbowFlexion: 30 }),
    100,
    "clean trunk, fully bent elbows → still 100",
  );
});

test("ex_007: same warning-only exclusion as ex_008", () => {
  assertEq(
    computeCompensationScore(ex007, { trunkLean: 8.8, elbowFlexion: 90 }),
    65,
    "trunkLean undiluted",
  );
});

test("only a warning-only metric available → null (no scored signal)", () => {
  assertEq(
    computeCompensationScore(ex008, { trunkLean: null, elbowFlexion: 120 }),
    null,
    "elbowFlexion alone carries no score",
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// REGISTRY SANITY for the cases above (so a registry edit that changes the
// compensation lists makes THIS file fail with a clear message, not silently
// test the wrong thing).
// ─────────────────────────────────────────────────────────────────────────────

test("compensation lists backing these pins are unchanged", () => {
  const names = (d: ExerciseDefinition) => d.compensationMetrics.map((c) => c.name).join(",");
  assertEq(names(ex001), "trunkLean,scapularElevation,shoulderSymmetry", "ex_001");
  // shoulderSymmetry restored 2026-09-24: in the active exercise both
  // shoulders stay level (the former assisted stretch sloped them on purpose).
  assertEq(names(ex004), "trunkLean,shoulderSymmetry", "ex_004");
  assertEq(names(ex005), "neckTilt,scapularElevation", "ex_005");
  assertEq(names(ex006), "scapularElevation,trunkLean,shoulderSymmetry", "ex_006");
  assertEq(names(ex007), "trunkLean,elbowFlexion", "ex_007");
  assertEq(names(ex008), "trunkLean,elbowFlexion", "ex_008");
});

// ─────────────────────────────────────────────────────────────────────────────
// EXPLICIT SCORING MODES
// ─────────────────────────────────────────────────────────────────────────────

test("ex_007/ex_008 elbowFlexion declares scoring mode 'off' explicitly", () => {
  for (const def of [ex007, ex008]) {
    const elbow = def.compensationMetrics.find((c) => c.name === "elbowFlexion");
    if (!elbow) throw new Error(`${def.id} has no elbowFlexion compensation`);
    assertEq(getCompensationScoring(elbow).mode, "off", `${def.id} elbowFlexion`);
  }
});

test("omitted scoring defaults to static", () => {
  const trunk = ex001.compensationMetrics.find((c) => c.name === "trunkLean");
  if (!trunk) throw new Error("ex_001 has no trunkLean compensation");
  assertEq(getCompensationScoring(trunk).mode, "static", "ex_001 trunkLean");
});

// A synthetic exercise whose trunkLean compensation is primary-coupled:
// expected trunkLean = 0 + 0.2 · |primary|. With primary = 50°, expected = 10°.
const coupledDef: ExerciseDefinition = {
  id: "ex_test_coupled",
  name: "Coupled Test Exercise",
  kind: "dynamic",
  bilateral: false,
  primaryMetric: {
    name: "shoulderAbduction",
    thresholds: {
      startThreshold: 20,
      repCompleteThreshold: 10,
      minimumPeakThreshold: 45,
      targetROM: 90,
    },
  },
  compensationMetrics: [
    {
      name: "trunkLean",
      warningThreshold: 5,
      scoring: {
        mode: "primary-coupled",
        intercept: 0,
        slopePerPrimaryUnit: 0.2,
        source: "pilot-fit",
      },
    },
  ],
};

test("primary-coupled: value at the expected line → no deduction", () => {
  // value 10 = expected at primary 50 → residual 0 → score 100, even though
  // a static reading of 10 trunkLean would deduct about 41.
  assertEq(
    computeCompensationScore(coupledDef, { trunkLean: 10 }, 50),
    100,
    "on the expected line",
  );
});

test("primary-coupled: deduction runs on the residual, not the raw value", () => {
  // value 18.8, expected 10 → residual 8.8 → trunkLean deduction 35 → score 65.
  assertEq(
    computeCompensationScore(coupledDef, { trunkLean: 18.8 }, 50),
    65,
    "residual 8.8",
  );
});

test("primary-coupled: primary sign is ignored (|primary|)", () => {
  assertEq(
    computeCompensationScore(coupledDef, { trunkLean: 10 }, -50),
    100,
    "negative primary",
  );
});

test("primary-coupled: missing primary is unavailable instead of using a static fallback", () => {
  assertEq(
    computeCompensationScore(coupledDef, { trunkLean: 15 }, null),
    null,
    "null primary",
  );
  assertEq(
    computeCompensationScore(coupledDef, { trunkLean: 15 }),
    null,
    "omitted primary",
  );
});

test("static metrics ignore primaryValue entirely", () => {
  // ex_004 trunkLean is static (override bands, no coupling). 17.4 → override
  // 35 deduction → 65, with a primary passed the static mode must not consult it.
  assertEq(
    computeCompensationScore(ex004, { trunkLean: 17.4, shoulderSymmetry: null }, 25),
    65,
    "static unaffected by primary",
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// PER-EXERCISE BAND OVERRIDE
// ─────────────────────────────────────────────────────────────────────────────

test("per-exercise band override: 7 trunk lean deducts under global floor, not under ex_001's", () => {
  // 7 sits above the GLOBAL 3.6 trunkLean floor (ex_006 still deducts) but
  // below ex_001's overridden 10.6 floor (no deduction). Isolate trunkLean.
  assertEq(
    computeCompensationScore(ex001, {
      trunkLean: 7,
      scapularElevation: null,
      shoulderSymmetry: null,
    }),
    100,
    "ex_001 override floor 10.6 → 7 clean",
  );
  assertEq(
    computeCompensationScore(ex006, {
      trunkLean: 7,
      scapularElevation: null,
      shoulderSymmetry: null,
    }),
    77,
    "ex_006 global floor 3.6 → 7 deducts (round(77.12))",
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// PER-SIDE WORST SCORE (per-limb exercises score each side against its OWN
// primary, then surface the worse side). Uses the synthetic coupledDef
// (intercept 0, slope 0.2, global trunkLean bands).
// ─────────────────────────────────────────────────────────────────────────────

test("worstSideCompensationScore: returns the worse (min) of the two sides", () => {
  // left on its coupled line (residual 0 → 100); right residual 8.8 → 65.
  assertEq(
    worstSideCompensationScore(coupledDef, { trunkLean: 10 }, 50, { trunkLean: 18.8 }, 50),
    65,
    "right side governs",
  );
});

test("worstSideCompensationScore: each side uses its OWN primary", () => {
  // Same 15 trunkLean on both, but right's lower primary lowers its expected
  // value (8 vs 15), so the identical reading scores worse on the right.
  // residual 7 → deduction (7-3.6)/(8.8-3.6)·35 = 22.88 → score 77.
  assertEq(
    worstSideCompensationScore(coupledDef, { trunkLean: 15 }, 75, { trunkLean: 15 }, 40),
    77,
    "lower primary makes the same value look worse",
  );
});

test("worstSideCompensationScore: a null side is ignored; both null → null", () => {
  assertEq(
    worstSideCompensationScore(coupledDef, { trunkLean: null }, 50, { trunkLean: 18.8 }, 50),
    65,
    "left null → right governs",
  );
  assertEq(
    worstSideCompensationScore(coupledDef, { trunkLean: null }, 50, { trunkLean: null }, 50),
    null,
    "both null → null",
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// MEASURES LEFT OUT OF THE FORM SCORE (excludedFromFormScore, 2026-10-14)
// ─────────────────────────────────────────────────────────────────────────────
// ex_005 neckTilt and scapularElevation and ex_006 scapularElevation cannot
// identify a fault on those exercises (their cues are hidden for that reason),
// so they no longer cost points or take a share of the weight. They are still
// recorded in the raw features, which follow the scoring mode.

test("the three measures left out of the form score are declared with a reason and a date", () => {
  const excluded = (d: ExerciseDefinition) =>
    d.compensationMetrics.filter((c) => c.excludedFromFormScore).map((c) => c.name).join(",");
  assertEq(excluded(ex005), "neckTilt,scapularElevation", "ex_005");
  assertEq(excluded(ex006), "scapularElevation", "ex_006");
  for (const d of [ex001, ex004, ex007, ex008]) assertEq(excluded(d), "", d.id);
  for (const d of [ex005, ex006]) {
    for (const c of d.compensationMetrics.filter((m) => m.excludedFromFormScore)) {
      assertEq(c.excludedFromFormScore?.since, "2026-10-14", `${d.id} ${c.name} since`);
      assertEq((c.excludedFromFormScore?.reason ?? "").length > 20, true, `${d.id} ${c.name} reason`);
      // Still recorded: the raw features keep every metric whose mode is not "off".
      assertEq(getCompensationScoring(c).mode, "primary-coupled", `${d.id} ${c.name} keeps its scoring mode`);
    }
  }
});

test("ex_005 has no scored measure left: null even with a primary and large readings", () => {
  assertEq(computeCompensationScore(ex005, { neckTilt: 60, scapularElevation: 0.3 }, 20), null, "large readings");
  assertEq(computeCompensationScore(ex005, { neckTilt: 0, scapularElevation: 0 }, 20), null, "zero readings");
});

test("ex_006 shoulder height neither deducts nor dilutes: any value scores as if it were null", () => {
  // trunkLean 17.4 (global band, 75) and shoulderSymmetry 1.7 (override floor 4, 0)
  // at 50 weight each: total 37.5, round(62.5) = 63, the two-metric value pinned above.
  for (const scap of [null, 0, 0.04, 0.1, 0.3]) {
    assertEq(
      computeCompensationScore(ex006, { scapularElevation: scap, trunkLean: 17.4, shoulderSymmetry: 1.7 }, 90),
      63,
      `scap ${scap}`,
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n  ${testsPassed} passed, ${testsFailed} failed\n`);
process.exit(testsFailed === 0 ? 0 : 1);
