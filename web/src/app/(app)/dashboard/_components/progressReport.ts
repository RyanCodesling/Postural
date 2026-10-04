/**
 * The cumulative progress PDF. Every download fetches the saved sessions
 * afresh, so it covers everything saved by then; a downloaded file is a dated
 * snapshot. Groups, values and trend labels are the same as the Progress
 * Trends cards: the labels and change estimates come from the machine-learning
 * trend model. Supplementary information, not a diagnosis.
 */
import { TREND_MODEL } from "@/lib/analytics/trendModel";
import {
  BAND_WITHHELD,
  changeText,
  extraTrendMeasures,
  groupModelSeries,
  TREND_LABEL_TEXT,
  trendMeasures,
  type ModelSeries,
} from "@/lib/analytics/trendSeries";
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
  modelMeasureMeta,
  primaryMetricMeta,
  sessionPrimaryValue,
  type TrendSession,
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

/** One report row per series: the model label with its change estimate. */
function modelRow(series: ModelSeries, format: (value: number) => string, unit: string): [string, string] {
  const side = series.side === "card" ? "" : ` (${series.side})`;
  if (!series.spec) return [`Trend${side}`, "no trend model for this exercise"];
  if (!series.fit || series.counted < TREND_MODEL.minSessions) {
    return [`Trend${side}`, `needs at least ${TREND_MODEL.minSessions} counted sessions`];
  }
  const change = `change ${changeText(series.fit, (v) => `${format(v)}${unit}`)}`;
  return [`Trend${side}`, series.label ? `${TREND_LABEL_TEXT[series.label]}, ${change}` : change];
}

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
      "Trend labels come from the machine-learning trend model: Rising or Falling appears only when a side's change since its " +
      "first counted session is larger than normal session-to-session variation. Supplementary information, not a diagnosis.",
    { size: 8.5, color: COLORS.muted },
  );
  if (groups.length === 0) layout.paragraph("No session with a recorded set yet.");

  for (const group of groups) {
    const meta = primaryMetricMeta(group.exerciseKind, group.primaryMetric);
    const isIso = group.exerciseKind === "isometric";
    const sides = prescribedOutcomeSides(group.prescribedSide);
    const values = group.sessions.map(sessionPrimaryValue);
    const present = values.filter((v): v is number => v !== null);
    const fmt = (v: number) => (isIso ? `${v.toFixed(1)}s` : meta.isAngle ? String(Math.round(v)) : v.toFixed(2));
    const first = group.sessions[0].startedAt;
    const last = group.sessions[group.sessions.length - 1].startedAt;
    const measures = trendMeasures(group.exerciseKind);
    const modelMeta = modelMeasureMeta(group.exerciseKind, group.primaryMetric);
    const primary = groupModelSeries(group.exerciseId, group.prescribedSide, group.sessions, measures.primary, true);
    const form = groupModelSeries(group.exerciseId, group.prescribedSide, group.sessions, measures.form, measures.formPerSide);

    layout.heading(group.exerciseName);
    layout.keyValues([
      ["Context", `${group.prescribedSide === "both" ? "Both sides" : `${sideLabel(group.prescribedSide)} side`} · ${formatResistanceContext(group.resistance)}`],
      ["Sessions", `${group.sessions.length}, ${day(first)} to ${day(last)}`],
      ...primary.map((s) => modelRow(s, modelMeta.format, modelMeta.changeUnit)),
      ...form.map((s): [string, string] => {
        const [key, value] = modelRow(s, (v) => v.toFixed(0), "");
        return [key.replace("Trend", "Form score"), value];
      }),
      [meta.label, present.length ? `first ${fmt(present[0])} · latest ${fmt(present[present.length - 1])}` : "not recorded"],
    ]);
    layout.chart(
      primary.map((s) => ({
        label: `${s.side === "card" ? "" : `${sideLabel(s.side)} `}${modelMeta.label.toLowerCase()}`,
        color: s.side === "right" ? COLORS.orange : s.side === "left" ? COLORS.blue : COLORS.green,
        values: s.values,
      })),
      { first: day(first), last: day(last) },
      (v) => `${modelMeta.format(v)}${modelMeta.unit}`,
    );
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

    // Other measures: the model's change estimate, never a label. Where the
    // model gives no estimate (no band for the measure, or too few sessions),
    // the dated measured values stand in for it.
    const extras = extraTrendMeasures(group.exerciseId, group.exerciseKind)
      .map((def) => ({ def, series: groupModelSeries(group.exerciseId, group.prescribedSide, group.sessions, def.measure, true) }))
      .filter(({ series }) => series.some((s) => s.counted > 0));
    const measured = (s: ModelSeries, format: (value: number) => string, unit: string) =>
      group.sessions
        .flatMap((session, i) => {
          const value = s.values[i];
          return value === null ? [] : [`${day(session.startedAt)}: ${format(value)}${unit}`];
        })
        .join(" · ");
    if (extras.length > 0) {
      layout.table(
        [
          { header: "Other measure", width: 3.4 },
          { header: "Side", width: 0.7 },
          { header: "Sessions", width: 0.8, align: "right" },
          { header: "Model change since first counted session (95 % range), or measured values", width: 3.6 },
        ],
        extras.flatMap(({ def, series }) =>
          series.filter((s) => s.counted > 0).map((s) => [
            def.title,
            s.side === "card" ? "—" : sideLabel(s.side),
            String(s.counted),
            s.spec?.band === false
              ? `${BAND_WITHHELD.has(`${s.spec.exercise}:${s.spec.measure}`)
                ? "band withheld, target changed after learning"
                : "no model band"}; measured ${measured(s, def.format, def.unit)}`
              : s.fit
                ? changeText(s.fit, (v) => `${def.format(v)}${def.changeUnit}`)
                : `needs at least 2 counted sessions; measured ${measured(s, def.format, def.unit)}`,
          ]),
        ),
      );
    }
  }

  layout.heading("Notes");
  for (const note of REPORT_NOTES) layout.paragraph(note, { size: 8.5, color: COLORS.muted });
  layout.paragraph("Sessions that were started but recorded no set are left out.", { size: 8.5, color: COLORS.muted });
  layout.paragraph(
    `Trend model ${TREND_MODEL.version}: a Gaussian-process model of each side's session results that learned how much ` +
      "results normally vary between sessions. Sessions with fewer than 3 repetitions on a side are not counted, " +
      "and holds are compared as time in the target band relative to the prescribed hold.",
    { size: 8.5, color: COLORS.muted },
  );
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
