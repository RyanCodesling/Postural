export interface ScheduleSessionRecord {
  id: number;
  occurrenceId: number | null;
  exerciseKind: "dynamic" | "isometric" | null;
  startedAt: string;
  endedAt: string | null;
  endReason: string | null;
  durationMs: number | null;
  setCount: number;
  totalReps: number;
  completeReps: number;
  completeLeftReps: number;
  completeRightReps: number;
  totalPairedHoldMs: number | null;
}

export interface CompletedOccurrenceResult {
  primary: ScheduleSessionRecord;
  attemptCount: number;
}

export function isOutcomeBearingSession(session: ScheduleSessionRecord): boolean {
  return (
    session.setCount > 0 ||
    session.totalReps > 0 ||
    (session.totalPairedHoldMs ?? 0) > 0
  );
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
