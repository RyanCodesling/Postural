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
  compensationWarningIsOneSided,
  cueClearLevel,
  cueTriggerLevel,
  compensationWarningMargin,
  updateCompensationWarningLatch,
  updateCompensationWarningMap,
  warningValueCleared,
  warningValueShortOfTrigger,
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

const coupledScapular: CompensationMetricSpec = {
  name: "scapularElevation",
  warningThreshold: 0.04,
  scoring: { mode: "primary-coupled", intercept: -0.0077, slopePerPrimaryUnit: 0.00124, source: "pilot-fit" },
};

test("coupled residuals warn only on an excess over the expectation", () => {
  assertEq(compensationWarningIsOneSided(coupledScapular), true, "coupled metric is one-sided");
  assertEq(compensationWarningIsOneSided(scapularElevation), false, "static metric stays two-sided");
  assertEq(compensationWarningIsOneSided(elbowFlexion), false, "below-direction metric unchanged");

  let latch = update(undefined, coupledScapular, -0.06, 0);
  latch = update(latch, coupledScapular, -0.06, COMPENSATION_WARNING_DEBOUNCE_MS);
  assertEq(latch.active, false, "a deficit beyond the threshold does not latch");

  let staticLatch = update(undefined, scapularElevation, -0.06, 0);
  staticLatch = update(staticLatch, scapularElevation, -0.06, COMPENSATION_WARNING_DEBOUNCE_MS);
  assertEq(staticLatch.active, true, "a static metric keeps the |value| test");

  latch = update(latch, coupledScapular, 0.05, 400);
  latch = update(latch, coupledScapular, 0.05, 400 + COMPENSATION_WARNING_DEBOUNCE_MS);
  assertEq(latch.active, true, "an excess latches after the debounce");
  latch = update(latch, coupledScapular, -0.06, 800);
  latch = update(latch, coupledScapular, -0.06, 800 + COMPENSATION_WARNING_DEBOUNCE_MS);
  assertEq(latch.active, false, "a swing to a deficit clears it");
});

const triggeredSymmetry: CompensationMetricSpec = {
  name: "shoulderSymmetry",
  warningThreshold: 5,
  cue: { id: "t.shoulder-symmetry", message: "Level your shoulders.", priority: 30, trigger: { on: 7, off: 5 } },
};

test("a cue trigger replaces the warning line for switching on and off", () => {
  assertEq(cueTriggerLevel(triggeredSymmetry), 7, "on level");
  assertEq(cueTriggerLevel(trunkLean), 5, "without a trigger the warning line is used");

  let latch = update(undefined, triggeredSymmetry, 6, 0);
  latch = update(latch, triggeredSymmetry, 6, COMPENSATION_WARNING_DEBOUNCE_MS);
  assertEq(latch.active, false, "6 is past the warning line but below the on level");

  latch = update(latch, triggeredSymmetry, 7.5, 400);
  latch = update(latch, triggeredSymmetry, 7.5, 400 + COMPENSATION_WARNING_DEBOUNCE_MS);
  assertEq(latch.active, true, "on at the trigger level");

  latch = update(latch, triggeredSymmetry, 5.5, 800);
  latch = update(latch, triggeredSymmetry, 5.5, 800 + COMPENSATION_WARNING_DEBOUNCE_MS);
  assertEq(latch.active, true, "stays on above the off level");

  latch = update(latch, triggeredSymmetry, 4.8, 1200);
  latch = update(latch, triggeredSymmetry, 4.8, 1200 + COMPENSATION_WARNING_DEBOUNCE_MS);
  assertEq(latch.active, false, "off at the off level");
});

test("the switch-off level is the cue's off level, else the warning line less the margin", () => {
  assertEq(cueClearLevel(triggeredSymmetry), 5, "trigger off level");
  assertEq(cueClearLevel(trunkLean), 5 - compensationWarningMargin("trunkLean", 5), "warning line less the margin");

  let latch = update(undefined, triggeredSymmetry, 8, 0);
  latch = update(latch, triggeredSymmetry, 8, COMPENSATION_WARNING_DEBOUNCE_MS);
  latch = update(latch, triggeredSymmetry, cueClearLevel(triggeredSymmetry), 400);
  latch = update(latch, triggeredSymmetry, cueClearLevel(triggeredSymmetry), 400 + COMPENSATION_WARNING_DEBOUNCE_MS);
  assertEq(latch.active, false, "the latch switches off at that level");
});

const range = (from: number, to: number, step: number) =>
  Array.from({ length: Math.round((to - from) / step) + 1 }, (_, i) => from + i * step);

test("a value counts as recovered exactly where a latched warning would start to switch off", () => {
  const latched: CompensationWarningLatch = { active: true, pendingActive: null, pendingSinceMs: null };
  const cases: [CompensationMetricSpec, number[]][] = [
    [trunkLean, range(-10, 10, 0.1)],
    [elbowFlexion, range(140, 160, 0.1)],
    [triggeredSymmetry, range(-10, 10, 0.1)],
    [scapularElevation, range(-0.08, 0.08, 0.001)],
    [coupledScapular, range(-0.08, 0.08, 0.001)],
  ];
  for (const [spec, values] of cases) {
    for (const value of values) {
      const switchesOff = !updateCompensationWarningLatch(latched, spec, value, 0, { debounceMs: 0 }).active;
      assertEq(warningValueCleared(spec, value), switchesOff, `${spec.name} at ${value}`);
    }
  }
  assertEq(warningValueCleared(trunkLean, null), false, "no reading is not a recovery");
  assertEq(warningValueCleared(trunkLean, Number.NaN), false, "nor is a reading that is not a number");
});

test("a value is short of its switch-on level exactly where a warning that is off would not switch on", () => {
  const cases: [CompensationMetricSpec, number[]][] = [
    [trunkLean, range(-10, 10, 0.1)],
    [elbowFlexion, range(140, 160, 0.1)],
    [triggeredSymmetry, range(-10, 10, 0.1)],
    [scapularElevation, range(-0.08, 0.08, 0.001)],
    [coupledScapular, range(-0.08, 0.08, 0.001)],
  ];
  for (const [spec, values] of cases) {
    for (const value of values) {
      const switchesOn = updateCompensationWarningLatch(undefined, spec, value, 0, { debounceMs: 0 }).active;
      assertEq(warningValueShortOfTrigger(spec, value), !switchesOn, `${spec.name} at ${value}`);
    }
  }
  assertEq(warningValueShortOfTrigger(trunkLean, null), false, "no reading is not short of it");
  assertEq(warningValueShortOfTrigger(trunkLean, Number.NaN), false, "nor is a reading that is not a number");
});

test("between the switch-off and switch-on levels a warning stays latched but is short of its switch-on level", () => {
  const latched: CompensationWarningLatch = { active: true, pendingActive: null, pendingSinceMs: null };
  assertEq(updateCompensationWarningLatch(latched, triggeredSymmetry, 6, 0, { debounceMs: 0 }).active, true, "6 keeps the latch on");
  assertEq(warningValueShortOfTrigger(triggeredSymmetry, 6), true, "6 is short of the on level of 7");
  assertEq(warningValueCleared(triggeredSymmetry, 6), false, "but not yet back past the off level of 5");
  assertEq(warningValueShortOfTrigger(triggeredSymmetry, 7), false, "7 is at it");
  assertEq(warningValueShortOfTrigger(triggeredSymmetry, -7.5), false, "a two-sided warning counts either side");
});

console.log(`\n  ${testsPassed} passed, ${testsFailed} failed\n`);
process.exit(testsFailed === 0 ? 0 : 1);
