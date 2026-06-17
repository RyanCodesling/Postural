/**
 * peakRelevantGating.test.ts
 *
 * Tests for `isNearPeak` and the peak-gated compensation-warning behaviour it
 * drives. Background: the `elbowFlexion` ("Straighten arms") compensation on
 * ex_007 Overhead Shoulder Press and ex_008 Wall Angels must only warn near
 * the top of the movement — bent elbows are CORRECT form at the bottom/ascent
 * (ex_007) and the W-position (ex_008), so an always-on warning fired through
 * the whole lower portion of every rep. These metrics are tagged
 * `peakRelevant: true` in the registry, and their warning is suppressed unless
 * `isNearPeak` is true.
 *
 * USAGE
 * ─────
 *   npx tsx web/src/lib/pose/peakRelevantGating.test.ts
 *
 * Same minimal-deps style as `elbowFlexion.test.ts` — no test framework, just
 * inline assertion helpers.
 *
 * COMPOSED WARNING SEMANTICS (what the UI actually does)
 * ──────────────────────────────────────────────────────
 * Both surfaces (canvas overlay + clinical card) reduce to the same rule for a
 * `peakRelevant` "below"-direction metric:
 *
 *   shouldWarn = isNearPeak(...) && value < warningThreshold
 *
 *   - overlay: drops `peakRelevant` specs from its list when !isNearPeak.
 *   - card:    sets `suppressWarning = peakRelevant && !isNearPeak`, which
 *              forces `isFlag` false.
 *
 * `composedShouldWarn` below mirrors that rule against the REAL registry flags
 * and the REAL `isNearPeak`, so a regression in either surface's intent shows
 * up here.
 */

import { isNearPeak, PEAK_GATE_FRACTION } from "./poseMetrics";
import {
  EXERCISE_REGISTRY,
  type CompensationMetricSpec,
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

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Find a compensation spec by metric name on a given exercise. */
function comp(def: ExerciseDefinition, name: string): CompensationMetricSpec {
  const c = def.compensationMetrics.find((x) => x.name === name);
  if (!c) throw new Error(`${def.id} has no ${name} compensation metric`);
  return c;
}

/**
 * Mirrors the effective UI rule for a single compensation spec on a per-limb
 * exercise, given per-side primary readings and the metric's current value.
 */
function composedShouldWarn(
  def: ExerciseDefinition,
  spec: CompensationMetricSpec,
  perSidePrimary: { left: number | null; right: number | null },
  value: number,
): boolean {
  const near = isNearPeak(def, perSidePrimary, null);
  // peakRelevant metrics are gated; others are always evaluated.
  if (spec.peakRelevant && !near) return false;
  const dir = spec.compareDirection ?? "above";
  return dir === "below" ? value < spec.warningThreshold : Math.abs(value) >= spec.warningThreshold;
}

const ex007 = EXERCISE_REGISTRY.ex_007; // primary wristShoulderVertical, targetROM 0.6
const ex008 = EXERCISE_REGISTRY.ex_008; // primary shoulderAbduction,     targetROM 150
const ex001 = EXERCISE_REGISTRY.ex_001; // control: no peakRelevant comps

// ─────────────────────────────────────────────────────────────────────────────
// TESTS — registry wiring
// ─────────────────────────────────────────────────────────────────────────────

console.log("\npeakRelevant gating — registry + isNearPeak + composed warning\n");

test("ex_007 elbowFlexion is tagged peakRelevant", () => {
  assertEq(comp(ex007, "elbowFlexion").peakRelevant, true, "ex_007 elbow peakRelevant");
});

test("ex_008 elbowFlexion is tagged peakRelevant", () => {
  assertEq(comp(ex008, "elbowFlexion").peakRelevant, true, "ex_008 elbow peakRelevant");
});

test("ex_007 trunkLean is NOT peakRelevant (deviation metric, always-on)", () => {
  assertEq(comp(ex007, "trunkLean").peakRelevant ?? false, false, "ex_007 trunk peakRelevant");
});

test("ex_001 compensations are all non-peakRelevant (control)", () => {
  for (const c of ex001.compensationMetrics) {
    assertEq(c.peakRelevant ?? false, false, `ex_001 ${c.name} peakRelevant`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// TESTS — isNearPeak (ex_007, gate = 0.9 × 0.6 = 0.54 trunk-lengths)
// ─────────────────────────────────────────────────────────────────────────────

test("ex_007: both arms above gate → near peak", () => {
  assertEq(isNearPeak(ex007, { left: 0.55, right: 0.55 }, null), true, "0.55/0.55");
});

test("ex_007: both arms below gate → not near peak", () => {
  assertEq(isNearPeak(ex007, { left: 0.2, right: 0.3 }, null), false, "0.2/0.3");
});

test("ex_007: one lagging arm, better arm above gate → near peak (max-of-sides)", () => {
  assertEq(isNearPeak(ex007, { left: 0.1, right: 0.55 }, null), true, "0.1/0.55");
});

test("ex_007: one side null, other above gate → near peak", () => {
  assertEq(isNearPeak(ex007, { left: null, right: 0.55 }, null), true, "null/0.55");
});

test("ex_007: both sides null → not near peak", () => {
  assertEq(isNearPeak(ex007, { left: null, right: null }, null), false, "null/null");
});

test("ex_007: gate is exactly PEAK_GATE_FRACTION × targetROM (inclusive)", () => {
  const gate = PEAK_GATE_FRACTION * 0.6;
  assertEq(isNearPeak(ex007, { left: gate, right: 0 }, null), true, "exactly at gate");
});

// ─────────────────────────────────────────────────────────────────────────────
// TESTS — isNearPeak (ex_008, gate = 0.9 × 150 = 135°)
// ─────────────────────────────────────────────────────────────────────────────

test("ex_008: arms overhead (140°/140°) → near peak", () => {
  assertEq(isNearPeak(ex008, { left: 140, right: 140 }, null), true, "140/140");
});

test("ex_008: mid-slide (90°/100°) → not near peak", () => {
  assertEq(isNearPeak(ex008, { left: 90, right: 100 }, null), false, "90/100");
});

// ─────────────────────────────────────────────────────────────────────────────
// TESTS — composed warning (the behaviour patients/therapists actually see)
// ─────────────────────────────────────────────────────────────────────────────

test("ex_007: bent elbow at the BOTTOM of the press → no 'Straighten arms'", () => {
  const elbow = comp(ex007, "elbowFlexion");
  // arms low (max 0.2 < 0.54 gate), elbow bent 90° (< 150 threshold)
  assertEq(composedShouldWarn(ex007, elbow, { left: 0.2, right: 0.2 }, 90), false, "bent + low");
});

test("ex_007: bent elbow at the TOP of the press → warns (incomplete extension)", () => {
  const elbow = comp(ex007, "elbowFlexion");
  // arms high (0.55 >= 0.54 gate), elbow still bent 90° → flag
  assertEq(composedShouldWarn(ex007, elbow, { left: 0.55, right: 0.55 }, 90), true, "bent + high");
});

test("ex_007: straight elbow at the TOP → no warning", () => {
  const elbow = comp(ex007, "elbowFlexion");
  // arms high (0.55 >= 0.54 gate), elbow straight 175° (>= 150) → no flag
  assertEq(composedShouldWarn(ex007, elbow, { left: 0.55, right: 0.55 }, 175), false, "straight + high");
});

test("ex_008: bent elbow in the W-position → no warning; bent at Y-position → warns", () => {
  const elbow = comp(ex008, "elbowFlexion");
  assertEq(composedShouldWarn(ex008, elbow, { left: 90, right: 90 }, 95), false, "W-position bent");
  assertEq(composedShouldWarn(ex008, elbow, { left: 140, right: 140 }, 95), true, "Y-position bent");
});

test("ex_007: trunkLean (non-peakRelevant) warns regardless of peak position", () => {
  const trunk = comp(ex007, "trunkLean"); // warningThreshold 5, direction "above"
  // Low arms (not near peak) — a real trunk lean must STILL flag.
  assertEq(composedShouldWarn(ex007, trunk, { left: 0.0, right: 0.0 }, 8), true, "lean + low");
  assertEq(composedShouldWarn(ex007, trunk, { left: 0.0, right: 0.0 }, 2), false, "no lean + low");
});

// ─────────────────────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n  ${testsPassed} passed, ${testsFailed} failed\n`);
process.exit(testsFailed === 0 ? 0 : 1);
