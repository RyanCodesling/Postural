import type { ExerciseDefinition } from "@/lib/exercises/registry";
import { resolveCoachingCue, resolveCoachingCueTiming } from "./coachingCue";
import { COMPENSATION_WARNING_DEBOUNCE_MS } from "./compensationWarningState";
import { OVERLAY_LABELS, OVERLAY_DIRECTION_LABELS } from "./drawCompensationOverlay";

/** Bump when selector, latch, suppression, or drawing semantics change. */
export const COACHING_ALGORITHM_VERSION = "coaching_v1";
export const COACHING_TICK_MS = 150;

export function coachingConfiguration(definition: ExerciseDefinition) {
  return {
    schema: "coaching_configuration_v1" as const,
    algorithm: COACHING_ALGORITHM_VERSION,
    exerciseId: definition.id,
    tickMs: COACHING_TICK_MS,
    warningDebounceMs: COMPENSATION_WARNING_DEBOUNCE_MS,
    messageRendered: false,
    labels: OVERLAY_LABELS,
    directionLabels: OVERLAY_DIRECTION_LABELS,
    cues: definition.compensationMetrics.map((spec) => {
      const cue = resolveCoachingCue(spec);
      return { metric: spec.name, ...cue, ...resolveCoachingCueTiming(cue) };
    }),
  };
}

export type CoachingConfiguration = ReturnType<typeof coachingConfiguration>;
export type CoachingProvenance = { version: string; configuration: CoachingConfiguration };

export function validCoachingProvenance(value: unknown): value is CoachingProvenance {
  if (!value || typeof value !== "object") return false;
  const p = value as CoachingProvenance;
  const c = p.configuration;
  return /^sha256:[a-f0-9]{64}$/.test(p.version) && !!c &&
    c.schema === "coaching_configuration_v1" && typeof c.algorithm === "string" &&
    typeof c.exerciseId === "string" && c.exerciseId.length < 80 &&
    Number.isFinite(c.tickMs) && c.tickMs >= 0 && Number.isFinite(c.warningDebounceMs) && c.warningDebounceMs >= 0 &&
    typeof c.messageRendered === "boolean" && !!c.labels && typeof c.labels === "object" &&
    Object.values(c.labels).every(v => typeof v === "string" && v.length <= 160) &&
    !!c.directionLabels && typeof c.directionLabels.shoulderSymmetry === "string" && typeof c.directionLabels.straighten === "string" &&
    Array.isArray(c.cues) && c.cues.length <= 20 && c.cues.every(q => !!q &&
      typeof q.metric === "string" && typeof q.id === "string" && typeof q.message === "string" && q.message.length <= 500 &&
      [q.priority, q.minActiveMs, q.minDisplayMs, q.cooldownMs].every(n => Number.isFinite(n) && n >= 0));
}

/** Same canonical serialization as the server's measurement fingerprint. */
export function canonicalCoachingJson(value: unknown): string {
  const sort = (v: unknown): unknown => Array.isArray(v) ? v.map(sort) :
    v && typeof v === "object" ? Object.fromEntries(Object.entries(v)
      .sort(([a], [b]) => a.localeCompare(b)).map(([k, child]) => [k, sort(child)])) : v;
  return JSON.stringify(sort(value));
}

/** Browser-side fingerprint records the executing bundle, including after Resume. */
export async function captureCoachingProvenance(definition: ExerciseDefinition): Promise<CoachingProvenance> {
  const configuration = coachingConfiguration(definition);
  const bytes = new TextEncoder().encode(canonicalCoachingJson(configuration));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
  return { version: `sha256:${hex}`, configuration };
}
