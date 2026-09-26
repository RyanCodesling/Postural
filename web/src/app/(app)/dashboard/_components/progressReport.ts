/**
 * The cumulative progress PDF. Every download fetches the saved sessions
 * afresh, so it covers everything saved by then; a downloaded file is a dated
 * snapshot. Groups, values and trend labels are the same as the Progress
 * Trends cards; like them, it is descriptive statistics, not a diagnosis.
 */
import {
  formatPreSessionPain,
  formatResistanceContext,
  preSessionPainFromContext,
  type PainReportStatus,
  type PainTiming,
} from "@/lib/prescriptionContext";
import { downloadPdf, reportFileName } from "@/lib/reports/download";
import { COLORS, ReportLayout, type TableColumn } from "@/lib/reports/pdfWriter";
import {
  formatPainAfter,
  REPORT_NOTES,
  reportDateFormatter,
  type ReportOptions,
} from "@/lib/reports/sessionReport";
import { prescribedOutcomeSides, sideLabel } from "@/lib/sessionOutcomePresentation";
import {
  groupSessionsByExercise,
  primaryMetricMeta,
  sessionPrimaryValue,
  trendStatus,
  type TrendSession,
  type TrendStatus,
} from "./ExerciseTrends";

/** A `GET /api/sessions` summary; the extra fields are optional for older rows. */
export type ProgressReportSession = TrendSession & {
  endReason?: string | null;
  context?: unknown;
  painReport?: {
    status: PainReportStatus;
    score: number | null;
    timing: PainTiming | null;
    bodyArea: string | null;
  };
};

const STATUS_TEXT: Record<TrendStatus, string> = {
  improving: "Improving",
  plateau: "Plateau (no clear change)",
  regressing: "Regressing",
};

const ENDINGS: Record<string, string> = {
  completed: "Completed",
  user: "Ended early",
  pain: "Pain stop",
  superseded: "Replaced",
};

export function progressReportPdf(
  sessions: ProgressReportSession[],
  options: ReportOptions,
): Uint8Array<ArrayBuffer> {
  const date = reportDateFormatter(options.timeZone);
  const day = reportDateFormatter(options.timeZone, false);
  const layout = new ReportLayout(
    `Progress report: ${options.patientName}`,
    `Postural progress report · ${options.patientName} · generated ${date(options.generatedAt)}`,
    options.generatedAt,
  );
  const groups = groupSessionsByExercise(sessions);
  const outcomeSessions = groups.flatMap((g) => g.sessions);
  const times = outcomeSessions.map((s) => s.startedAt).sort();

  layout.title("Progress report", options.patientName);
  layout.keyValues([
    ["Data as of", date(options.generatedAt)],
    ["Sessions with results", times.length ? `${times.length}, from ${day(times[0])} to ${day(times[times.length - 1])}` : "none yet"],
    ["Exercises", String(new Set(groups.map((g) => g.exerciseId)).size)],
  ]);
  layout.paragraph(
    "Built from the sessions saved when it was downloaded; download it again to include later sessions. " +
      "Sessions are grouped by exercise, prescribed side, resistance and scoring configuration, as in the app's Progress Trends. " +
      "Trends are descriptive statistics, not a diagnosis.",
    { size: 8.5, color: COLORS.muted },
  );
  if (groups.length === 0) layout.paragraph("No session with a recorded set yet.");

  for (const group of groups) {
    const meta = primaryMetricMeta(group.exerciseKind, group.primaryMetric);
    const isIso = group.exerciseKind === "isometric";
    const sides = prescribedOutcomeSides(group.prescribedSide);
    const values = group.sessions.map(sessionPrimaryValue);
    const present = values.filter((v): v is number => v !== null);
    const status = trendStatus(present, meta.isAngle);
    const fmt = (v: number) => (isIso ? `${v.toFixed(1)}s` : meta.isAngle ? String(Math.round(v)) : v.toFixed(2));
    const first = group.sessions[0].startedAt;
    const last = group.sessions[group.sessions.length - 1].startedAt;

    layout.heading(group.exerciseName);
    layout.keyValues([
      ["Context", `${group.prescribedSide === "both" ? "Both sides" : `${sideLabel(group.prescribedSide)} side`} · ${formatResistanceContext(group.resistance)}`],
      ["Sessions", `${group.sessions.length}, ${day(first)} to ${day(last)}`],
      ["Trend", status ? STATUS_TEXT[status] : "Needs at least 3 sessions"],
      [meta.label, present.length ? `first ${fmt(present[0])} · latest ${fmt(present[present.length - 1])}` : "not recorded"],
    ]);
    layout.chart([{ label: meta.label, color: COLORS.green, values }], { first: day(first), last: day(last) }, fmt);
    if (!isIso) {
      layout.chart(
        sides.map((side) => ({
          label: `${sideLabel(side)} full-range reps`,
          color: side === "left" ? COLORS.blue : COLORS.orange,
          values: group.sessions.map((s) => (side === "left" ? s.completeLeftReps : s.completeRightReps)),
        })),
        { first: day(first), last: day(last) },
        (v) => String(Math.round(v)),
      );
    }

    const columns: TableColumn[] = [
      { header: "Date", width: 2.2 },
      { header: "Sets", width: 0.5, align: "right" },
      ...(isIso ? [] : sides.map((side): TableColumn => ({ header: `${sideLabel(side)} full-range`, width: 0.9, align: "right" }))),
      { header: meta.label, width: 1.3, align: "right" },
      { header: "Pain before", width: 1.1 },
      { header: "Pain after", width: 1 },
      { header: "Ended", width: 1 },
    ];
    layout.table(columns, group.sessions.map((s, i) => {
      const before = preSessionPainFromContext(s.context);
      const value = values[i];
      return [
        date(s.startedAt),
        String(s.setCount),
        ...(isIso ? [] : sides.map((side) => {
          const complete = side === "left" ? s.completeLeftReps : s.completeRightReps;
          const total = side === "left" ? s.leftReps : s.rightReps;
          return typeof total === "number" ? `${complete}/${total}` : String(complete);
        })),
        value === null ? "—" : fmt(value),
        before === null ? "—" : formatPreSessionPain(before),
        s.painReport ? formatPainAfter(s.painReport).replace("not reported", "—") : "—",
        (s.endReason && ENDINGS[s.endReason]) || "—",
      ];
    }));
  }

  layout.heading("Notes");
  for (const note of REPORT_NOTES) layout.paragraph(note, { size: 8.5, color: COLORS.muted });
  layout.paragraph("Sessions that were started but recorded no set are left out.", { size: 8.5, color: COLORS.muted });
  return layout.finish();
}

/**
 * The patient's saved sessions, fetched now rather than taken from the page,
 * which may have loaded before newer sessions were saved. A therapist passes
 * the patient's id; a patient passes none. Throws when they cannot be loaded.
 */
export async function fetchProgressSessions(source: { patientId?: string }): Promise<ProgressReportSession[]> {
  const url = source.patientId
    ? `/api/sessions?patientId=${encodeURIComponent(source.patientId)}`
    : "/api/sessions";
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  const body = (await response.json()) as { sessions?: ProgressReportSession[] };
  if (!Array.isArray(body.sessions)) throw new Error(`${url} returned no session list`);
  return body.sessions;
}

/** Fetches the latest saved sessions and saves the progress report. */
export async function downloadProgressReport(source: { patientId?: string }, patientName: string) {
  const sessions = await fetchProgressSessions(source);
  const generatedAt = new Date();
  downloadPdf(
    progressReportPdf(sessions, { patientName, generatedAt }),
    reportFileName("progress", patientName, generatedAt),
  );
}
