import type { PrescribedSide } from "@/lib/prescriptionContext";
import {
  fullRomOutcomeText,
  prescribedOutcomeSides,
  sideLabel,
} from "@/lib/sessionOutcomePresentation";

export interface ScheduleSessionRecord {
  id: number;
  occurrenceId: number | null;
  exerciseKind: "dynamic" | "isometric" | null;
  prescribedSide: PrescribedSide;
  startedAt: string;
  endedAt: string | null;
  endReason: string | null;
  durationMs: number | null;
  setCount: number;
  totalReps: number;
  completeReps: number;
  leftReps: number;
  rightReps: number;
  completeLeftReps: number;
  completeRightReps: number;
  totalPairedHoldMs: number | null;
  totalTargetHoldMs: number | null;
  totalLeftHoldMs: number | null;
  totalRightHoldMs: number | null;
}

export interface CompletedOccurrenceResult {
  primary: ScheduleSessionRecord;
  attemptCount: number;
}

export function isOutcomeBearingSession(session: ScheduleSessionRecord): boolean {
  return (
    session.setCount > 0 ||
    session.totalReps > 0 ||
    (session.totalPairedHoldMs ?? 0) > 0 ||
    (session.totalLeftHoldMs ?? 0) > 0 ||
    (session.totalRightHoldMs ?? 0) > 0
  );
}

/**
 * Compact patient schedule result text that follows the immutable prescription.
 * The opposite side can remain stored as observation evidence without being
 * presented as an equivalent treatment outcome. Side hold totals are
 * authoritative; the credited/paired total is only a legacy fallback.
 */
export function completedSessionDoseText(
  session: ScheduleSessionRecord,
): string | null {
  const sides = prescribedOutcomeSides(session.prescribedSide);

  if (session.exerciseKind === "isometric") {
    const holdBySide = {
      left: session.totalLeftHoldMs ?? session.totalPairedHoldMs ?? 0,
      right: session.totalRightHoldMs ?? session.totalPairedHoldMs ?? 0,
    };
    if (sides.every((side) => holdBySide[side] <= 0)) return null;
    return sides
      .map((side) => `${sideLabel(side)} ${formatDuration(holdBySide[side])} hold`)
      .join(" · ");
  }

  const repsBySide = {
    left: session.leftReps,
    right: session.rightReps,
  };
  const completeBySide = {
    left: session.completeLeftReps,
    right: session.completeRightReps,
  };
  if (sides.some((side) => repsBySide[side] > 0)) {
    return sides
      .map(
        (side) =>
          `${sideLabel(side)} ${fullRomOutcomeText(
            completeBySide[side],
            repsBySide[side],
          )}`,
      )
      .join(" · ");
  }

  if (session.completeReps > 0) {
    return `${session.completeReps} met full-ROM target`;
  }
  if (session.totalReps > 0) return `${session.totalReps} recorded reps`;
  return null;
}

export function groupSessionsByOccurrence(
  sessions: ScheduleSessionRecord[]
): Map<number, ScheduleSessionRecord[]> {
  const grouped = new Map<number, ScheduleSessionRecord[]>();
  for (const session of sessions) {
    if (session.occurrenceId === null) continue;
    const group = grouped.get(session.occurrenceId) ?? [];
    group.push(session);
    grouped.set(session.occurrenceId, group);
  }
  for (const group of grouped.values()) {
    group.sort(compareSessionsNewestFirst);
  }
  return grouped;
}

// A completed schedule occurrence can have several attempts. Use only the
// latest completed, outcome-bearing attempt for its displayed metrics; count
// the other outcome-bearing attempts without summing their results together.
export function selectCompletedOccurrenceResult(
  sessions: ScheduleSessionRecord[]
): CompletedOccurrenceResult | null {
  const attempts = sessions.filter(isOutcomeBearingSession);
  const completed = attempts
    .filter((session) => session.endReason === "completed")
    .sort(compareSessionsNewestFirst);
  if (completed.length === 0) return null;
  return { primary: completed[0], attemptCount: attempts.length };
}

function compareSessionsNewestFirst(
  a: ScheduleSessionRecord,
  b: ScheduleSessionRecord
): number {
  const timeDifference = Date.parse(b.startedAt) - Date.parse(a.startedAt);
  return timeDifference !== 0 ? timeDifference : b.id - a.id;
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}
