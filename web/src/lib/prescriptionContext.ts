import { POSE_METRIC_ALGORITHM_VERSION } from "@/lib/pose/metricVersion";

export const PRESCRIPTION_SNAPSHOT_VERSION = 2 as const;
export const SESSION_CONTEXT_VERSION = 3 as const;
export const REP_QUALITY_VERSION = "dynamic_rep_quality_v2" as const;

export type PrescribedSide = "both" | "left" | "right";
export type ResistanceType =
  | "unknown"
  | "none"
  | "external_weight"
  | "resistance_band"
  | "other";
export type LoadUnit = "kg" | "lb";
export type PainReportStatus = "not_reported" | "reported" | "declined";
export type PainTiming = "during" | "after" | "both";
/**
 * The before-session pain survey, stored in the session's start context. It
 * uses the after-session report's 0-10 scale; "declined" means the patient
 * skipped it.
 */
export type PreSessionPain =
  | { status: "reported"; score: number; bodyArea: string | null }
  | { status: "declined" };
/**
 * At or above this score the survey suggests checking with the therapist
 * before exercising. It never blocks the start. The value and the caution
 * wording are engineering placeholders awaiting physical-therapist review.
 */
export const PRE_SESSION_PAIN_CAUTION_SCORE = 7;
export type SessionEndReason = "completed" | "user" | "pain" | "superseded";
export type TherapistReviewLabel =
  | "agree"
  | "worse_than_score"
  | "better_than_score";

export type ResistanceContext = {
  type: ResistanceType;
  value: number | null;
  unit: LoadUnit | null;
  label: string | null;
};

export type PrescriptionSnapshotV1 = {
  version: 1;
  capturedAt: string;
  patientExerciseId: number;
  exerciseId: string;
  sets: number;
  reps: number;
  restSeconds: number;
  holdSeconds: number;
  prescribedSide: PrescribedSide;
  resistance: ResistanceContext;
  schedule: {
    dueDate: string;
    makeupUntil: string;
  };
};

export type PrescriptionSnapshotV2 = Omit<PrescriptionSnapshotV1, "version"> & {
  version: typeof PRESCRIPTION_SNAPSHOT_VERSION;
  /** Therapist-defined position inside the patient's exercise workflow. */
  sequenceIndex: number;
};

export type PrescriptionSnapshot =
  | PrescriptionSnapshotV1
  | PrescriptionSnapshotV2;

type SessionContextSnapshotBase = {
  capturedAt: string;
  prescription: PrescriptionSnapshot;
  schedule: {
    dueDate: string;
    makeupUntil: string;
    startedDuringMakeupWindow: boolean;
  };
  exercise: {
    id: string;
    name: string;
    kind: "dynamic" | "isometric";
    bilateralMode: "per-limb" | "bidirectional-alternating" | null;
    definition: unknown;
    effectiveCompensationBands: Record<string, unknown>;
  };
};

export type SessionContextSnapshotV1 = SessionContextSnapshotBase & {
  version: 1;
  versions: {
    registry: string;
    exerciseConfig: string;
    appRevision: string;
    repQuality: "dynamic_rep_quality_v1";
    model: null;
  };
};

export type SessionContextSnapshotV2 = SessionContextSnapshotBase & {
  version: 2;
  versions: {
    registry: string;
    exerciseConfig: string;
    appRevision: string;
    poseMetrics: typeof POSE_METRIC_ALGORITHM_VERSION;
    repQuality: typeof REP_QUALITY_VERSION;
    model: null;
  };
};

export type SessionContextSnapshotV3 = Omit<SessionContextSnapshotV2, "version" | "versions"> & {
  version: typeof SESSION_CONTEXT_VERSION;
  versions: SessionContextSnapshotV2["versions"] & { coachingConfig: string };
  coaching: import("./pose/coachingConfig").CoachingProvenance & { source: "executing-client" | "server-default-unverified" };
  /** Absent when the start showed no survey, as for every session started before it existed. */
  preSessionPain?: PreSessionPain;
};

export type SessionContextSnapshot =
  | SessionContextSnapshotV1
  | SessionContextSnapshotV2
  | SessionContextSnapshotV3;

export type RuntimePrescription = {
  occurrenceId: number;
  patientExerciseId: number;
  exerciseId: string;
  sets: number;
  reps: number;
  restSeconds: number;
  holdSeconds: number;
  sequenceIndex: number;
  prescribedSide: PrescribedSide;
  resistance: ResistanceContext;
  dueDate: string;
  makeupUntil: string;
};

export type NewPrescriptionContextInput = {
  prescribedSide?: unknown;
  resistanceType?: unknown;
  resistanceValue?: unknown;
  resistanceUnit?: unknown;
  resistanceLabel?: unknown;
};

const MAX_RESISTANCE_LABEL_LENGTH = 80;

function optionalFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function optionalShortLabel(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const label = String(value).trim();
  return label === "" ? null : label;
}

export function parsePrescribedSide(value: unknown): PrescribedSide {
  if (value === undefined || value === null || value === "") return "both";
  if (value === "both" || value === "left" || value === "right") return value;
  throw new Error("Prescribed side must be both, left, or right.");
}

export function parseResistanceContext(
  input: NewPrescriptionContextInput,
  options: { allowUnknown?: boolean } = {},
): ResistanceContext {
  const type = input.resistanceType ?? "none";
  if (
    type !== "unknown" &&
    type !== "none" &&
    type !== "external_weight" &&
    type !== "resistance_band" &&
    type !== "other"
  ) {
    throw new Error("Unsupported resistance type.");
  }
  if (type === "unknown" && !options.allowUnknown) {
    throw new Error("Unknown resistance is reserved for legacy prescriptions.");
  }

  const value = optionalFiniteNumber(input.resistanceValue);
  const unit =
    input.resistanceUnit === null ||
    input.resistanceUnit === undefined ||
    input.resistanceUnit === ""
      ? null
      : input.resistanceUnit;
  const label = optionalShortLabel(input.resistanceLabel);

  if (Number.isNaN(value)) {
    throw new Error("Resistance value must be a number.");
  }
  if (value !== null && value <= 0) {
    throw new Error("Resistance value must be greater than zero.");
  }
  if (unit !== null && unit !== "kg" && unit !== "lb") {
    throw new Error("Resistance unit must be kg or lb.");
  }
  if ((value === null) !== (unit === null)) {
    throw new Error("Resistance value and unit must be provided together.");
  }
  if (label !== null && label.length > MAX_RESISTANCE_LABEL_LENGTH) {
    throw new Error(
      `Resistance label must be ${MAX_RESISTANCE_LABEL_LENGTH} characters or fewer.`,
    );
  }

  if (type === "unknown") {
    if (value !== null || unit !== null || label !== null) {
      throw new Error("Legacy unknown resistance cannot include details.");
    }
    return { type, value: null, unit: null, label: null };
  }
  if (type === "none") {
    if (value !== null || unit !== null || label !== null) {
      throw new Error("No resistance cannot include a value, unit, or label.");
    }
    return { type, value: null, unit: null, label: null };
  }
  if (type === "external_weight" && value === null) {
    throw new Error("External weight requires a positive value and unit.");
  }
  if (type === "external_weight" && label !== null) {
    throw new Error("External weight does not use a resistance label.");
  }
  if ((type === "resistance_band" || type === "other") && label === null) {
    throw new Error("This resistance type requires a short label.");
  }

  return {
    type,
    value,
    unit: unit as LoadUnit | null,
    label,
  };
}

export function resistanceContextFromRow(row: Record<string, unknown>): ResistanceContext {
  return {
    type: (row.resistance_type ?? "unknown") as ResistanceType,
    value:
      row.resistance_value === null || row.resistance_value === undefined
        ? null
        : Number(row.resistance_value),
    unit: (row.resistance_unit as LoadUnit | null | undefined) ?? null,
    label: (row.resistance_label as string | null | undefined) ?? null,
  };
}

export function formatResistanceContext(resistance: ResistanceContext): string {
  if (resistance.type === "unknown") return "Legacy resistance not recorded";
  if (resistance.type === "none") return "No resistance";
  const load =
    resistance.value !== null && resistance.unit
      ? `${resistance.value} ${resistance.unit}`
      : null;
  return [resistance.label, load].filter(Boolean).join(" · ");
}

export function comparableContextKey(input: {
  exerciseId: string;
  prescribedSide: PrescribedSide;
  resistance: ResistanceContext;
  exerciseConfigVersion: string;
}): string {
  const resistance = input.resistance;
  return JSON.stringify([
    input.exerciseId,
    input.prescribedSide,
    resistance.type,
    resistance.value,
    resistance.unit,
    resistance.label,
    input.exerciseConfigVersion,
  ]);
}

/** The exercise as recorded in a session's start context. */
export type RecordedExercise = {
  kind: "dynamic" | "isometric" | null;
  primaryMetric: string | null;
  targetROM: number | null;
};

/**
 * What the start context recorded about the exercise, or null for sessions
 * without one. Readers of old sessions use this rather than the current
 * registry, whose kind, metric or target may have changed since.
 */
export function recordedExercise(context: unknown): RecordedExercise | null {
  const record = (value: unknown) =>
    value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  const exercise = record(record(context)?.exercise);
  if (!exercise) return null;
  const primary = record(record(exercise.definition)?.primaryMetric);
  const targetROM = record(primary?.thresholds)?.targetROM;
  return {
    kind: exercise.kind === "dynamic" || exercise.kind === "isometric" ? exercise.kind : null,
    primaryMetric: typeof primary?.name === "string" ? primary.name : null,
    targetROM: typeof targetROM === "number" && Number.isFinite(targetROM) ? targetROM : null,
  };
}

const MAX_PAIN_BODY_AREA_LENGTH = 80;

/**
 * Validates a before-session pain answer from a request body. No answer is
 * valid (the start showed no survey); a malformed one is an error.
 */
export function parsePreSessionPain(
  value: unknown,
): { ok: true; value: PreSessionPain | undefined } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, value: undefined };
  const answer = typeof value === "object" ? (value as Record<string, unknown>) : {};
  if (answer.status === "declined") return { ok: true, value: { status: "declined" } };
  if (answer.status !== "reported") {
    return { ok: false, error: "Pre-session pain status must be reported or declined." };
  }
  const score = answer.score;
  if (typeof score !== "number" || !Number.isInteger(score) || score < 0 || score > 10) {
    return { ok: false, error: "Pain score must be a whole number from 0 to 10." };
  }
  if (answer.bodyArea !== undefined && answer.bodyArea !== null && typeof answer.bodyArea !== "string") {
    return { ok: false, error: "Body area must be text." };
  }
  const bodyArea = typeof answer.bodyArea === "string" ? answer.bodyArea.trim() || null : null;
  if (bodyArea !== null && bodyArea.length > MAX_PAIN_BODY_AREA_LENGTH) {
    return { ok: false, error: `Body area must be ${MAX_PAIN_BODY_AREA_LENGTH} characters or fewer.` };
  }
  return { ok: true, value: { status: "reported", score, bodyArea } };
}

/** The survey answer stored with a session, or null when none was recorded. */
export function preSessionPainFromContext(context: unknown): PreSessionPain | null {
  if (!context || typeof context !== "object") return null;
  const parsed = parsePreSessionPain((context as { preSessionPain?: unknown }).preSessionPain);
  return parsed.ok ? (parsed.value ?? null) : null;
}

export function preSessionPainNeedsCaution(pain: PreSessionPain | null): boolean {
  return pain?.status === "reported" && pain.score >= PRE_SESSION_PAIN_CAUTION_SCORE;
}

/** "4/10 · left shoulder", "skipped", or "not recorded" for older sessions. */
export function formatPreSessionPain(pain: PreSessionPain | null): string {
  if (pain === null) return "not recorded";
  if (pain.status === "declined") return "skipped";
  return `${pain.score}/10${pain.bodyArea ? ` · ${pain.bodyArea}` : ""}`;
}
