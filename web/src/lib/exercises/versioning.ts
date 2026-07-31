import { createHash } from "node:crypto";

import {
  EXERCISE_REGISTRY,
  getCompensationBands,
  type ExerciseDefinition,
} from "./registry";
import { POSE_METRIC_ALGORITHM_VERSION } from "@/lib/pose/metricVersion";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256Version(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

export function effectiveCompensationBands(
  definition: ExerciseDefinition,
): Record<string, unknown> {
  return Object.fromEntries(
    definition.compensationMetrics.map((metric) => [
      metric.name,
      getCompensationBands(metric) ?? null,
    ]),
  );
}

export function exerciseVersionPayload(definition: ExerciseDefinition) {
  return {
    definition,
    effectiveCompensationBands: effectiveCompensationBands(definition),
    poseMetricAlgorithm: POSE_METRIC_ALGORITHM_VERSION,
  };
}

export const EXERCISE_CONFIG_VERSIONS: Record<string, string> =
  Object.fromEntries(
    Object.entries(EXERCISE_REGISTRY).map(([id, definition]) => [
      id,
      sha256Version(exerciseVersionPayload(definition)),
    ]),
  );

export const REGISTRY_VERSION = sha256Version({
  exercises: EXERCISE_REGISTRY,
  exerciseConfigVersions: EXERCISE_CONFIG_VERSIONS,
});

export function getAppRevision(): string {
  const candidate =
    process.env.APP_REVISION ??
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.GITHUB_SHA;
  return candidate?.trim() || "local-unversioned";
}
