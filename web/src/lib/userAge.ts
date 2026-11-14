/**
 * Accounts are for people aged 13 to 100, by date of birth, counted on the
 * Manila calendar day. The admin form limits the date picker to these dates
 * and the users API refuses any other.
 */
export const MIN_USER_AGE = 13;
export const MAX_USER_AGE = 100;

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Whole years from a YYYY-MM-DD birth date to a YYYY-MM-DD day, or null if either is not a date. */
export function ageOnDay(dateOfBirth: string, todayKey: string): number | null {
  const born = DATE_KEY.exec(dateOfBirth);
  const today = DATE_KEY.exec(todayKey);
  if (!born || !today) return null;
  const [by, bm, bd] = born.slice(1).map(Number);
  const check = new Date(Date.UTC(by, bm - 1, bd));
  if (check.getUTCFullYear() !== by || check.getUTCMonth() !== bm - 1 || check.getUTCDate() !== bd) return null;
  const [ty, tm, td] = today.slice(1).map(Number);
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}

/** The day `years` years before a YYYY-MM-DD day; Feb 29 becomes Feb 28 in a common year. */
function yearsBefore(todayKey: string, years: number): string {
  const [y, m, d] = todayKey.split("-").map(Number);
  const year = y - years;
  const lastDay = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return `${String(year).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(Math.min(d, lastDay)).padStart(2, "0")}`;
}

/** The day after a YYYY-MM-DD day. */
function nextDay(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/**
 * The birth dates allowed today, for the date picker: born on or before
 * `max` (13 today or older) and on or after `min` (not yet 101).
 */
export function birthDateBounds(todayKey: string): { min: string; max: string } {
  return {
    max: yearsBefore(todayKey, MIN_USER_AGE),
    min: nextDay(yearsBefore(todayKey, MAX_USER_AGE + 1)),
  };
}

/** Why a birth date is not accepted today, or null when it is. */
export function birthDateError(dateOfBirth: unknown, todayKey: string): string | null {
  if (typeof dateOfBirth !== "string" || dateOfBirth === "") return "Date of birth is required.";
  const age = ageOnDay(dateOfBirth, todayKey);
  if (age === null) return "Date of birth must be a valid date.";
  if (age < MIN_USER_AGE) return `The user must be at least ${MIN_USER_AGE} years old.`;
  if (age > MAX_USER_AGE) return `The user must be ${MAX_USER_AGE} years old or younger.`;
  return null;
}
