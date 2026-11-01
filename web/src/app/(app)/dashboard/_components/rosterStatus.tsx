/** One patient's sessions and adherence, as the therapist and admin dashboards list them. */
export interface RosterPatient {
  id: string;
  name: string;
  totalSessions: number;
  sessionsThisWeek: number;
  lastSessionAt: string | null;
  assignedCount: number;  // distinct prescriptions (drives "No exercises")
  dueCount: number;       // scheduled occurrences due on or before today
  completedCount: number; // occurrences completed
  missedCount: number;    // past-due occurrences never completed
  painStoppedCount: number; // occurrences paused after a pain stop
}

// "Needs attention" = the patient has prescriptions but either no outcome-bearing
// session in the server's 7-day window (sessionsThisWeek === 0) or scheduled days
// that slipped past uncompleted (missedCount > 0). The 7-day window is a tunable
// heuristic set in getTherapistRoster.
export function rosterStatus(p: RosterPatient): { label: string; classes: string } {
  if (p.assignedCount === 0) {
    return { label: "No exercises", classes: "bg-gray-100 text-gray-500" };
  }
  if (p.painStoppedCount > 0) {
    return { label: "Pain follow-up", classes: "bg-red-100 text-red-700" };
  }
  if (p.missedCount > 0) {
    return { label: "Needs attention", classes: "bg-amber-100 text-amber-700" };
  }
  if (p.sessionsThisWeek > 0) {
    return { label: "Active", classes: "bg-green-100 text-green-700" };
  }
  return { label: "Needs attention", classes: "bg-amber-100 text-amber-700" };
}

/** Completed over due, with any missed exercises or pain stops beside it. */
export function RosterProgress({ patient: p }: { patient: RosterPatient }) {
  return (
    // Each count keeps to one line and lines up with the others when they wrap.
    <span className="inline-flex flex-wrap items-baseline gap-x-2">
      <span>{p.dueCount > 0 ? `${p.completedCount}/${p.dueCount}` : "—"}</span>
      {p.missedCount > 0 && <span className="whitespace-nowrap text-xs text-amber-600">{p.missedCount} missed</span>}
      {p.painStoppedCount > 0 && <span className="whitespace-nowrap text-xs font-medium text-red-600">{p.painStoppedCount} pain stop</span>}
    </span>
  );
}

export function RosterStatusBadge({ patient }: { patient: RosterPatient }) {
  const status = rosterStatus(patient);
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium ${status.classes}`}>
      {status.label}
    </span>
  );
}
