/**
 * The patient block at the top of the session and progress PDFs, laid out like
 * the patient block of a lab or imaging report: who the report is about, as
 * the clinic recorded them. Diagnosis and condition are shown as the clinic
 * entered them; the app itself makes no diagnosis.
 */
import type { DetailCell } from "./pdfWriter";

/** The fields of `GET /api/users/[id]` the reports read. */
export type ReportPatient = {
  id: string;
  name: string;
  /** YYYY-MM-DD, as the database stores the date. */
  dateOfBirth: string | null;
  /** The age typed in when the account was made; used only without a birth date. */
  age: number | null;
  gender: string | null;
  therapistName: string | null;
  diagnosis: string | null;
  condition: string | null;
};

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})/;

/** A YYYY-MM-DD date as "Mar 4, 1990", without shifting it through a time zone. */
export function formatDateKey(key: string): string {
  const match = DATE_KEY.exec(key);
  if (!match) return key;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
}

/** Whole years from a YYYY-MM-DD birth date to the calendar day of `on` in `timeZone`. */
export function ageOn(dateOfBirth: string, on: Date, timeZone?: string): number | null {
  const born = DATE_KEY.exec(dateOfBirth);
  const today = DATE_KEY.exec(new Intl.DateTimeFormat("en-CA", { timeZone }).format(on));
  if (!born || !today) return null;
  const [by, bm, bd] = born.slice(1).map(Number);
  const [ty, tm, td] = today.slice(1).map(Number);
  const age = ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
  return age >= 0 && age < 150 ? age : null;
}

function birthText(patient: ReportPatient, on: Date, timeZone?: string): string {
  if (patient.dateOfBirth) {
    const age = ageOn(patient.dateOfBirth, on, timeZone);
    return `${formatDateKey(patient.dateOfBirth)}${age === null ? "" : ` (${age} years)`}`;
  }
  return patient.age !== null ? `not recorded (age ${patient.age} as entered)` : "not recorded";
}

/**
 * The patient block's cells. Without a loaded record the block still names the
 * patient and says the rest could not be loaded, rather than leaving it out.
 */
export function patientCells(patient: ReportPatient | null, fallbackName: string, on: Date, timeZone?: string): DetailCell[] {
  if (!patient) {
    return [
      { label: "Name", value: fallbackName, strong: true },
      { label: "Other details", value: "The patient's record could not be loaded when this report was made.", wide: true },
    ];
  }
  return [
    { label: "Name", value: patient.name, strong: true },
    { label: "Patient ID", value: patient.id },
    { label: "Date of birth (age)", value: birthText(patient, on, timeZone) },
    { label: "Gender", value: patient.gender?.trim() || "not recorded" },
    { label: "Assigned therapist", value: patient.therapistName?.trim() || "none assigned" },
    { label: "Diagnosis (entered by the clinic)", value: patient.diagnosis?.trim() || "not recorded", wide: true },
    { label: "Condition (entered by the clinic)", value: patient.condition?.trim() || "not recorded", wide: true },
  ];
}

/** The running footer: the patient is named, with their ID, on every page. */
export function reportFooter(kind: "session" | "progress", name: string, patientId: string | null, generated: string): string {
  return [`Postural ${kind} report`, name, ...(patientId ? [`ID ${patientId}`] : []), `generated ${generated}`].join(" · ");
}

const text = (value: unknown) => (typeof value === "string" ? value : null);

/** The patient's record for the report, or null when it cannot be loaded. */
export async function fetchReportPatient(patientId: string): Promise<ReportPatient | null> {
  try {
    const response = await fetch(`/api/users/${encodeURIComponent(patientId)}`, { cache: "no-store" });
    if (!response.ok) return null;
    const user = ((await response.json()) as { user?: Record<string, unknown> }).user;
    if (!user || typeof user.id !== "string" || typeof user.name !== "string") return null;
    return {
      id: user.id,
      name: user.name,
      dateOfBirth: text(user.dateOfBirth),
      age: typeof user.age === "number" && Number.isFinite(user.age) ? user.age : null,
      gender: text(user.gender),
      therapistName: text(user.therapistName),
      diagnosis: text(user.diagnosis),
      condition: text(user.condition),
    };
  } catch {
    return null;
  }
}

/** The signed-in user's id, for a patient downloading their own report. */
export async function fetchSignedInUserId(): Promise<string | null> {
  try {
    const response = await fetch("/api/auth/me", { cache: "no-store" });
    if (!response.ok) return null;
    const user = ((await response.json()) as { user?: { id?: unknown } }).user;
    return typeof user?.id === "string" ? user.id : null;
  } catch {
    return null;
  }
}
