import type { MetricName, ExerciseDefinition } from "@/lib/exercises/registry";
import type { CoachingCueDecision } from "./coachingCue";
import { validCoachingProvenance, type CoachingProvenance } from "./coachingConfig";
import type { RenderedCompensationCue } from "./drawCompensationOverlay";
import type { RepCounter } from "./repCounter";
import type { BidirectionalRepCounter } from "./bidirectionalRepCounter";
import type { VelocityBidirectionalRepCounter } from "./velocityBidirectionalRepCounter";

export const COACHING_AUDIT_VERSION = "coaching_audit_v1" as const;
export const MAX_COACHING_RECORDS = 600;
export type MovementObservation = {
  left: string;
  right: string;
  activeSide: "left" | "right" | null;
};

/** Reads existing counter/hold state; never updates, arms, resets, or credits it. */
export function observeMovement(
  definition: ExerciseDefinition,
  counters: { left: RepCounter | null; right: RepCounter | null; bidirectional: BidirectionalRepCounter | VelocityBidirectionalRepCounter | null },
  available: { left: boolean; right: boolean },
  inBand: { left: boolean; right: boolean },
): MovementObservation {
  if (definition.kind === "isometric") return {
    left: !available.left ? "unknown" : inBand.left ? "in-band" : "out-of-band",
    right: !available.right ? "unknown" : inBand.right ? "in-band" : "out-of-band",
    activeSide: definition.bilateralMode === "bidirectional-alternating"
      ? inBand.left ? "left" : inBand.right ? "right" : null : null,
  };
  if (counters.bidirectional) {
    const snapshot = counters.bidirectional.getMovementSnapshot();
    const phase = snapshot.awaitingRestSettle ? "settling" : snapshot.state;
    return {
      left: available.left ? snapshot.activeSide === "right" ? "inactive-side" : phase : "unknown",
      right: available.right ? snapshot.activeSide === "left" ? "inactive-side" : phase : "unknown",
      activeSide: snapshot.activeSide,
    };
  }
  return {
    left: available.left ? counters.left?.getState() ?? "untracked" : "unknown",
    right: available.right ? counters.right?.getState() ?? "untracked" : "unknown",
    activeSide: null,
  };
}

export type CoachingObservation = {
  capture: "available" | "unavailable";
  sessionState: string;
  baselineReady: boolean;
  movement: MovementObservation;
  selected: null | {
    cueId: string | null; metric: MetricName | null; declaredMessage: string | null;
    reason: CoachingCueDecision["reason"]; decisionAtMs: number; selectedSinceMs: number | null;
    side: "left" | "right" | null;
    warningValuesSmoothed: Partial<Record<MetricName, number | null>>;
    activeLatches: MetricName[];
  };
  /** Returned only after the actual canvas text draw; not the registry message. */
  rendered: RenderedCompensationCue[];
  renderEvidence: "canvas-frame" | "unobserved";
  suppressedMetrics: MetricName[];
  absenceReason: "capture-unavailable" | "baseline-unavailable" | "session-inactive" |
    "suppressed" | "not-selected" | "not-rendered" | null;
};
export type CoachingAuditRecord = CoachingObservation & {
  startMs: number; endMs: number; samples: number;
  /** Unsampled interval preceding this record; never counted as cue exposure. */
  gapBeforeMs: number;
};
export type CoachingAudit = {
  version: typeof COACHING_AUDIT_VERSION;
  provenance: CoachingProvenance;
  clock: "performance-ms";
  clockOriginIso: string;
  coverage: "observed-portion-of-set";
  closedAtMs: number;
  droppedRecords: number;
  /** Frame observations only. A missing cue is never labelled a correction. */
  records: CoachingAuditRecord[];
};

export class CoachingAuditBuffer {
  private records: CoachingAuditRecord[] = [];
  private key: string | null = null;
  private dropped = 0;
  private previousMs: number | null = null;
  hasRecords() { return this.records.length > 0; }
  reset() { this.records = []; this.key = null; this.dropped = 0; this.previousMs = null; }
  observe(tMs: number, observation: CoachingObservation) {
    if (!Number.isFinite(tMs) || (this.previousMs !== null && tMs < this.previousMs)) return;
    const key = JSON.stringify(observation);
    const gap = this.previousMs === null ? 0 : tMs - this.previousMs;
    const last = this.records.at(-1);
    // A scheduling/capture gap is unknown, never a sustained display interval.
    if (last && key === this.key && gap <= 300) { last.endMs = tMs; last.samples++; }
    else {
      this.records.push({ ...structuredClone(observation), startMs: tMs, endMs: tMs, samples: 1, gapBeforeMs: gap > 300 ? gap : 0 });
      if (this.records.length > MAX_COACHING_RECORDS) { this.records.shift(); this.dropped++; }
    }
    this.key = key;
    this.previousMs = tMs;
  }
  interrupt(tMs: number, sessionState: string) {
    this.observe(tMs, { capture: "unavailable", sessionState, baselineReady: false,
      movement: { left: "unknown", right: "unknown", activeSide: null }, selected: null,
      rendered: [], renderEvidence: "unobserved", suppressedMetrics: [], absenceReason: "capture-unavailable" });
  }
  snapshot(provenance: CoachingProvenance, closedAtMs: number, clockOriginIso = new Date(0).toISOString()): CoachingAudit {
    return structuredClone({ version: COACHING_AUDIT_VERSION, provenance,
      clock: "performance-ms", clockOriginIso, coverage: "observed-portion-of-set",
      closedAtMs, droppedRecords: this.dropped, records: this.records });
  }
}

const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const nonnegative = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
const strings = (v: unknown) => Array.isArray(v) && v.every(x => typeof x === "string" && x.length <= 160);
const nullableString = (v: unknown) => v === null || typeof v === "string" && v.length <= 500;
const states = new Set(["unknown", "untracked", "inactive-side", "settling", "in-band", "out-of-band",
  "WAITING_FOR_REP_START", "ASCENDING", "DESCENDING", "WAITING_FOR_LAUNCH", "RETURNING"]);
export function validCoachingAudit(value: unknown): value is CoachingAudit {
  if (!obj(value) || value.version !== COACHING_AUDIT_VERSION || value.clock !== "performance-ms" ||
      !nonnegative(value.closedAtMs) || !Number.isInteger(value.droppedRecords) || !nonnegative(value.droppedRecords) ||
      value.coverage !== "observed-portion-of-set" || typeof value.clockOriginIso !== "string" || !Number.isFinite(Date.parse(value.clockOriginIso)) ||
      !validCoachingProvenance(value.provenance) ||
      !Array.isArray(value.records) || value.records.length > MAX_COACHING_RECORDS) return false;
  let end = -1;
  return value.records.every(r => {
    if (!obj(r) || !nonnegative(r.startMs) || !nonnegative(r.endMs) || r.startMs < end || r.endMs < r.startMs ||
        r.endMs > (value.closedAtMs as number) || !nonnegative(r.gapBeforeMs) || !Number.isInteger(r.samples) || (r.samples as number) < 1 ||
        !["available", "unavailable"].includes(String(r.capture)) || typeof r.baselineReady !== "boolean" ||
        !["canvas-frame", "unobserved"].includes(String(r.renderEvidence)) ||
        !["idle", "countdown", "active", "resting", "ended", "reporting"].includes(String(r.sessionState)) ||
        !obj(r.movement) || !states.has(String(r.movement.left)) || !states.has(String(r.movement.right)) ||
        ![null, "left", "right"].includes(r.movement.activeSide as null) || !strings(r.suppressedMetrics) ||
        ![null, "capture-unavailable", "baseline-unavailable", "session-inactive", "suppressed", "not-selected", "not-rendered"].includes(r.absenceReason as null) ||
        !Array.isArray(r.rendered) || r.rendered.length > 1 || !r.rendered.every(d => obj(d) && typeof d.metric === "string" && typeof d.text === "string" && d.text.length <= 160 && nullableString(d.direction))) return false;
    if (r.rendered.length && (r.renderEvidence !== "canvas-frame" || r.capture !== "available" || !r.baselineReady || r.sessionState !== "active" || r.absenceReason !== null)) return false;
    if (r.selected !== null) {
      const s = r.selected;
      if (!obj(s) || !nullableString(s.cueId) || !nullableString(s.metric) || !nullableString(s.declaredMessage) ||
          ![null, "left", "right"].includes(s.side as null) || !strings(s.activeLatches) || !obj(s.warningValuesSmoothed) ||
          !Object.entries(s.warningValuesSmoothed).every(([k, v]) => k.length <= 80 && (v === null || typeof v === "number" && Number.isFinite(v))) ||
          !nonnegative(s.decisionAtMs) || s.decisionAtMs > r.endMs ||
          !(s.selectedSinceMs === null || nonnegative(s.selectedSinceMs) && s.selectedSinceMs <= s.decisionAtMs) ||
          !["none-active", "min-active", "cooldown", "promoted", "held", "held-min-display", "switched", "cleared"].includes(String(s.reason))) return false;
    }
    end = r.endMs;
    return true;
  });
}
