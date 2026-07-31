import { POSE_METRIC_ALGORITHM_VERSION } from "@/lib/pose/metricVersion";

export const PRESCRIPTION_SNAPSHOT_VERSION = 2 as const;
export const SESSION_CONTEXT_VERSION = 2 as const;
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
  version: typeof SESSION_CONTEXT_VERSION;
  versions: {
    registry: string;
    exerciseConfig: string;
    appRevision: string;
    poseMetrics: typeof POSE_METRIC_ALGORITHM_VERSION;
    repQuality: typeof REP_QUALITY_VERSION;
    model: null;
  };
};

export type SessionContextSnapshot =
  | SessionContextSnapshotV1
  | SessionContextSnapshotV2;

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
