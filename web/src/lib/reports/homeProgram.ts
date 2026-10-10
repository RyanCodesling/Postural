/**
 * The patient's current home exercise program for the progress PDF: every
 * prescription that is running or about to start, with its dose, schedule and
 * how many of its scheduled days are done so far, read from
 * `GET /api/patient-exercises`.
 */
import { formatCadence, type Recurrence } from "@/lib/exercises/occurrences";
import { prescriptionTargetText } from "@/lib/exercises/prescriptionDisplay";
import {
  formatResistanceContext,
  resistanceContextFromRow,
  type PrescribedSide,
  type ResistanceContext,
} from "@/lib/prescriptionContext";
import { sideLabel } from "@/lib/sessionOutcomePresentation";
import { formatDateKey } from "./reportPatient";

export type HomeProgramItem = {
  exerciseId: string;
  name: string;
  /** False for the therapist's own tasks, which the patient ticks off without the camera. */
  cameraMonitored: boolean;
  sets: number;
  reps: number | null;
  holdSeconds: number | null;
  restSeconds: number | null;
  prescribedSide: PrescribedSide;
  resistance: ResistanceContext;
  recurrence: Recurrence | null;
  intervalDays: number | null;
  weekdays: number[] | null;
  startDate: string | null;
  endDate: string | null;
  state: "upcoming" | "active";
  days: { scheduled: number; completed: number; missed: number; painStopped: number };
};

const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const numberOrNull = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const dateKey = (value: unknown) => (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null);

/** The running and upcoming prescriptions of one `GET /api/patient-exercises` reply. */
export function homeProgramFromRows(rows: unknown[]): HomeProgramItem[] {
  return rows.flatMap((value): HomeProgramItem[] => {
    if (!value || typeof value !== "object") return [];
    const row = value as Record<string, unknown>;
    const state = row.prescription_state;
    if ((state !== "active" && state !== "upcoming") || typeof row.exercise_id !== "string") return [];
    const summary = (row.occurrence_summary ?? {}) as Record<string, unknown>;
    const side = row.prescribed_side;
    return [{
      exerciseId: row.exercise_id,
      name: typeof row.name === "string" ? row.name : row.exercise_id,
      cameraMonitored: row.monitoring_mode === "camera",
      sets: count(row.sets),
      reps: numberOrNull(row.reps),
      holdSeconds: numberOrNull(row.hold_seconds),
      restSeconds: numberOrNull(row.rest_seconds),
      prescribedSide: side === "left" || side === "right" ? side : "both",
      resistance: resistanceContextFromRow(row),
      recurrence: row.recurrence === "interval" || row.recurrence === "weekly" ? row.recurrence : null,
      intervalDays: numberOrNull(row.interval_days),
      weekdays: Array.isArray(row.weekdays) ? row.weekdays.map(Number).filter(Number.isInteger) : null,
      startDate: dateKey(row.start_date) ?? dateKey(row.assigned_date),
      endDate: dateKey(row.end_date) ?? dateKey(row.assigned_date),
      state,
      days: {
        scheduled: count(summary.scheduled),
        completed: count(summary.completed),
        missed: count(summary.missed),
        painStopped: count(summary.painStopped),
      },
    }];
  });
}

/** One table row: exercise, dose, side and load, schedule, dates, days done so far. */
export function homeProgramRow(item: HomeProgramItem): string[] {
  const dose = [
    `${item.sets} set${item.sets === 1 ? "" : "s"} of ${prescriptionTargetText({ exerciseId: item.exerciseId, reps: item.reps, holdSeconds: item.holdSeconds })}`,
    ...(item.restSeconds !== null ? [`${item.restSeconds}s rest`] : []),
  ].join(" · ");
  const sides = item.prescribedSide === "both" ? "Both sides" : `${sideLabel(item.prescribedSide)} side`;
  const dates = item.startDate && item.endDate
    ? `${formatDateKey(item.startDate)} to ${formatDateKey(item.endDate)}`
    : "not recorded";
  const done = [
    `${item.days.completed} of ${item.days.scheduled} scheduled day${item.days.scheduled === 1 ? "" : "s"} done`,
    ...(item.days.missed ? [`${item.days.missed} missed`] : []),
    ...(item.days.painStopped ? [`${item.days.painStopped} stopped for pain`] : []),
  ].join(" · ");
  return [
    item.cameraMonitored ? item.name : `${item.name} (done without the camera)`,
    dose,
    `${sides} · ${formatResistanceContext(item.resistance)}`,
    `${formatCadence(item)}${item.state === "upcoming" ? " (not started yet)" : ""}`,
    dates,
    done,
  ];
}

/** The patient's current program, or null when it cannot be loaded. */
export async function fetchHomeProgram(patientId: string): Promise<HomeProgramItem[] | null> {
  try {
    const response = await fetch(`/api/patient-exercises?patientId=${encodeURIComponent(patientId)}`, { cache: "no-store" });
    if (!response.ok) return null;
    const body = (await response.json()) as { exercises?: unknown };
    return Array.isArray(body.exercises) ? homeProgramFromRows(body.exercises) : null;
  } catch {
    return null;
  }
}
