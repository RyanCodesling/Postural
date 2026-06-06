// Scheduling logic shared by the server (assignment → occurrence generation,
// adherence rollups in db.ts) and the client (consistency calendar, session
// schedule). Pure functions over YYYY-MM-DD day-key strings — no timezone
// conversion, so a "day" means the same thing everywhere it is used.
//
// weekday numbering is JS Date.getDay() semantics: 0=Sun … 6=Sat. The calendar
// header and the assign-page weekday picker use the same numbering.
//
// Two cadence kinds:
//   'interval' — every N days from the start date.
//   'weekly'   — specific weekdays (also expresses "twice / three times a week").
// The schedule grid is FIXED (a miss never re-anchors it). Each occurrence has a
// make-up window running until the day before the next scheduled occurrence; it
// is only "missed" once today passes that deadline.

export type Recurrence = "interval" | "weekly";
export type OccurrenceStatus = "pending" | "in_progress" | "completed";

// A single scheduled day, its make-up deadline, and its stored status. "overdue"
// and "missed" are derived from these + today (see deriveOccurrenceState).
export interface OccurrenceLite {
  dueDate: string; // YYYY-MM-DD
  makeupUntil: string; // YYYY-MM-DD, inclusive
  status: OccurrenceStatus;
}

// Per-occurrence display state.
export type OccurrenceState =
  | "completed"
  | "in_progress"
  | "upcoming"
  | "due"
  | "overdue"
  | "missed";

// Per-calendar-day rollup across every occurrence due that day.
export type DayState = "rest" | "due" | "overdue" | "partial" | "missed" | "complete";

export interface RecurrenceRule {
  recurrence: Recurrence | null | undefined;
  intervalDays?: number | null; // 'interval' mode
  weekdays?: number[] | null; // 'weekly' mode
  startDate: string; // YYYY-MM-DD
  endDate?: string | null; // YYYY-MM-DD, inclusive
}

// Upper bound on the span a single recurrence may cover, so one assign action can
// never generate an unbounded number of occurrence rows.
export const MAX_RECURRENCE_SPAN_DAYS = 180;
// Largest interval offered for "every N days".
export const MAX_INTERVAL_DAYS = 30;

export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ── Day-key arithmetic (UTC so it's pure calendar math, no DST/local drift) ──

export function isDateKey(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function toUTC(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fmt(dt: Date): string {
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function dayOfWeek(key: string): number {
  return toUTC(key).getUTCDay();
}

export function addDays(key: string, n: number): string {
  const dt = toUTC(key);
  dt.setUTCDate(dt.getUTCDate() + n);
  return fmt(dt);
}

export function nextDayKey(key: string): string {
  return addDays(key, 1);
}

// Inclusive day count between two keys, or null if invalid/reversed.
export function spanDays(startKey: string, endKey: string): number | null {
  if (!isDateKey(startKey) || !isDateKey(endKey)) return null;
  if (endKey < startKey) return null;
  const ms = toUTC(endKey).getTime() - toUTC(startKey).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

// ── Generation ───────────────────────────────────────────────────────────────

// Expand a recurrence rule into its ordered list of due-date keys. Returns [] for
// any invalid rule (caller validates and surfaces the error).
export function generateDueDates(rule: RecurrenceRule): string[] {
  const start = rule.startDate;
  if (!isDateKey(start)) return [];
  const end = isDateKey(rule.endDate) ? rule.endDate : null;
  if (!end || end < start) return [];

  const out: string[] = [];
  let guard = 0;

  if (rule.recurrence === "interval") {
    const n = Math.floor(rule.intervalDays ?? 0);
    if (!Number.isFinite(n) || n < 1) return [];
    let key = start;
    while (key <= end && guard <= MAX_RECURRENCE_SPAN_DAYS) {
      out.push(key);
      key = addDays(key, n);
      guard++;
    }
    return out;
  }

  if (rule.recurrence === "weekly") {
    const weekdays = (rule.weekdays ?? []).filter(
      (d) => Number.isInteger(d) && d >= 0 && d <= 6
    );
    if (weekdays.length === 0) return [];
    const want = new Set(weekdays);
    let key = start;
    while (key <= end && guard <= MAX_RECURRENCE_SPAN_DAYS) {
      if (want.has(dayOfWeek(key))) out.push(key);
      key = nextDayKey(key);
      guard++;
    }
    return out;
  }

  return [];
}

// Expand a rule into occurrences carrying their make-up deadline: the day before
// the next scheduled occurrence (so consecutive/daily schedules get no make-up).
// The last occurrence's window runs to end_date.
export function generateSchedule(
  rule: RecurrenceRule
): { dueDate: string; makeupUntil: string }[] {
  const dues = generateDueDates(rule);
  if (dues.length === 0) return [];
  const end = isDateKey(rule.endDate) ? rule.endDate : dues[dues.length - 1];
  return dues.map((dueDate, i) => {
    if (i < dues.length - 1) {
      return { dueDate, makeupUntil: addDays(dues[i + 1], -1) };
    }
    return { dueDate, makeupUntil: end > dueDate ? end : dueDate };
  });
}

// ── State derivation ─────────────────────────────────────────────────────────

export function deriveOccurrenceState(
  occ: OccurrenceLite,
  todayKey: string
): OccurrenceState {
  if (occ.status === "completed") return "completed";
  if (occ.status === "in_progress") return "in_progress";
  if (occ.dueDate > todayKey) return "upcoming";
  if (occ.dueDate === todayKey) return "due";
  // past due, not completed: still make-up-able until the window closes.
  return occ.makeupUntil >= todayKey ? "overdue" : "missed";
}

// Collapse all occurrences due on one calendar day into a single calendar state.
//   rest     — nothing was due
//   complete — every due occurrence completed
//   partial  — some completed, some not
//   due      — today/future with pending work
//   overdue  — past day, nothing completed, make-up window still open
//   missed   — past day, nothing completed, window closed
export function rollupDay(
  due: OccurrenceLite[],
  dayKey: string,
  todayKey: string
): DayState {
  if (due.length === 0) return "rest";
  const completed = due.filter((o) => o.status === "completed").length;
  if (completed === due.length) return "complete";
  if (completed > 0) return "partial";
  if (dayKey >= todayKey) return "due";
  const anyOpen = due.some((o) => o.makeupUntil >= todayKey);
  return anyOpen ? "overdue" : "missed";
}

// ── Display ──────────────────────────────────────────────────────────────────

export function formatCadence(rule: {
  recurrence: Recurrence | null | undefined;
  intervalDays?: number | null;
  weekdays?: number[] | null;
}): string {
  if (rule.recurrence === "interval") {
    const n = Math.floor(rule.intervalDays ?? 1);
    if (n <= 1) return "Every day";
    if (n === 2) return "Every other day";
    return `Every ${n} days`;
  }
  if (rule.recurrence === "weekly") {
    const list = (rule.weekdays ?? []).filter(
      (d) => Number.isInteger(d) && d >= 0 && d <= 6
    );
    const days = list
      .slice()
      .sort((a, b) => a - b)
      .map((d) => WEEKDAY_SHORT[d])
      .join(", ");
    const prefix = list.length === 2 ? "Twice a week" : list.length === 3 ? "3× a week" : "Weekly";
    return days ? `${prefix} · ${days}` : prefix;
  }
  return "One-time"; // legacy NULL recurrence
}
