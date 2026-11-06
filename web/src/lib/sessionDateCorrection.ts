/** The explicit date correction is separate from the advancing demo clock. */
export class SessionDateCorrectionError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "SessionDateCorrectionError";
  }
}

export interface SessionDateCorrectionInput {
  targetAt: string;
  expectedStartedAt: string;
  expectedRevision: string;
  targetOccurrenceId: number;
  reason: string;
}

export interface CorrectableSession {
  id: number;
  patientName: string;
  exerciseName: string;
  startedAt: string;
  endedAt: string | null;
  scheduledDay: string | null;
  occurrenceId: number | null;
  endReason: string | null;
}

export interface SessionDateCorrectionRecord {
  id: string;
  oldStartedAt: string;
  oldEndedAt: string;
  newStartedAt: string;
  newEndedAt: string;
  correctedAt: string;
  correctedByName: string;
  reason: string;
  oldScheduledDay: string;
  newScheduledDay: string;
}

export interface DateCorrectionDestination {
  id: number;
  dueDate: string;
  makeupUntil: string;
}

export interface SessionDateCorrectionDetail {
  session: CorrectableSession;
  available: boolean;
  revision: string;
  history: SessionDateCorrectionRecord[];
  destinations: DateCorrectionDestination[];
}

export function parseCorrectionSessionId(value: string): number {
  if (!/^[1-9]\d*$/.test(value) || Number(value) > 2147483647) {
    throw new SessionDateCorrectionError("Choose a valid session.", 400);
  }
  return Number(value);
}

function isTimestamp(value: unknown): value is string {
  // UTC instants, with millisecond or PostgreSQL microsecond precision. Reject
  // rollover dates (e.g. February 30), local/ambiguous times, and year zero.
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(?:\d{3})?Z$/.test(value) || value.startsWith("0000")) return false;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString() === value.replace(/(\.\d{3})\d{3}Z$/, "$1Z");
}

export function parseSessionDateCorrection(value: unknown): SessionDateCorrectionInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SessionDateCorrectionError("Enter a corrected date/time and a reason.", 400);
  }
  const body = value as Record<string, unknown>;
  const fields = ["targetAt", "expectedStartedAt", "expectedRevision", "targetOccurrenceId", "reason"];
  if (Object.keys(body).some(key => !fields.includes(key))) {
    throw new SessionDateCorrectionError("Only the recorded date/time and scheduled day can be corrected here.", 400);
  }
  if (!isTimestamp(body.targetAt) || !isTimestamp(body.expectedStartedAt)) {
    throw new SessionDateCorrectionError("Enter a valid date/time and reload the selected session.", 400);
  }
  if (typeof body.expectedRevision !== "string" || !/^(0|[1-9]\d{0,18})$/.test(body.expectedRevision)) {
    throw new SessionDateCorrectionError("Reload the selected session before correcting it.", 400);
  }
  if (typeof body.reason !== "string" || !body.reason.trim() || body.reason.trim().length > 500) {
    throw new SessionDateCorrectionError("Enter a correction reason of 1 to 500 characters.", 400);
  }
  if (typeof body.targetOccurrenceId !== "number") throw new SessionDateCorrectionError("Choose a destination scheduled day.", 400);
  parseCorrectionSessionId(String(body.targetOccurrenceId));
  return { targetAt: body.targetAt, expectedStartedAt: body.expectedStartedAt, expectedRevision: body.expectedRevision, targetOccurrenceId: body.targetOccurrenceId, reason: body.reason.trim() };
}

/** Moving a completion must not claim that a different dose was performed. */
export function sameCorrectionPrescription(recorded: unknown, destination: unknown): boolean {
  const key = (value: unknown) => {
    if (!value || typeof value !== "object") return null;
    const p = value as Record<string, unknown>;
    if (![1, 2].includes(Number(p.version)) || !["sets", "reps", "restSeconds", "holdSeconds"].every(k => typeof p[k] === "number" && Number.isFinite(p[k])) || !["left", "right", "both"].includes(String(p.prescribedSide))) return null;
    if (!p.resistance || typeof p.resistance !== "object") return null;
    const r = p.resistance as Record<string, unknown>;
    if (typeof r.type !== "string" || r.type === "unknown") return null;
    return JSON.stringify([p.patientExerciseId, p.exerciseId, p.sets, p.reps, p.restSeconds, p.holdSeconds, p.prescribedSide, r.type, r.value ?? null, r.unit ?? null, r.label ?? null]);
  };
  const a = key(recorded);
  return a !== null && a === key(destination);
}

/** Keep Manila time-of-day when choosing a different Manila scheduled date. */
export function correctionStartOnDay(instant: string, day: string): string {
  const time = new Date(Date.parse(instant) + 8 * 60 * 60_000).toISOString().slice(11, 23);
  return new Date(`${day}T${time}+08:00`).toISOString();
}

/** A datetime-local value in the operator's timezone, retaining seconds/ms. */
export function correctionLocalValue(instant: string): string {
  const date = new Date(instant);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 23);
}
