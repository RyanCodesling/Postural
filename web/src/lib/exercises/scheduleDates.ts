/**
 * Prescription dates may not be set in the past, but a running prescription
 * keeps its past start date. A date is checked against today only when it is
 * new or was changed, so a therapist can still extend a prescription that has
 * already started. The assign page and `POST /api/patient-exercises` share it.
 */
export type ScheduleDates = { startDate: string; endDate: string };

/** Which new or changed date (YYYY-MM-DD) is before `todayKey`, if any. */
export function pastScheduleDate(
  schedule: ScheduleDates,
  existing: ScheduleDates | null,
  todayKey: string,
): "start" | "end" | null {
  const startChanged = !existing || schedule.startDate !== existing.startDate;
  const endChanged = !existing || schedule.endDate !== existing.endDate;
  if (startChanged && schedule.startDate < todayKey) return "start";
  if (endChanged && schedule.endDate < todayKey) return "end";
  return null;
}

/** A stored assignment's dates, as the assign page and the server read them. */
export function storedScheduleDates(row: {
  start_date?: string | null;
  end_date?: string | null;
  assigned_date?: string | null;
}): ScheduleDates | null {
  const startDate = row.start_date ?? row.assigned_date ?? null;
  const endDate = row.end_date ?? row.assigned_date ?? null;
  return startDate && endDate ? { startDate, endDate } : null;
}
