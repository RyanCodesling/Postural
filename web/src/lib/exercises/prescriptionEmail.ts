import type { PrescriptionDetail } from "@/lib/email";
import { formatResistanceContext, resistanceContextFromRow } from "@/lib/prescriptionContext";
import { formatCadence, type Recurrence } from "@/lib/exercises/occurrences";

/** The patient_exercises columns (plus the exercise name) the emails describe. */
export type PrescriptionRow = {
  name: string;
  sets: number;
  reps: number;
  rest_seconds: number;
  sequence_index: number;
  prescribed_side: string;
  recurrence?: Recurrence | null;
  interval_days?: number | null;
  weekdays?: number[] | null;
  start_date?: string | null;
  end_date?: string | null;
  assigned_date?: string | null;
  [key: string]: unknown;
};

function dateLabel(day: string | null | undefined): string {
  if (!day) return "—";
  return new Date(`${String(day).slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function toPrescriptionDetail(row: PrescriptionRow): PrescriptionDetail {
  return {
    exerciseName: row.name,
    sets: Number(row.sets),
    reps: Number(row.reps),
    restSeconds: Number(row.rest_seconds),
    order: Number(row.sequence_index),
    side: String(row.prescribed_side),
    resistance: formatResistanceContext(resistanceContextFromRow(row)),
    repeat: formatCadence({
      recurrence: row.recurrence,
      intervalDays: row.interval_days,
      weekdays: row.weekdays,
    }),
    startLabel: dateLabel(row.start_date ?? row.assigned_date),
    endLabel: dateLabel(row.end_date ?? row.assigned_date),
  };
}

/** The fields that differ from `before`, keyed by their email label with the old value. */
export function changedPrescriptionFields(
  before: PrescriptionDetail,
  after: PrescriptionDetail,
): Record<string, string> {
  const changed: Record<string, string> = {};
  if (before.sets !== after.sets) changed.Sets = String(before.sets);
  if (before.reps !== after.reps) changed.Reps = String(before.reps);
  if (before.restSeconds !== after.restSeconds) changed.Rest = `${before.restSeconds}s`;
  if (before.order !== after.order) changed.Order = String(before.order);
  if (before.side !== after.side) changed.Side = before.side;
  if (before.resistance !== after.resistance) changed.Resistance = before.resistance;
  if (before.repeat !== after.repeat) changed.Repeat = before.repeat;
  if (before.startLabel !== after.startLabel || before.endLabel !== after.endLabel) {
    changed.Schedule = `${before.startLabel} to ${before.endLabel}`;
  }
  return changed;
}

/**
 * Splits a patient's prescriptions into newly assigned and changed exercises by
 * comparing the rows before and after an assignment request.
 */
export function diffAssignedExercises(
  before: PrescriptionRow[],
  after: PrescriptionRow[],
  requestedExerciseIds: string[],
): { assigned: PrescriptionDetail[]; changed: PrescriptionDetail[] } {
  const assigned: PrescriptionDetail[] = [];
  const changed: PrescriptionDetail[] = [];
  for (const exerciseId of requestedExerciseIds) {
    const next = after.find((row) => row.exercise_id === exerciseId);
    if (!next) continue;
    const previous = before.find((row) => row.exercise_id === exerciseId);
    const detail = toPrescriptionDetail(next);
    if (!previous) {
      assigned.push(detail);
      continue;
    }
    const fields = changedPrescriptionFields(toPrescriptionDetail(previous), detail);
    if (Object.keys(fields).length > 0) changed.push({ ...detail, changed: fields });
  }
  return { assigned, changed };
}
