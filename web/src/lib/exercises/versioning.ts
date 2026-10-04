import { createHash } from "node:crypto";

import {
  EXERCISE_REGISTRY,
  getCompensationBands,
  type CompensationMetricSpec,
  type ExerciseDefinition,
} from "./registry";
import { POSE_METRIC_ALGORITHM_VERSION } from "@/lib/pose/metricVersion";
import { coachingConfiguration } from "@/lib/pose/coachingConfig";
import { SCALAR_PRECISION_VERSION } from "@/lib/pose/metricPrecision";

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

/**
 * The exercise definition with every compensation metric's coaching `cue`
 * removed.
 *
 * `exerciseConfigVersion` is a MEASUREMENT contract identifier. It is persisted
 * on every session and the therapist dashboard splits a patient's trend into a
 * separate group whenever it changes, on the premise that a side, load, or
 * threshold change makes earlier sessions non-comparable. A cue's wording,
 * priority, or display timing changes none of that: the same landmarks produce
 * the same angles, thresholds, bands, and scores.
 *
 * Verified 2026-08-22: including the `cue` field changed all 8 exercise config
 * versions, which would have split every existing patient trend at the commit
 * that added coaching cues while implying a measurement change that did not
 * happen. Excluding it keeps the hashes byte-identical to their pre-cue values.
 *
 * Coaching configuration is fingerprinted separately and stored in session
 * context and set audit records. It never participates in trend grouping.
 *
 * Display-only coaching checks (`coachingChecks`, added 2026-10-02; on holds
 * too since 2026-10-04) are removed for the same reason: they drive cues only,
 * and are never scored or stored as measurements.
 */
function measurementDefinition(definition: ExerciseDefinition): ExerciseDefinition {
  const compensationMetrics = definition.compensationMetrics.map((metric) => {
    if (!metric.cue) return metric;
    const withoutCue: CompensationMetricSpec = { ...metric };
    delete withoutCue.cue;
    return withoutCue;
  });
  // `ExerciseDefinition` is a dynamic/isometric union, and spreading it widens
  // past the discriminant. Only `compensationMetrics` is replaced and
  // `coachingChecks` dropped, and each element keeps its own type, so the
  // shape is otherwise unchanged.
  const measurement = { ...definition, compensationMetrics } as ExerciseDefinition;
  delete measurement.coachingChecks;
  return measurement;
}

export function exerciseVersionPayload(definition: ExerciseDefinition) {
  return {
    definition: measurementDefinition(definition),
    effectiveCompensationBands: effectiveCompensationBands(definition),
    poseMetricAlgorithm: POSE_METRIC_ALGORITHM_VERSION,
    // Only the scalar path's normalized compensation changed. Per-limb
    // compensations already used three decimals; keep their history grouped.
    ...(definition.bilateralMode !== "per-limb" && definition.compensationMetrics.some(
      metric => metric.name === "scapularElevation",
    ) ? { scalarPrecision: SCALAR_PRECISION_VERSION } : {}),
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

export const COACHING_CONFIG_VERSIONS: Record<string, string> = Object.fromEntries(
  Object.entries(EXERCISE_REGISTRY).map(([id, definition]) => [id, sha256Version(coachingConfiguration(definition))]),
);

export function getAppRevision(): string {
  const candidate =
    process.env.APP_REVISION ??
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.GITHUB_SHA;
  return candidate?.trim() || "local-unversioned";
}
