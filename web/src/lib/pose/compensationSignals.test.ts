/**
 * Run with:
 *   npx tsx src/lib/pose/compensationSignals.test.ts
 */
import type { CompensationMetricSpec } from "@/lib/exercises/registry";
import {
  perLimbCompensationWarningSignal,
  singleCompensationWarningSignal,
} from "./compensationSignals";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const coupled: CompensationMetricSpec = {
  name: "scapularElevation",
  warningThreshold: 0.04,
  scoring: {
    mode: "primary-coupled",
    intercept: 0,
    slopePerPrimaryUnit: 0.001,
    source: "pilot-fit",
  },
};

const clean = singleCompensationWarningSignal(coupled, 0.09, 90);
assert(Math.abs(clean.value ?? 1) < 1e-9, "expected clean residual is not zero");
assert(
  singleCompensationWarningSignal(coupled, 0.09, null).value === null,
  "missing coupled primary must suppress the signal",
);

const leftOnly = perLimbCompensationWarningSignal(coupled, "left", {
  leftValue: 0.14,
  leftPrimary: 90,
  rightValue: 0.2,
  rightPrimary: 90,
});
assert(leftOnly.side === "left", "left prescription selected the wrong side");
assert(
  Math.abs((leftOnly.value ?? 0) - 0.05) < 1e-9,
  "left residual is incorrect",
);

const rightOnly = perLimbCompensationWarningSignal(coupled, "right", {
  leftValue: 0.2,
  leftPrimary: 90,
  rightValue: 0.13,
  rightPrimary: 90,
});
assert(rightOnly.side === "right", "right prescription selected the wrong side");

const both = perLimbCompensationWarningSignal(coupled, "both", {
  leftValue: 0.14,
  leftPrimary: 90,
  rightValue: 0.2,
  rightPrimary: 90,
});
assert(both.side === "right", "both prescription did not select worse residual");

const below: CompensationMetricSpec = {
  name: "elbowFlexion",
  warningThreshold: 140,
  compareDirection: "below",
  scoring: { mode: "off" },
};
const belowSignal = perLimbCompensationWarningSignal(below, "both", {
  leftValue: 150,
  leftPrimary: 1,
  rightValue: 120,
  rightPrimary: 1,
});
assert(
  belowSignal.side === "right" && belowSignal.value === 120,
  "below-direction selection did not choose the lower value",
);

console.log("compensationSignals tests passed");
