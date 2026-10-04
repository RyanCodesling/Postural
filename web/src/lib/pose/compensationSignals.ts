import {
  getCompensationScoring,
  type CompensationMetricSpec,
  type MetricName,
} from "@/lib/exercises/registry";
import type { PrescribedSide } from "@/lib/prescriptionContext";
import { compensationWarningIsOneSided } from "./compensationWarningState";
import { compensationDeviation } from "./poseMetrics";

export type CompensationWarningSignal = {
  name: MetricName;
  value: number | null;
  side: "left" | "right" | null;
};

/**
 * `restBelow` is the exercise's repetition start threshold. A `primary-coupled`
 * deviation is only defined while the movement is under way: its expectation
 * comes from in-repetition frames, and the fit's intercept is an
 * extrapolation, not a resting value. Below the start threshold the body is at
 * rest, so the coupled warning value is absent and cannot raise a cue. Warnings
 * only: the score uses `compensationDeviation` directly and is unchanged.
 */
export type CompensationWarningOptions = { restBelow?: number };

function warningDeviation(
  spec: CompensationMetricSpec,
  value: number | null | undefined,
  primary: number | null | undefined,
  options: CompensationWarningOptions,
): number | null {
  if (
    options.restBelow !== undefined &&
    getCompensationScoring(spec).mode === "primary-coupled" &&
    typeof primary === "number" &&
    Math.abs(primary) < options.restBelow
  ) {
    return null;
  }
  return compensationDeviation(spec, value, primary);
}

export function singleCompensationWarningSignal(
  spec: CompensationMetricSpec,
  value: number | null | undefined,
  primary: number | null | undefined,
  options: CompensationWarningOptions = {},
): CompensationWarningSignal {
  return {
    name: spec.name,
    value: warningDeviation(spec, value, primary, options),
    side: null,
  };
}

/**
 * Pair each limb's compensation with its own primary before selecting what the
 * patient sees. A unilateral prescription never inherits the opposite limb's
 * warning; a bilateral prescription surfaces the worse available side. For a
 * one-sided (coupled) warning the worse side is the larger signed excess, so a
 * limb moving less than expected cannot mask a shrug on the other limb.
 */
export function perLimbCompensationWarningSignal(
  spec: CompensationMetricSpec,
  prescribedSide: PrescribedSide,
  input: {
    leftValue: number | null | undefined;
    leftPrimary: number | null | undefined;
    rightValue: number | null | undefined;
    rightPrimary: number | null | undefined;
  },
  options: CompensationWarningOptions = {},
): CompensationWarningSignal {
  const left = warningDeviation(
    spec,
    input.leftValue,
    input.leftPrimary,
    options,
  );
  const right = warningDeviation(
    spec,
    input.rightValue,
    input.rightPrimary,
    options,
  );

  if (prescribedSide === "left") {
    return { name: spec.name, value: left, side: "left" };
  }
  if (prescribedSide === "right") {
    return { name: spec.name, value: right, side: "right" };
  }
  if (left === null) {
    return { name: spec.name, value: right, side: right === null ? null : "right" };
  }
  if (right === null) {
    return { name: spec.name, value: left, side: "left" };
  }
  const direction = spec.compareDirection ?? "above";
  const useLeft =
    direction === "below"
      ? left <= right
      : compensationWarningIsOneSided(spec)
        ? left >= right
        : Math.abs(left) >= Math.abs(right);
  return {
    name: spec.name,
    value: useLeft ? left : right,
    side: useLeft ? "left" : "right",
  };
}
