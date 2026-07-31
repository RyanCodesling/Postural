import type {
  CompensationMetricSpec,
  MetricName,
} from "@/lib/exercises/registry";
import type { PrescribedSide } from "@/lib/prescriptionContext";
import { compensationDeviation } from "./poseMetrics";

export type CompensationWarningSignal = {
  name: MetricName;
  value: number | null;
  side: "left" | "right" | null;
};

export function singleCompensationWarningSignal(
  spec: CompensationMetricSpec,
  value: number | null | undefined,
  primary: number | null | undefined,
): CompensationWarningSignal {
  return {
    name: spec.name,
    value: compensationDeviation(spec, value, primary),
    side: null,
  };
}

/**
 * Pair each limb's compensation with its own primary before selecting what the
 * patient sees. A unilateral prescription never inherits the opposite limb's
 * warning; a bilateral prescription surfaces the worse available side.
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
): CompensationWarningSignal {
  const left = compensationDeviation(
    spec,
    input.leftValue,
    input.leftPrimary,
  );
  const right = compensationDeviation(
    spec,
    input.rightValue,
    input.rightPrimary,
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
    direction === "below" ? left <= right : Math.abs(left) >= Math.abs(right);
  return {
    name: spec.name,
    value: useLeft ? left : right,
    side: useLeft ? "left" : "right",
  };
}

