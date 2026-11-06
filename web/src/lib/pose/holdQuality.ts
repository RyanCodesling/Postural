import { validCoachingAudit, type CoachingAudit } from "./coachingAudit";

export type HoldSideQuality = { meanDeg: number; sdDeg: number; meanErrorDeg: number; droopSlopeDegPerSec: number };
/** Original fields/units and aggregation are retained for historical readers. */
export type LegacyHoldQuality = {
  sampleCount: number; leftInBandMs: number; rightInBandMs: number; outOfPositionMs: number;
  dropCount: number; longestPairedStreakMs: number; settleMs: number | null;
  left: HoldSideQuality | null; right: HoldSideQuality | null;
  meanCompensationScore: number | null; minCompensationScore: number | null;
};
export type HoldQualityV2 = LegacyHoldQuality & {
  version: "hold_quality_v2";
  /** "pipeline-units" before the aspect correction (2026-10-21, D-48), then "aspect-corrected". */
  primaryUnits: "pipeline-units" | "aspect-corrected";
  compensationScoreSource: "smoothed-live-rule";
  streakMode: "simultaneous" | "either-side";
  coaching?: CoachingAudit;
};
/** Dynamic sets use the existing JSONB column without pretending to be holds. */
export type CoachingSetQuality = { version: "coaching_set_v1"; coaching: CoachingAudit };
export type SetMeasurement = (HoldQualityV2 | LegacyHoldQuality | CoachingSetQuality) & { auditOnly?: boolean };
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const positive = (n: unknown): n is number => finite(n) && n >= 0;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Persistence-only attempts must never become exercise outcomes. */
export function isAuditOnlyMeasurement(value: unknown): boolean {
  return object(value) && value.auditOnly === true;
}

/** Keep invalid evidence recoverable without exposing it as validated quality. */
export function quarantineSetMeasurement(original: unknown, reason: string) {
  return { version: "quarantined_measurement_v1" as const,
    auditOnly: isAuditOnlyMeasurement(original), reason, original };
}

export function readHoldQuality(value: unknown): LegacyHoldQuality | HoldQualityV2 | null {
  if (!object(value) || (value.version !== undefined && value.version !== "hold_quality_v2")) return null;
  for (const key of ["sampleCount", "dropCount"]) if (!positive(value[key]) || !Number.isInteger(value[key])) return null;
  for (const key of ["leftInBandMs", "rightInBandMs", "outOfPositionMs", "longestPairedStreakMs"]) if (!positive(value[key])) return null;
  if (!(value.settleMs === null || positive(value.settleMs))) return null;
  for (const key of ["meanCompensationScore", "minCompensationScore"]) if (!(value[key] === null || positive(value[key]) && value[key] <= 100)) return null;
  for (const key of ["left", "right"]) {
    const s = value[key];
    if (s !== null && (!object(s) || !finite(s.meanDeg) || !positive(s.sdDeg) || !finite(s.meanErrorDeg) || !finite(s.droopSlopeDegPerSec))) return null;
  }
  if (value.version === "hold_quality_v2" && (!["pipeline-units", "aspect-corrected"].includes(String(value.primaryUnits)) || value.compensationScoreSource !== "smoothed-live-rule" ||
      !["simultaneous", "either-side"].includes(String(value.streakMode)) || value.coaching !== undefined && !validCoachingAudit(value.coaching))) return null;
  return value as unknown as LegacyHoldQuality | HoldQualityV2;
}

export function validSetMeasurement(value: unknown, exerciseKind: string): value is SetMeasurement {
  if (!object(value) || value.auditOnly !== undefined && typeof value.auditOnly !== "boolean") return false;
  if (value.version === "coaching_set_v1") return exerciseKind === "dynamic" && validCoachingAudit(value.coaching);
  return exerciseKind === "isometric" && readHoldQuality(value) !== null;
}
