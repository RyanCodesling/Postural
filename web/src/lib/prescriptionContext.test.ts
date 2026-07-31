/**
 * Regression tests for typed prescription context and trend segmentation.
 * Run with: npx tsx src/lib/prescriptionContext.test.ts
 */

import {
  comparableContextKey,
  parsePrescribedSide,
  parseResistanceContext,
  PRESCRIPTION_SNAPSHOT_VERSION,
  REP_QUALITY_VERSION,
  SESSION_CONTEXT_VERSION,
  type SessionContextSnapshot,
} from "./prescriptionContext";
import { POSE_METRIC_ALGORITHM_VERSION } from "./pose/metricVersion";

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

function assertThrows(fn: () => void, message: string): void {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  assert(threw, message);
}

console.log("\nprescriptionContext - validation and comparison keys\n");

test("new prescriptions default to both sides with explicit no resistance", () => {
  assert(parsePrescribedSide(undefined) === "both", "side default must be both");
  const resistance = parseResistanceContext({});
  assert(resistance.type === "none", "resistance default must be explicit none");
});

test("external weight requires a positive typed load", () => {
  const resistance = parseResistanceContext({
    resistanceType: "external_weight",
    resistanceValue: "2.5",
    resistanceUnit: "kg",
  });
  assert(resistance.value === 2.5, "numeric string must normalize to a number");
  assert(resistance.unit === "kg", "load unit must be preserved");
  assertThrows(
    () =>
      parseResistanceContext({
        resistanceType: "external_weight",
        resistanceValue: 0,
        resistanceUnit: "kg",
      }),
    "zero external load must be rejected",
  );
});

test("legacy unknown resistance cannot enter a new prescription", () => {
  assertThrows(
    () => parseResistanceContext({ resistanceType: "unknown" }),
    "unknown must remain migration-only",
  );
  assert(
    parseResistanceContext(
      { resistanceType: "unknown" },
      { allowUnknown: true },
    ).type === "unknown",
    "legacy readback must support unknown",
  );
});

test("trend comparison key changes with side, load, or exercise config", () => {
  const base = {
    exerciseId: "ex_001",
    prescribedSide: "both" as const,
    resistance: {
      type: "none" as const,
      value: null,
      unit: null,
      label: null,
    },
    exerciseConfigVersion: "sha256:a",
  };
  const key = comparableContextKey(base);
  assert(
    key !== comparableContextKey({ ...base, prescribedSide: "left" }),
    "side changes must segment trends",
  );
  assert(
    key !==
      comparableContextKey({
        ...base,
        resistance: {
          type: "external_weight",
          value: 2,
          unit: "kg",
          label: null,
        },
      }),
    "load changes must segment trends",
  );
  assert(
    key !== comparableContextKey({ ...base, exerciseConfigVersion: "sha256:b" }),
    "config changes must segment trends",
  );
});

test("new session context records the pose and rep-quality contract versions", () => {
  assert(SESSION_CONTEXT_VERSION === 2, "new context writes must use version 2");
  assert(PRESCRIPTION_SNAPSHOT_VERSION === 2, "new prescription snapshots must use version 2");
  assert(
    REP_QUALITY_VERSION === "dynamic_rep_quality_v2",
    "new context must identify rep-quality V2",
  );

  const context: SessionContextSnapshot = {
    version: SESSION_CONTEXT_VERSION,
    capturedAt: "2026-07-29T00:00:00.000Z",
    prescription: {
      version: PRESCRIPTION_SNAPSHOT_VERSION,
      capturedAt: "2026-07-29T00:00:00.000Z",
      patientExerciseId: 1,
      exerciseId: "ex_001",
      sets: 1,
      reps: 2,
      restSeconds: 30,
      holdSeconds: 0,
      sequenceIndex: 1,
      prescribedSide: "left",
      resistance: { type: "none", value: null, unit: null, label: null },
      schedule: { dueDate: "2026-07-29", makeupUntil: "2026-07-30" },
    },
    schedule: {
      dueDate: "2026-07-29",
      makeupUntil: "2026-07-30",
      startedDuringMakeupWindow: false,
    },
    exercise: {
      id: "ex_001",
      name: "Lateral Arm Raises",
      kind: "dynamic",
      bilateralMode: "per-limb",
      definition: {},
      effectiveCompensationBands: {},
    },
    versions: {
      registry: "registry",
      exerciseConfig: "config",
      appRevision: "test",
      poseMetrics: POSE_METRIC_ALGORITHM_VERSION,
      repQuality: REP_QUALITY_VERSION,
      model: null,
    },
  };

  assert(context.version === 2, "V2 context should satisfy the compatibility union");
  assert(
    context.versions.poseMetrics === POSE_METRIC_ALGORITHM_VERSION,
    "pose version must be persisted with the context",
  );
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exitCode = 1;
