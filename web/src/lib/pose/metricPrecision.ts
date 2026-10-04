import type { MetricName } from "../exercises/registry";

/** Keep normalized displacement precision finer than its 0.02–0.04 bands. */
export function roundFilteredMetric(name: MetricName, value: number): number {
  const scale = name === "scapularElevation" || name === "wristShoulderVertical" ||
    name === "shoulderElbowDistance" ? 1_000 : 10;
  return Math.round(value * scale) / scale;
}

export const SCALAR_PRECISION_VERSION = "scalar_metric_precision_v2";
