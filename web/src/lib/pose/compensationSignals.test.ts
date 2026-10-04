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

// At rest (primary below the repetition start threshold) a coupled warning has
// no value; during the movement it does; a static metric is unaffected.
assert(
  singleCompensationWarningSignal(coupled, 0.09, 3, { restBelow: 5 }).value === null,
  "coupled warning must be absent at rest",
);
assert(
  Math.abs(singleCompensationWarningSignal(coupled, 0.09, 90, { restBelow: 5 }).value ?? 1) < 1e-9,
  "coupled warning must be present during the movement",
);
const staticSpec: CompensationMetricSpec = { name: "trunkLean", warningThreshold: 5 };
assert(
  singleCompensationWarningSignal(staticSpec, 7, 0, { restBelow: 5 }).value === 7,
  "a static metric is unaffected at rest",
);

// Per limb: a resting limb gives no coupled value, so the moving limb is shown.
const oneArmUp = perLimbCompensationWarningSignal(coupled, "both", {
  leftValue: 0.3,
  leftPrimary: 2,
  rightValue: 0.14,
  rightPrimary: 90,
}, { restBelow: 20 });
assert(
  oneArmUp.side === "right" && Math.abs((oneArmUp.value ?? 0) - 0.05) < 1e-9,
  "a resting limb must not be selected",
);

// One-sided worst side: the larger signed excess wins over a larger deficit.
const signed = perLimbCompensationWarningSignal(coupled, "both", {
  leftValue: 0.02,
  leftPrimary: 90,
  rightValue: 0.14,
  rightPrimary: 90,
});
assert(
  signed.side === "right" && Math.abs((signed.value ?? 0) - 0.05) < 1e-9,
  "a deficit on one limb must not mask an excess on the other",
);

console.log("compensationSignals tests passed");
