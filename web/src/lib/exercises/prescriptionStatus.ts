import type { OccurrenceLite } from "./occurrences";

export type PrescriptionState = "upcoming" | "active" | "ended" | "archived";
export type PrescriptionAdherenceState =
  | "not_started"
  | "in_progress"
  | "partially_completed"
  | "completed";

export interface PrescriptionOccurrenceLite extends OccurrenceLite {
  cancelledAt?: string | null;
}

export interface PrescriptionSummary {
  prescriptionState: PrescriptionState;
  adherenceState: PrescriptionAdherenceState;
  scheduledCount: number;
  completedCount: number;
  missedCount: number;
  inProgressCount: number;
  remainingCount: number;
  cancelledCount: number;
}

/**
 * Keep prescription lifecycle (upcoming/active/ended/archived) separate from
 * adherence outcome. A prescription can be ended and partially completed at
 * the same time; collapsing those concepts caused expired mixed histories to
 * be presented as currently "In Progress".
 */
export function summarizePrescription(args: {
  occurrences: PrescriptionOccurrenceLite[];
  todayKey: string;
  startDate?: string | null;
  endDate?: string | null;
  archivedAt?: string | null;
}): PrescriptionSummary {
  const { occurrences, todayKey, startDate, endDate, archivedAt } = args;
  const scheduled = occurrences.filter((occ) => !occ.cancelledAt);
  const cancelledCount = occurrences.length - scheduled.length;
  const completedCount = scheduled.filter((occ) => occ.status === "completed").length;
  const inProgressCount = scheduled.filter((occ) => occ.status === "in_progress").length;
  const missedCount = scheduled.filter(
    (occ) => occ.status !== "completed" && occ.makeupUntil < todayKey,
  ).length;
  const remainingCount = Math.max(
    0,
    scheduled.length - completedCount - missedCount,
  );

  let prescriptionState: PrescriptionState;
  if (archivedAt) {
    prescriptionState = "archived";
  } else if (startDate && startDate > todayKey) {
    prescriptionState = "upcoming";
  } else {
    const latestWindow = scheduled.reduce<string | null>(
      (latest, occ) => (latest === null || occ.makeupUntil > latest ? occ.makeupUntil : latest),
      null,
    );
    prescriptionState =
      (endDate !== null && endDate !== undefined && endDate < todayKey) ||
      (latestWindow !== null && latestWindow < todayKey)
        ? "ended"
        : "active";
  }

  let adherenceState: PrescriptionAdherenceState = "not_started";
  if (scheduled.length > 0 && completedCount === scheduled.length) {
    adherenceState = "completed";
  } else if (completedCount > 0) {
    adherenceState = "partially_completed";
  } else if (inProgressCount > 0) {
    adherenceState = "in_progress";
  }

  return {
    prescriptionState,
    adherenceState,
    scheduledCount: scheduled.length,
    completedCount,
    missedCount,
    inProgressCount,
    remainingCount,
    cancelledCount,
  };
}
