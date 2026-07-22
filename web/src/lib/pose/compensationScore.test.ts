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
 * GLOBAL deduction bands (per metric, linear within band, clamped past last):
 *   trunkLean:          2°→0   5°→35    10°→75   20°→100
 *   shoulderSymmetry:   3°→0   7°→35    12°→75   20°→100
 *   neckTilt:           5°→0   10°→35   20°→75   30°→100
 *   scapularElevation:  0.02→0 0.04→35  0.06→75  0.10→100
 * PER-EXERCISE band overrides (Stage-2 scoring retune):
 *   trunkLean (ex_001, ex_004):        6°→0  10°→35  15°→75  25°→100
 *   shoulderSymmetry (ex_001, ex_006): 7°→0  12°→35  17°→75  25°→100
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
// ex_004's only compensation metric is trunkLean (shoulderSymmetry removed
// 2026-06-11 — assisted-stretch variant); the legacy shoulderSymmetry: null
// inputs below are harmless extra keys the score ignores.
// ─────────────────────────────────────────────────────────────────────────────

test("ex_004 trunkLean override knots: 6°→100, 10°→65, 15°→25, 25°→0, clamp past 25°", () => {
  // ex_004 uses the per-exercise trunkLean override [0,6,10,15,25]→[0,0,35,75,100].
  const score = (v: number) =>
    computeCompensationScore(ex004, { trunkLean: v, shoulderSymmetry: null });
  assertEq(score(6), 100, "6° (dead-band edge)");
  assertEq(score(10), 65, "10°");
  assertEq(score(15), 25, "15°");
  assertEq(score(25), 0, "25°");
  assertEq(score(50), 0, "50° (clamped)");
});

test("ex_004 trunkLean override mid-band: 8° → deduction 17.5 → score 83", () => {
  assertEq(
    computeCompensationScore(ex004, { trunkLean: 8, shoulderSymmetry: null }),
    83,
    "8° (round(82.5) = 83, half-up)",
  );
});

test("negative values are scored by magnitude: −10° trunkLean → 65", () => {
  assertEq(
    computeCompensationScore(ex004, { trunkLean: -10, shoulderSymmetry: null }),
    65,
    "−10° (override knot at 10°)",
  );
});

test("neckTilt static-fallback knots via ex_005 (no primary): 5°→100, 7.5°→83, 10°→65", () => {
  // ex_005 neckTilt is primary-coupled; with NO primaryValue it falls back to
  // static |value|, exercising the global neckTilt knots.
  const score = (v: number) =>
    computeCompensationScore(ex005, { neckTilt: v, scapularElevation: null });
  assertEq(score(5), 100, "5° (dead-band edge)");
  assertEq(score(7.5), 83, "7.5° (round(82.5))");
  assertEq(score(10), 65, "10°");
});

test("scapularElevation static-fallback knot via ex_005 (no primary): 0.04 → 65", () => {
  assertEq(
    computeCompensationScore(ex005, { scapularElevation: 0.04, neckTilt: null }),
    65,
    "0.04 torso-lengths",
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// EQUAL WEIGHTING + NULL REDISTRIBUTION (ex_006: scap + trunkLean + shoulderSym)
// ─────────────────────────────────────────────────────────────────────────────

test("three metrics each at their 35-deduction knot → score 65", () => {
  // scap 0.04 (coupled→static fallback, no primary) → 35; trunkLean 5 (ex_006
  // keeps GLOBAL trunkLean) → 35; shoulderSymmetry 12 (ex_006 uses the floor-7
  // override [0,7,12,17,25], whose 35-knot is at 12°) → 35.
  assertEq(
    computeCompensationScore(ex006, {
      scapularElevation: 0.04,
      trunkLean: 5,
      shoulderSymmetry: 12,
    }),
    65,
    "35 across all three at weight 1/3 each",
  );
});

test("null metric redistributes weight: trunkLean 10° + shoulderSym 3° (scap null) → 63", () => {
  // active = 2 → 50 weight each; deductions 75 and 0 → total 37.5 → round(62.5) = 63
  assertEq(
    computeCompensationScore(ex006, {
      scapularElevation: null,
      trunkLean: 10,
      shoulderSymmetry: 3,
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
  // Badly bent elbows (120° interior, well under the 150° warning threshold)
  // must not move the score; trunkLean 5° at FULL weight → 65, not 83.
  assertEq(
    computeCompensationScore(ex008, { trunkLean: 5, elbowFlexion: 120 }),
    65,
    "trunkLean undiluted",
  );
  assertEq(
    computeCompensationScore(ex008, { trunkLean: 2, elbowFlexion: 30 }),
    100,
    "clean trunk, fully bent elbows → still 100",
  );
});

test("ex_007: same warning-only exclusion as ex_008", () => {
  assertEq(
    computeCompensationScore(ex007, { trunkLean: 5, elbowFlexion: 90 }),
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
  // shoulderSymmetry removed 2026-06-11: ex_004 is the assisted stretch,
  // where a sloped shoulder line is prescribed technique, not compensation.
  assertEq(names(ex004), "trunkLean", "ex_004");
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
  // a static reading of 10° trunkLean would deduct 75.
  assertEq(
    computeCompensationScore(coupledDef, { trunkLean: 10 }, 50),
    100,
    "on the expected line",
  );
});

test("primary-coupled: deduction runs on the residual, not the raw value", () => {
  // value 15, expected 10 → residual 5 → trunkLean deduction 35 → score 65.
  assertEq(
    computeCompensationScore(coupledDef, { trunkLean: 15 }, 50),
    65,
    "residual 5°",
  );
});

test("primary-coupled: primary sign is ignored (|primary|)", () => {
  assertEq(
    computeCompensationScore(coupledDef, { trunkLean: 10 }, -50),
    100,
    "negative primary",
  );
});

test("primary-coupled: missing primary falls back to static |value|", () => {
  // value 15 statically → deduction 87.5 → round(12.5) = 13.
  assertEq(
    computeCompensationScore(coupledDef, { trunkLean: 15 }, null),
    13,
    "null primary",
  );
  assertEq(
    computeCompensationScore(coupledDef, { trunkLean: 15 }),
    13,
    "omitted primary",
  );
});

test("static metrics ignore primaryValue entirely", () => {
  // ex_004 trunkLean is static (override bands, no coupling). 10° → override
  // 35 deduction → 65, with a primary passed the static mode must not consult it.
  assertEq(
    computeCompensationScore(ex004, { trunkLean: 10, shoulderSymmetry: null }, 25),
    65,
    "static unaffected by primary",
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// PER-EXERCISE BAND OVERRIDE
// ─────────────────────────────────────────────────────────────────────────────

test("per-exercise band override: 4° trunk lean deducts under global floor, not under ex_001's", () => {
  // 4° sits above the GLOBAL 2° trunkLean floor (ex_006 still deducts) but
  // below ex_001's overridden 6° floor (no deduction). Isolate trunkLean.
  assertEq(
    computeCompensationScore(ex001, {
      trunkLean: 4,
      scapularElevation: null,
      shoulderSymmetry: null,
    }),
    100,
    "ex_001 override floor 6° → 4° clean",
  );
  assertEq(
    computeCompensationScore(ex006, {
      trunkLean: 4,
      scapularElevation: null,
      shoulderSymmetry: null,
    }),
    77,
    "ex_006 global floor 2° → 4° deducts (round(76.67))",
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// PER-SIDE WORST SCORE (per-limb exercises score each side against its OWN
// primary, then surface the worse side). Uses the synthetic coupledDef
// (intercept 0, slope 0.2, global trunkLean bands).
// ─────────────────────────────────────────────────────────────────────────────

test("worstSideCompensationScore: returns the worse (min) of the two sides", () => {
  // left on its coupled line (residual 0 → 100); right residual 5° → 65.
  assertEq(
    worstSideCompensationScore(coupledDef, { trunkLean: 10 }, 50, { trunkLean: 15 }, 50),
    65,
    "right side governs",
  );
});

test("worstSideCompensationScore: each side uses its OWN primary", () => {
  // Same 12° trunkLean on both, but right's lower primary lowers its expected
  // value (8° vs 12°), so the identical reading scores worse on the right.
  // residual 4° → deduction round((4-2)/(5-2)·35)=23.33 → score 77.
  assertEq(
    worstSideCompensationScore(coupledDef, { trunkLean: 12 }, 60, { trunkLean: 12 }, 40),
    77,
    "lower primary makes the same value look worse",
  );
});

test("worstSideCompensationScore: a null side is ignored; both null → null", () => {
  assertEq(
    worstSideCompensationScore(coupledDef, { trunkLean: null }, 50, { trunkLean: 15 }, 50),
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
// SUMMARY
// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n  ${testsPassed} passed, ${testsFailed} failed\n`);
process.exit(testsFailed === 0 ? 0 : 1);
