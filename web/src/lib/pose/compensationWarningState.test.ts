/**
 * compensationWarningState.test.ts
 *
 * Tests the display-only hysteresis/debounce latch used by the camera's
 * compensation warning cards and canvas overlay.
 *
 * USAGE
 *   npx tsx web/src/lib/pose/compensationWarningState.test.ts
 */

import type { CompensationMetricSpec } from "@/lib/exercises/registry";
import {
  COMPENSATION_WARNING_DEBOUNCE_MS,
  compensationWarningMargin,
  updateCompensationWarningLatch,
  updateCompensationWarningMap,
  type CompensationWarningLatch,
} from "./compensationWarningState";

let testsPassed = 0;
let testsFailed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  PASS ${name}`);
    testsPassed += 1;
  } catch (err) {
    console.log(`  FAIL ${name}`);
    console.log(`      ${err instanceof Error ? err.message : String(err)}`);
    testsFailed += 1;
  }
}

function assertEq(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertClose(actual: number, expected: number, label: string): void {
  if (Math.abs(actual - expected) > 1e-9) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

const trunkLean: CompensationMetricSpec = {
  name: "trunkLean",
  warningThreshold: 5,
};

const elbowFlexion: CompensationMetricSpec = {
  name: "elbowFlexion",
  warningThreshold: 150,
  compareDirection: "below",
  peakRelevant: true,
};

const scapularElevation: CompensationMetricSpec = {
  name: "scapularElevation",
  warningThreshold: 0.04,
};

function update(
  latch: CompensationWarningLatch | undefined,
  spec: CompensationMetricSpec,
  value: number | null,
  nowMs: number,
): CompensationWarningLatch {
  return updateCompensationWarningLatch(latch, spec, value, nowMs);
}

console.log("\ncompensation warning hysteresis/debounce\n");

test("above-threshold warnings require the debounce window before turning on", () => {
  let latch: CompensationWarningLatch | undefined;
  latch = update(latch, trunkLean, 5.2, 0);
  assertEq(latch.active, false, "initial trigger is pending");

  latch = update(latch, trunkLean, 5.2, COMPENSATION_WARNING_DEBOUNCE_MS - 1);
  assertEq(latch.active, false, "still pending before debounce");

  latch = update(latch, trunkLean, 5.2, COMPENSATION_WARNING_DEBOUNCE_MS);
  assertEq(latch.active, true, "active after debounce");
});

test("above-threshold warnings stay active in the deadband and clear after debounce", () => {
  let latch = update(undefined, trunkLean, 6, 0);
  latch = update(latch, trunkLean, 6, COMPENSATION_WARNING_DEBOUNCE_MS);
  assertEq(latch.active, true, "setup active");

  latch = update(latch, trunkLean, 4, 450);
  assertEq(latch.active, true, "deadband value remains active");

  latch = update(latch, trunkLean, 2.4, 600);
  assertEq(latch.active, true, "clear starts pending");
  latch = update(latch, trunkLean, 2.4, 600 + COMPENSATION_WARNING_DEBOUNCE_MS);
  assertEq(latch.active, false, "clear after debounce");
});

test("below-threshold warnings use the opposite trigger and clear bands", () => {
  let latch = update(undefined, elbowFlexion, 145, 0);
  latch = update(latch, elbowFlexion, 145, COMPENSATION_WARNING_DEBOUNCE_MS);
  assertEq(latch.active, true, "bent elbow active after debounce");

  latch = update(latch, elbowFlexion, 151, 450);
  assertEq(latch.active, true, "slightly above threshold remains active in deadband");

  latch = update(latch, elbowFlexion, 153, 600);
  assertEq(latch.active, true, "straight enough starts clear pending");
  latch = update(latch, elbowFlexion, 153, 600 + COMPENSATION_WARNING_DEBOUNCE_MS);
  assertEq(latch.active, false, "below-direction warning clears after debounce");
});

test("suppressed or unavailable metrics clear immediately", () => {
  let latch = update(undefined, elbowFlexion, 145, 0);
  latch = update(latch, elbowFlexion, 145, COMPENSATION_WARNING_DEBOUNCE_MS);
  assertEq(latch.active, true, "setup active");

  latch = updateCompensationWarningLatch(latch, elbowFlexion, 145, 450, {
    suppressed: true,
  });
  assertEq(latch.active, false, "suppressed clears");
  assertEq(latch.pendingActive, null, "suppressed clears pending state");

  latch = update(undefined, trunkLean, 6, 0);
  latch = update(latch, trunkLean, 6, COMPENSATION_WARNING_DEBOUNCE_MS);
  latch = update(latch, trunkLean, null, 450);
  assertEq(latch.active, false, "null value clears");
});

test("normalized metrics get a unit-scaled hysteresis margin", () => {
  assertClose(compensationWarningMargin("scapularElevation", 0.04), 0.008, "scap margin");

  let latch = update(undefined, scapularElevation, 0.05, 0);
  latch = update(latch, scapularElevation, 0.05, COMPENSATION_WARNING_DEBOUNCE_MS);
  assertEq(latch.active, true, "setup active");

  latch = update(latch, scapularElevation, 0.035, 450);
  assertEq(latch.active, true, "normalized deadband remains active");

  latch = update(latch, scapularElevation, 0.031, 600);
  latch = update(latch, scapularElevation, 0.031, 600 + COMPENSATION_WARNING_DEBOUNCE_MS);
  assertEq(latch.active, false, "normalized clear after debounce");
});

test("map updater returns only latched active warnings and drops stale specs", () => {
  const latches = new Map();
  let active = updateCompensationWarningMap(latches, [trunkLean], { trunkLean: 6 }, 0);
  assertEq(active.has("trunkLean"), false, "pending is not active");
  active = updateCompensationWarningMap(
    latches,
    [trunkLean],
    { trunkLean: 6 },
    COMPENSATION_WARNING_DEBOUNCE_MS,
  );
  assertEq(active.has("trunkLean"), true, "active returned after debounce");

  active = updateCompensationWarningMap(latches, [elbowFlexion], { elbowFlexion: 90 }, 450);
  assertEq(active.has("trunkLean"), false, "stale trunk spec removed");
  assertEq(latches.has("trunkLean"), false, "stale trunk latch removed");
});

console.log(`\n  ${testsPassed} passed, ${testsFailed} failed\n`);
process.exit(testsFailed === 0 ? 0 : 1);
