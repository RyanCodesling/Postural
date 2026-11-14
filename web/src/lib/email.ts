import * as nodemailer from "nodemailer";

const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM = process.env.SMTP_FROM || "accbpostural.noreply@gmail.com";

function getTransporter() {
  if (!SMTP_USER || !SMTP_PASS) {
    console.warn(
      "[email] SMTP_USER or SMTP_PASS not configured — emails will not be sent."
    );
    return null;
  }
  return nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
    // Bound each send (review 2026-10-15, finding 4). Nodemailer's defaults
    // wait up to 2 minutes to connect and 10 minutes on a silent connection.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
}

// ── Core send function ────────────────────────────────────────────────────────

export async function sendEmail(
  to: string,
  subject: string,
  html: string
): Promise<boolean> {
  const transporter = getTransporter();
  if (!transporter) return false;

  try {
    await transporter.sendMail({
      from: `"ACC Bacoor - Postural Monitoring" <${SMTP_FROM}>`,
      to,
      subject,
      html,
    });
    return true;
  } catch (err) {
    console.error("[email] Failed to send email:", err);
    return false;
  }
}

// ── Shared layout ─────────────────────────────────────────────────────────────
// A plain, letter-like layout: white page, the clinic's name in text, one thin
// green rule, left-aligned copy, and details as simple label/value rows. Inline
// styles and tables only, as email clients require.

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace";
const INK = "#1f2933";
const STRONG = "#111827";
const MUTED = "#6b7280";
const RULE = "#e5e7eb";
const BRAND = "#166534";
const TONE = { warn: "#b45309", danger: "#b91c1c", ok: "#166534", info: "#9ca3af" } as const;

const PARAGRAPH = `margin:0 0 16px;color:${INK};font-size:15px;line-height:1.6;`;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A paragraph of body copy. `html` may hold <strong>; plain values must be escaped first. */
function para(html: string): string {
  return `<p style="${PARAGRAPH}">${html}</p>`;
}

function greeting(name: string): string {
  return para(`Hello ${escapeHtml(name)},`);
}

/** Label / value rows between hairlines. Values are HTML. */
function details(rows: [label: string, valueHtml: string][]): string {
  const cells = rows
    .map(
      ([label, value]) => `<tr>
        <td style="padding:10px 16px 10px 0;border-top:1px solid ${RULE};color:${MUTED};font-size:14px;line-height:1.5;width:38%;vertical-align:top;">${label}</td>
        <td style="padding:10px 0;border-top:1px solid ${RULE};color:${STRONG};font-size:14px;line-height:1.5;vertical-align:top;">${value}</td>
      </tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-bottom:1px solid ${RULE};margin:4px 0 20px;">${cells}</table>`;
}

/** A short note set off by a coloured rule on its left. */
function notice(html: string, tone: keyof typeof TONE): string {
  return `<p style="margin:0 0 16px;padding:2px 0 2px 12px;border-left:3px solid ${TONE[tone]};color:${INK};font-size:14px;line-height:1.6;">${html}</p>`;
}

/** Rows of an exercise list: name (with an optional second line) on the left, value on the right. */
function listRows(rows: { name: string; sub?: string; value: string; valueColor?: string }[]): string {
  const cells = rows
    .map(
      (r) => `<tr>
        <td style="padding:10px 16px 10px 0;border-top:1px solid ${RULE};color:${STRONG};font-size:14px;line-height:1.5;vertical-align:top;">${escapeHtml(r.name)}${r.sub ? `<br/><span style="color:${MUTED};font-size:13px;">${escapeHtml(r.sub)}</span>` : ""}</td>
        <td align="right" style="padding:10px 0;border-top:1px solid ${RULE};color:${r.valueColor ?? INK};font-size:14px;line-height:1.5;white-space:nowrap;vertical-align:top;">${escapeHtml(r.value)}</td>
      </tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-bottom:1px solid ${RULE};margin:0 0 20px;">${cells}</table>`;
}

function groupHeading(name: string, note?: string): string {
  return `<p style="margin:20px 0 6px;color:${STRONG};font-size:14px;font-weight:600;">${escapeHtml(name)}${note ? ` <span style="color:${MUTED};font-weight:400;">· ${escapeHtml(note)}</span>` : ""}</p>`;
}

function wrapTemplate(rawTitle: string, body: string): string {
  // Headings read as plain sentences: "Exercises due tomorrow", not Title Case.
  const title = rawTitle.charAt(0).toUpperCase() + rawTitle.slice(1).toLowerCase();
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
</head>
<body style="margin:0;padding:0;background-color:#f5f5f4;font-family:${FONT};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f4;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid #e7e5e4;border-top:3px solid ${BRAND};">
          <tr>
            <td style="padding:28px 36px 0;font-family:${FONT};">
              <p style="margin:0;color:${BRAND};font-size:13px;font-weight:600;">ACC+ Bacoor</p>
              <p style="margin:2px 0 0;color:${MUTED};font-size:13px;">Postural Monitoring System</p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 36px 12px;font-family:${FONT};">
              <h1 style="margin:0 0 20px;color:${STRONG};font-size:21px;line-height:1.3;font-weight:600;">${title}</h1>
              ${body}
            </td>
          </tr>
          <tr>
            <td style="padding:20px 36px 28px;border-top:1px solid ${RULE};font-family:${FONT};">
              <p style="margin:0 0 6px;color:${MUTED};font-size:12px;line-height:1.6;">
                ACC+ Bacoor Orthopaedic and Physical Therapy Clinic<br/>
                Unit 1, L-1F, Tirona Highway, Habay 1, Bacoor City, Cavite · (046) 416 7479
              </p>
              <p style="margin:0;color:${MUTED};font-size:12px;line-height:1.6;">
                This is an automated message. Please do not reply to this email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();
}

// ── Account creation email ────────────────────────────────────────────────────

export async function sendAccountCreationEmail(
  email: string,
  name: string,
): Promise<boolean> {
  const subject = "Welcome to ACC Bacoor Postural Monitoring System";
  const body = `
    ${greeting(name)}
    ${para("Your account has been created on the ACC Bacoor Postural Monitoring System. Below are your login credentials:")}
    ${details([
      ["Email", escapeHtml(email)],
      ["Password", `Your <strong>last name + year of birth</strong><br/><span style="color:${MUTED};">e.g. DelaCruz2004</span>`],
    ])}
    ${para("For security, you will be asked to change your password when you first log in.")}
  `;
  return sendEmail(email, subject, wrapTemplate("Welcome", body));
}

// ── Password changed email ────────────────────────────────────────────────────

export async function sendPasswordChangedEmail(
  email: string,
  name: string,
  /** Patients are pointed to their therapist, therapists to the clinic's administrator, and admins to securing their own account. */
  role: string = "patient",
): Promise<boolean> {
  const subject = "Your Password Has Been Changed";
  const contact = role === "admin"
    ? "If you did not make this change, please secure your account immediately."
    : role === "therapist"
      ? "If you did not make this change, please contact the clinic's administrator immediately."
      : "If you did not make this change, please contact your assigned therapist to inform the clinic's administrator immediately.";
  const body = `
    ${greeting(name)}
    ${para("Your password for the ACC Bacoor Postural Monitoring System has been successfully changed.")}
    ${notice(contact, "warn")}
    ${para("You can continue using the system with your new password.")}
  `;
  return sendEmail(email, subject, wrapTemplate("Password changed", body));
}

// ── OTP email ─────────────────────────────────────────────────────────────────

export async function sendOTPEmail(
  email: string,
  name: string,
  otp: string
): Promise<boolean> {
  const subject = "Your Password Reset Code";
  const body = `
    ${greeting(name)}
    ${para("We received a request to reset your password. Use the verification code below to proceed:")}
    <p style="margin:4px 0 24px;color:${STRONG};font-family:${MONO};font-size:32px;font-weight:600;letter-spacing:8px;">${escapeHtml(otp)}</p>
    ${notice("This code expires in <strong>5 minutes</strong>. Do not share it with anyone.", "danger")}
    ${para("If you did not request a password reset, you can safely ignore this email.")}
  `;
  return sendEmail(email, subject, wrapTemplate("Password reset code", body));
}

// ── Account created — admin notification ─────────────────────────────────────

export async function sendAccountCreatedAdminEmail(
  adminEmail: string,
  newUserName: string,
  newUserEmail: string,
  newUserRole: string
): Promise<boolean> {
  const subject = "New User Account Created";
  const body = `
    ${para("This is a confirmation that a new user account has been created in the system.")}
    ${details([
      ["Name", escapeHtml(newUserName)],
      ["Email", escapeHtml(newUserEmail)],
      ["Role", `<span style="text-transform:capitalize;">${escapeHtml(newUserRole)}</span>`],
    ])}
    ${para("An activation email with login credentials has been sent to the new user.")}
  `;
  return sendEmail(adminEmail, subject, wrapTemplate("New account created", body));
}

// ── Email address changed — old address ───────────────────────────────────────

/** Who an account holder should tell about an email change they did not make. */
function unauthorizedEmailChangeNotice(role: string): string {
  const text = role === "admin"
    ? "If you did not authorize this change, please secure your account immediately."
    : role === "therapist"
      ? "If you did not authorize this change, please inform the clinic's administrator immediately."
      : "If you did not authorize this change, please contact your assigned therapist to inform the clinic's administrator immediately.";
  return notice(text, "warn");
}

export async function sendEmailChangedToOldAddress(
  oldEmail: string,
  name: string,
  newEmail: string,
  role: string = "patient",
): Promise<boolean> {
  const subject = "Your Email Address Has Been Updated";
  const body = `
    ${greeting(name)}
    ${para("The email address linked to your account on the ACC Bacoor Postural Monitoring System has been changed by the clinic's administrator.")}
    ${details([
      ["Old email address", `<span style="color:${MUTED};text-decoration:line-through;">${escapeHtml(oldEmail)}</span>`],
      ["New email address", escapeHtml(newEmail)],
    ])}
    ${para(`Your new email address <strong>${escapeHtml(newEmail)}</strong> will now be used to log in to the system. Your old email address is no longer active for login.`)}
    ${unauthorizedEmailChangeNotice(role)}
  `;
  return sendEmail(oldEmail, subject, wrapTemplate("Email address updated", body));
}

// ── Email address changed — new address ───────────────────────────────────────

export async function sendEmailChangedToNewAddress(
  newEmail: string,
  name: string,
  oldEmail: string,
  role: string = "patient",
): Promise<boolean> {
  const subject = "Your New Email Address Is Now Active";
  const body = `
    ${greeting(name)}
    ${para("Your email address on the ACC Bacoor Postural Monitoring System has been updated by the clinic's administrator. Here are the details:")}
    ${details([
      ["Previous email", `<span style="color:${MUTED};text-decoration:line-through;">${escapeHtml(oldEmail)}</span>`],
      ["New email (now active)", escapeHtml(newEmail)],
    ])}
    ${para(`Use <strong>${escapeHtml(newEmail)}</strong> to log in to the system from now on.`)}
    ${unauthorizedEmailChangeNotice(role)}
  `;
  return sendEmail(newEmail, subject, wrapTemplate("New email address active", body));
}

// ── Email address changed — admin notification ────────────────────────────────

export async function sendEmailChangedAdminNotification(
  adminEmail: string,
  userName: string,
  oldEmail: string,
  newEmail: string
): Promise<boolean> {
  const subject = "User Email Address Changed";
  const body = `
    ${para("This is a confirmation that a user's email address was updated in the system.")}
    ${details([
      ["User", escapeHtml(userName)],
      ["Old email address", `<span style="color:${MUTED};text-decoration:line-through;">${escapeHtml(oldEmail)}</span>`],
      ["New email address", escapeHtml(newEmail)],
    ])}
    ${para(`The user will now use <strong>${escapeHtml(newEmail)}</strong> to log in to the system.`)}
  `;
  return sendEmail(adminEmail, subject, wrapTemplate("Email address change", body));
}

// ── Account archived — user notification ─────────────────────────────────────

export async function sendAccountArchivedUserEmail(
  email: string,
  name: string
): Promise<boolean> {
  const subject = "Your Account Has Been Archived";
  const body = `
    ${greeting(name)}
    ${para("Your account on the ACC Bacoor Postural Monitoring System has been archived by the clinic's administrator.")}
    ${notice("Your account access has been temporarily suspended. Your records remain intact in the system. If you believe this was done in error, please contact the clinic's administrator.", "warn")}
    ${para("Thank you for using the ACC Bacoor Postural Monitoring System.")}
  `;
  return sendEmail(email, subject, wrapTemplate("Account archived", body));
}

// ── Account archived — admin notification ────────────────────────────────────

/** Name, email and role of the account an admin acted on. */
function accountRows(name: string, email: string, role: string): string {
  return details([
    ["Name", escapeHtml(name)],
    ["Email", escapeHtml(email || "—")],
    ["Role", `<span style="text-transform:capitalize;">${escapeHtml(role)}</span>`],
  ]);
}

export async function sendAccountArchivedAdminEmail(
  adminEmail: string,
  archivedName: string,
  archivedEmail: string,
  archivedRole: string
): Promise<boolean> {
  const subject = "User Account Archived";
  const body = `
    ${para("This is a confirmation that the following user account has been archived in the system.")}
    ${accountRows(archivedName, archivedEmail, archivedRole)}
    ${para("The user's records remain intact. You can restore the account at any time from the Manage Users panel.")}
  `;
  return sendEmail(adminEmail, subject, wrapTemplate("Account archived", body));
}

// ── Account restored — user notification ─────────────────────────────────────

export async function sendAccountRestoredUserEmail(
  email: string,
  name: string
): Promise<boolean> {
  const subject = "Your Account Has Been Restored";
  const body = `
    ${greeting(name)}
    ${para("Your account on the ACC Bacoor Postural Monitoring System has been restored by the clinic's administrator.")}
    ${notice("Your account is now active again. You can log in using your existing credentials.", "ok")}
    ${para("All your past records and data remain intact.")}
  `;
  return sendEmail(email, subject, wrapTemplate("Account restored", body));
}

// ── Account restored — admin notification ────────────────────────────────────

export async function sendAccountRestoredAdminEmail(
  adminEmail: string,
  restoredName: string,
  restoredEmail: string,
  restoredRole: string
): Promise<boolean> {
  const subject = "User Account Restored";
  const body = `
    ${para("This is a confirmation that the following user account has been restored and can now access the system.")}
    ${accountRows(restoredName, restoredEmail, restoredRole)}
    ${para("The user can now log in and access the system with all their previous records restored.")}
  `;
  return sendEmail(adminEmail, subject, wrapTemplate("Account restored", body));
}

// ── Account permanently deleted — user notification ───────────────────────────

export async function sendAccountDeletedUserEmail(
  email: string,
  name: string,
): Promise<boolean> {
  const subject = "Your Account Has Been Permanently Deleted";
  const body = `
    ${greeting(name)}
    ${para("Your account on the ACC Bacoor Postural Monitoring System has been permanently deleted by the clinic's administrator.")}
    ${notice("This action is permanent. Your history-free account record and its non-clinical access data cannot be recovered. Accounts with durable clinical or assignment history are archived instead of permanently deleted.", "danger")}
    ${para("Thank you for your time using our system.")}
  `;
  return sendEmail(email, subject, wrapTemplate("Account deleted", body));
}

// ── Account permanently deleted — admin notification ──────────────────────────

export async function sendAccountDeletedAdminEmail(
  adminEmail: string,
  deletedName: string,
  deletedEmail: string,
  deletedRole: string
): Promise<boolean> {
  const subject = "User Account Permanently Deleted";
  const body = `
    ${para("This is a confirmation that the following user account has been permanently deleted from the system.")}
    ${accountRows(deletedName, deletedEmail, deletedRole)}
    ${para("The account passed the archived and history-free eligibility checks before deletion. Accounts with durable clinical or assignment history remain archived and cannot be permanently deleted.")}
  `;
  return sendEmail(adminEmail, subject, wrapTemplate("Account deleted", body));
}

// ── Therapist exercise emails ────────────────────────────────────────────────

export function emailConfigured(): boolean {
  return Boolean(SMTP_USER && SMTP_PASS);
}

export interface ExerciseDigestItem {
  patientName: string;
  exerciseName: string;
  sets: number;
  /** The per-set target in the app's words: "10 reps", or "30s hold" for a hold exercise. */
  target: string;
  dueDateLabel: string;
}

/** One email per recipient per day. Therapists see rows grouped by patient; patients see their own list. */
export async function sendExerciseDigestEmail(
  email: string,
  recipientName: string,
  kind: "completed" | "missed",
  dayLabel: string,
  items: ExerciseDigestItem[],
  role: string = "therapist",
): Promise<boolean> {
  const completed = kind === "completed";
  const forPatient = role === "patient";
  const plural = items.length === 1 ? "" : "s";
  const title = `Exercise${plural} ${completed ? "Completed" : "Missed"}`;
  const subject = `${title} – ${dayLabel}`;
  // "Your patient" for one patient, "Your patients" for more.
  const patientCount = new Set(items.map((item) => item.patientName)).size;
  const yourPatients = patientCount === 1 ? "your patient" : "your patients";
  const intro = forPatient
    ? completed
      ? `You completed ${items.length} exercise${plural} on ${dayLabel}.`
      : `You have missed ${items.length} exercise${plural} (the last day to make ${items.length === 1 ? "it" : "them"} up was ${dayLabel}).`
    : completed
      ? `${yourPatients.charAt(0).toUpperCase()}${yourPatients.slice(1)} completed ${items.length} exercise${plural} on ${dayLabel}.`
      : `${items.length} exercise${items.length === 1 ? " was" : "s were"} missed by ${yourPatients} (final make-up day was ${dayLabel}).`;

  const byPatient = new Map<string, ExerciseDigestItem[]>();
  for (const item of items) {
    byPatient.set(item.patientName, [...(byPatient.get(item.patientName) ?? []), item]);
  }
  const groups = [...byPatient.entries()]
    .map(([patient, rows]) => `
      ${forPatient ? "" : groupHeading(patient)}
      ${listRows(rows.map((r) => ({
        name: r.exerciseName,
        sub: completed ? undefined : `Scheduled ${r.dueDateLabel}`,
        value: `${r.sets} sets × ${r.target}`,
      })))}`)
    .join("");

  const body = `
    ${greeting(recipientName)}
    ${para(escapeHtml(intro))}
    ${groups}`;
  return sendEmail(email, subject, wrapTemplate(title, body));
}

export interface ExerciseReminderItem {
  exerciseName: string;
  sets: number;
  /** The per-set target in the app's words: "10 reps", or "30s hold" for a hold exercise. */
  target: string;
}

/** Patient template: every exercise due on one day, sent the evening before and that morning. */
export async function sendExerciseReminderEmail(
  email: string,
  patientName: string,
  when: "today" | "tomorrow",
  dayLabel: string,
  items: ExerciseReminderItem[],
): Promise<boolean> {
  const n = items.length;
  const title = `Exercise${n === 1 ? "" : "s"} Due ${when === "today" ? "Today" : "Tomorrow"}`;
  const intro = `You have ${n} exercise${n === 1 ? "" : "s"} due ${when}, ${dayLabel}:`;
  const body = `
    ${greeting(patientName)}
    ${para(escapeHtml(intro))}
    ${listRows(items.map((r) => ({ name: r.exerciseName, value: `${r.sets} sets × ${r.target}` })))}`;
  return sendEmail(email, `${title} – ${dayLabel}`, wrapTemplate(title, body));
}

export interface MakeupItem {
  patientName: string;
  exerciseName: string;
  sets: number;
  /** The per-set target in the app's words: "10 reps", or "30s hold" for a hold exercise. */
  target: string;
  /** "November 8, 2026": the day it was scheduled for. */
  dueDateLabel: string;
  /** "November 9, 2026": the last day it can be made up. */
  lastDayLabel: string;
}

/**
 * Sent on the first make-up day: exercises not finished on their scheduled day
 * that can still be done. Patients get their own list; therapists get one email
 * grouped by patient.
 */
export async function sendMakeupAvailableEmail(
  email: string,
  recipientName: string,
  role: "patient" | "therapist",
  todayLabel: string,
  items: MakeupItem[],
): Promise<boolean> {
  const n = items.length;
  const plural = n === 1 ? "" : "s";
  const title = `Make-up Exercise${plural} Available`;
  const patientCount = new Set(items.map((item) => item.patientName)).size;
  const intro = role === "patient"
    ? `You did not finish ${n} exercise${plural} on ${n === 1 ? "its" : "their"} scheduled day. You can still make ${n === 1 ? "it" : "them"} up today, ${todayLabel}:`
    : `${patientCount === 1 ? "Your patient" : "Your patients"} did not finish ${n} exercise${plural} on ${n === 1 ? "its" : "their"} scheduled day. ${n === 1 ? "It" : "They"} can still be made up today, ${todayLabel}:`;
  const rowsFor = (rows: MakeupItem[]) => listRows(rows.map((r) => ({
    name: r.exerciseName,
    sub: `Scheduled ${r.dueDateLabel} · last day to make up: ${r.lastDayLabel}`,
    value: `${r.sets} sets × ${r.target}`,
  })));
  let list: string;
  if (role === "patient") {
    list = rowsFor(items);
  } else {
    const byPatient = new Map<string, MakeupItem[]>();
    for (const item of items) byPatient.set(item.patientName, [...(byPatient.get(item.patientName) ?? []), item]);
    list = [...byPatient.entries()].map(([patient, rows]) => `${groupHeading(patient)}${rowsFor(rows)}`).join("");
  }
  const closing = role === "patient"
    ? "An exercise not done by its last make-up day is marked as missed."
    : "An exercise not done by its last make-up day is marked as missed, and you will be notified.";
  const body = `
    ${greeting(recipientName)}
    ${para(escapeHtml(intro))}
    ${list}
    ${notice(escapeHtml(closing), "info")}`;
  return sendEmail(email, `${title} – ${todayLabel}`, wrapTemplate(title, body));
}

export interface PartialDayItem {
  exerciseName: string;
  /** "Completed", "Not started", "Started, not finished", or "Paused because of pain". */
  status: string;
  /** The prescription, and for an unfinished exercise where it stopped. */
  detail: string;
}

export interface PartialDayPatient {
  patientName: string;
  completed: number;
  total: number;
  items: PartialDayItem[];
}

/** Therapist template: the patients who did only part of one day's exercises. */
export async function sendPartialDayEmail(
  email: string,
  therapistName: string,
  dayLabel: string,
  patients: PartialDayPatient[],
): Promise<boolean> {
  const n = patients.length;
  const intro = n === 1
    ? `Your patient completed only part of the exercises scheduled for ${dayLabel}.`
    : `${n} of your patients completed only part of the exercises scheduled for ${dayLabel}.`;
  const statusColor = (status: string) =>
    status === "Completed" ? TONE.ok : status === "Paused because of pain" ? TONE.danger : TONE.warn;
  const groups = patients
    .map((p) => `
      ${groupHeading(p.patientName, `${p.completed} of ${p.total} completed`)}
      ${listRows(p.items.map((r) => ({ name: r.exerciseName, sub: r.detail, value: r.status, valueColor: statusColor(r.status) })))}`)
    .join("");
  const body = `
    ${greeting(therapistName)}
    ${para(escapeHtml(intro))}
    ${groups}`;
  return sendEmail(email, `Partially Completed Exercises – ${dayLabel}`, wrapTemplate("Partially Completed Exercises", body));
}

export interface ExercisePausedDetails {
  patientName: string;
  exerciseName: string;
  prescribedSets: number;
  prescribedReps: number;
  /** The per-set target in the app's words: "10 reps", or "30s hold" for a hold exercise. */
  prescribedTarget: string;
  /** A hold exercise: its progress is the sets held, as it has no repetitions. */
  isHold: boolean;
  /** Set the patient was in when they paused (1-based), or null if no rep was recorded. */
  pausedSet: number | null;
  repsInPausedSet: number;
  completedSets: number;
  /** A custom exercise: guided, so no sets or repetitions were counted. */
  custom?: boolean;
}

export function describePausedProgress(d: ExercisePausedDetails): string {
  if (d.custom) {
    return `a custom exercise, so no sets or reps are counted (prescribed ${d.prescribedSets} sets × ${d.prescribedTarget})`;
  }
  if (d.isHold) {
    return d.completedSets > 0
      ? `${d.completedSets} of ${d.prescribedSets} sets completed before the pause`
      : `before completing any set (prescribed ${d.prescribedSets} sets × ${d.prescribedTarget})`;
  }
  if (d.pausedSet === null) {
    return `before completing any rep (prescribed ${d.prescribedSets} sets × ${d.prescribedTarget})`;
  }
  const setsPart = d.completedSets > 0
    ? `${d.completedSets} of ${d.prescribedSets} sets completed, `
    : "";
  return `${setsPart}paused in set ${d.pausedSet} of ${d.prescribedSets} after ${d.repsInPausedSet} of ${d.prescribedReps} reps`;
}

export async function sendExercisePausedEmail(
  email: string,
  recipientName: string,
  d: ExercisePausedDetails,
  role: "therapist" | "patient" = "therapist",
): Promise<boolean> {
  const sentence = role === "patient"
    ? `You paused <strong>${escapeHtml(d.exerciseName)}</strong> because of pain. Your therapist has been notified and will review it before rescheduling.`
    : `<strong>${escapeHtml(d.patientName)}</strong> paused <strong>${escapeHtml(d.exerciseName)}</strong> because of pain. Please review before rescheduling.`;
  const body = `
    ${greeting(recipientName)}
    ${para(sentence)}
    ${details([
      ["Prescribed", `${d.prescribedSets} sets × ${escapeHtml(d.prescribedTarget)}`],
      ["Progress", escapeHtml(describePausedProgress(d))],
    ])}`;
  return sendEmail(email, "Exercise paused because of pain", wrapTemplate("Exercise paused", body));
}

export interface HighPainNoStartDetails {
  patientName: string;
  exerciseName: string;
  score: number;
  bodyArea: string | null;
  /** "November 7, 2026": the day the exercise was scheduled for. */
  dueDateLabel: string;
}

/** Therapist template: a patient's pain score before starting was too high to exercise. */
export async function sendHighPainNoStartEmail(
  email: string,
  therapistName: string,
  d: HighPainNoStartDetails,
): Promise<boolean> {
  const rows: [string, string][] = [["Pain score", `<span style="color:${TONE.danger};font-weight:600;">${d.score}/10</span>`]];
  if (d.bodyArea) rows.push(["Body area", escapeHtml(d.bodyArea)]);
  rows.push(["Scheduled for", escapeHtml(d.dueDateLabel)]);
  const body = `
    ${greeting(therapistName)}
    ${para(`<strong>${escapeHtml(d.patientName)}</strong> did not start <strong>${escapeHtml(d.exerciseName)}</strong> because of a high pain score before starting. The exercise is marked as not started and needs your review before rescheduling.`)}
    ${details(rows)}`;
  return sendEmail(email, "Exercise not started because of high pain", wrapTemplate("High pain before exercise", body));
}

export interface CompletedWithPainDetails {
  patientName: string;
  exerciseName: string;
  /** The pain score reported before starting, 1 to 10. */
  score: number;
  bodyArea: string | null;
}

/** Therapist template: one exercise completed after the patient reported pain before starting. */
export async function sendCompletedWithPainEmail(
  email: string,
  therapistName: string,
  d: CompletedWithPainDetails,
): Promise<boolean> {
  const rows: [string, string][] = [["Pain score before starting", `<span style="color:${TONE.warn};font-weight:600;">${d.score}/10</span>`]];
  if (d.bodyArea) rows.push(["Body area", escapeHtml(d.bodyArea)]);
  const body = `
    ${greeting(therapistName)}
    ${para(`<strong>${escapeHtml(d.patientName)}</strong> completed <strong>${escapeHtml(d.exerciseName)}</strong>.`)}
    ${notice("The patient reported pain before starting this exercise.", "warn")}
    ${details(rows)}`;
  return sendEmail(
    email,
    `Exercise Completed with Pain – ${d.exerciseName}`,
    wrapTemplate("Exercise completed with pain", body),
  );
}

// ── Therapist / patient assignment ───────────────────────────────────────────

/** Patient template: their therapist has been assigned or changed. */
export async function sendAssignedTherapistEmail(
  email: string,
  patientName: string,
  therapistName: string,
): Promise<boolean> {
  const body = `
    ${greeting(patientName)}
    ${para(`<strong>${escapeHtml(therapistName)}</strong> is now your assigned therapist. Your therapist will prescribe and monitor your exercises.`)}`;
  return sendEmail(email, "You Have an Assigned Therapist", wrapTemplate("Assigned therapist", body));
}

/** Therapist template: a patient has been assigned to them. */
export async function sendAssignedPatientEmail(
  email: string,
  therapistName: string,
  patientName: string,
): Promise<boolean> {
  const body = `
    ${greeting(therapistName)}
    ${para(`Patient <strong>${escapeHtml(patientName)}</strong> has been assigned to you. You can now assign and monitor their exercises.`)}`;
  return sendEmail(email, "You Have a New Assigned Patient", wrapTemplate("Assigned patient", body));
}

// ── Assigned exercises ───────────────────────────────────────────────────────

export interface PrescriptionDetail {
  exerciseName: string;
  sets: number;
  /** "Reps", or "Hold" for a hold exercise, as the app labels the target. */
  metricLabel: "Reps" | "Hold";
  /** The target as the app shows it: "10", or "30s" for a hold. */
  metricValue: string;
  restSeconds: number;
  order: number;
  side: string;
  resistance: string;
  repeat: string;
  startLabel: string;
  endLabel: string;
  /** For changed exercises: field label -> its previous value. */
  changed?: Record<string, string>;
}

function prescriptionBlock(d: PrescriptionDetail): string {
  const was = (label: string) =>
    d.changed && label in d.changed
      ? ` <span style="color:${TONE.warn};">(was ${escapeHtml(d.changed[label])})</span>`
      : "";
  const row = (label: string, value: string | number): [string, string] => [label, `${escapeHtml(String(value))}${was(label)}`];
  return `
    <p style="margin:20px 0 6px;color:${STRONG};font-size:15px;font-weight:600;">${escapeHtml(d.exerciseName)}</p>
    ${details([
      row("Sets", d.sets),
      row(d.metricLabel, d.metricValue),
      row("Rest", `${d.restSeconds}s`),
      row("Order", d.order),
      row("Side", d.side),
      row("Resistance", d.resistance),
      row("Repeat", d.repeat),
      ["Schedule", `${escapeHtml(d.startLabel)} to ${escapeHtml(d.endLabel)}${was("Schedule")}`],
    ])}`;
}

function exercisesEmail(
  email: string,
  recipientName: string,
  subject: string,
  title: string,
  intro: string,
  prescriptions: PrescriptionDetail[],
): Promise<boolean> {
  const body = `
    ${greeting(recipientName)}
    ${para(intro)}
    ${prescriptions.map(prescriptionBlock).join("")}`;
  return sendEmail(email, subject, wrapTemplate(title, body));
}

/** "Assigned Exercises" template. The patient receives it from their therapist; the therapist gets a copy. */
export function sendAssignedExercisesEmail(
  email: string,
  recipientName: string,
  role: "patient" | "therapist",
  otherName: string,
  details: PrescriptionDetail[],
): Promise<boolean> {
  const n = details.length;
  const intro = role === "patient"
    ? `<strong>${escapeHtml(otherName)}</strong> assigned you ${n} new exercise${n === 1 ? "" : "s"}:`
    : `You assigned ${n} new exercise${n === 1 ? "" : "s"} to <strong>${escapeHtml(otherName)}</strong>:`;
  return exercisesEmail(email, recipientName, "Exercises Assigned", "Assigned Exercises", intro, details);
}

/** "Changes on Assigned Exercises" template; changed fields show their previous value. */
export function sendAssignedExercisesChangedEmail(
  email: string,
  recipientName: string,
  role: "patient" | "therapist",
  otherName: string,
  details: PrescriptionDetail[],
): Promise<boolean> {
  const n = details.length;
  const intro = role === "patient"
    ? `<strong>${escapeHtml(otherName)}</strong> updated ${n} of your assigned exercise${n === 1 ? "" : "s"}:`
    : `You updated ${n} assigned exercise${n === 1 ? "" : "s"} for <strong>${escapeHtml(otherName)}</strong>:`;
  return exercisesEmail(email, recipientName, "Assigned Exercises Updated", "Changes on Assigned Exercises", intro, details);
}

/** "Removed Exercises" template; lists the prescriptions that were taken off the patient's program. */
export function sendRemovedExercisesEmail(
  email: string,
  recipientName: string,
  role: "patient" | "therapist",
  otherName: string,
  details: PrescriptionDetail[],
): Promise<boolean> {
  const n = details.length;
  const intro = role === "patient"
    ? `<strong>${escapeHtml(otherName)}</strong> removed ${n} exercise${n === 1 ? "" : "s"} from your program:`
    : `You removed ${n} exercise${n === 1 ? "" : "s"} from <strong>${escapeHtml(otherName)}</strong>'s program:`;
  return exercisesEmail(email, recipientName, "Exercises Removed", "Removed Exercises", intro, details);
}
