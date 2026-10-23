/**
 * The cumulative progress PDF. Every download fetches the saved sessions
 * afresh, so it covers everything saved by then; a downloaded file is a dated
 * snapshot. Groups, values and trend labels are the same as the Progress
 * Trends cards: the labels and change estimates come from the machine-learning
 * trend model. Supplementary information, not a diagnosis. Like the session
 * report, it opens with a patient block and lists results in tables, and it
 * adds the patient's current home exercise program.
 */
import { TREND_MODEL } from "@/lib/analytics/trendModel";
import {
  BAND_WITHHELD,
  BEFORE_CORRECTION_NOTE,
  changeText,
  extraTrendMeasures,
  groupModelSeries,
  heldOutSessionCount,
  TREND_LABEL_TEXT,
  trendMeasures,
  type ModelSeries,
  type TrendModelSession,
} from "@/lib/analytics/trendSeries";
import {
  formatPreSessionPain,
  formatResistanceContext,
  preSessionPainFromContext,
  type PainReportStatus,
  type PainTiming,
} from "@/lib/prescriptionContext";
import { downloadPdf, reportFileName } from "@/lib/reports/download";
import { fetchHomeProgram, homeProgramRow, type HomeProgramItem } from "@/lib/reports/homeProgram";
import { COLORS, ReportLayout, type TableCell, type TableColumn } from "@/lib/reports/pdfWriter";
import { fetchReportPatient, fetchSignedInUserId, patientCells, reportFooter } from "@/lib/reports/reportPatient";
import {
  ANGLE_NOTE,
  formatPainAfter,
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

/**
 * Sessions the trend data rules leave out of the trend line (drawn hollow on
 * the card where they can be plotted, absent from this chart), counted per
 * session rather than per side or per plotted point.
 */
export function heldOutRow(sessions: readonly TrendModelSession[]): [string, string][] {
  const count = heldOutSessionCount(sessions);
  return count > 0 ? [["Left out of the trend", `${count} session${count === 1 ? "" : "s"}: camera tracking was poor`]] : [];
}

/**
 * One results-table row per series: the measure, its side, how many sessions
 * count toward it, the model's change estimate since the first counted
 * session with its unit, and the model's label.
 */
function modelRow(series: ModelSeries, measure: string, format: (value: number) => string, unit: string): TableCell[] {
  const side = series.side === "card" ? "—" : sideLabel(series.side);
  const start = [measure, side, String(series.counted)];
  if (!series.spec) return [...start, "no trend model for this exercise", "—"];
  if (series.beforeCorrection) return [...start, `measured values only (${BEFORE_CORRECTION_NOTE})`, "—"];
  if (!series.fit || series.counted < TREND_MODEL.minSessions) {
    return [...start, `too few counted sessions so far (needs ${TREND_MODEL.minSessions})`, "—"];
  }
  return [...start, changeText(series.fit, (v) => `${format(v)}${unit}`), series.label ? TREND_LABEL_TEXT[series.label] : "—"];
}

export type ProgressReportOptions = ReportOptions & {
  /** The current home exercise program; null when it could not be loaded, absent to leave the section out. */
  program?: HomeProgramItem[] | null;
};

const ENDINGS: Record<string, string> = {
  completed: "Completed",
  user: "Ended early",
  pain: "Pain stop",
  superseded: "Replaced",
};

export function progressReportPdf(
  sessions: ProgressReportSession[],
  options: ProgressReportOptions,
): Uint8Array<ArrayBuffer> {
  const date = reportDateFormatter(options.timeZone);
  const day = reportDateFormatter(options.timeZone, false);
  const patient = options.patient ?? null;
  const name = patient?.name ?? options.patientName;
  const layout = new ReportLayout(
    `Progress report: ${name}`,
    reportFooter("progress", name, patient?.id ?? null, date(options.generatedAt)),
    options.generatedAt,
  );
  const groups = groupSessionsByExercise(sessions);
  const outcomeSessions = groups.flatMap((g) => g.sessions);
  const times = outcomeSessions.map((s) => s.startedAt).sort();

  layout.title("Progress report");
  layout.detailsBox("Patient", patientCells(patient, options.patientName, options.generatedAt, options.timeZone));
  layout.detailsBox("Report", [
    { label: "Data as of", value: date(options.generatedAt) },
    { label: "Sessions with results", value: times.length ? `${times.length}, from ${day(times[0])} to ${day(times[times.length - 1])}` : "none yet" },
    { label: "Exercises", value: String(new Set(groups.map((g) => g.exerciseId)).size) },
  ]);
  layout.paragraph(
    "Built from the sessions saved when it was downloaded; download it again to include later sessions. " +
      "Sessions are grouped by exercise, prescribed side, resistance and the version of the app's scoring, as in the app's Progress Trends. " +
      "Trend labels come from the machine-learning trend model: Rising or Falling appears only when a side's change since its " +
      "first counted session is larger than normal session-to-session variation. Supplementary information, not a diagnosis.",
    { size: 8.5, color: COLORS.muted },
  );

  if (options.program !== undefined) {
    layout.heading("Current home exercise program");
    if (options.program === null) {
      layout.paragraph("The patient's prescriptions could not be loaded when this report was made.", { size: 8.5, color: COLORS.muted });
    } else if (options.program.length === 0) {
      layout.paragraph("No exercise is prescribed at the moment.");
    } else {
      layout.table(
        [
          { header: "Exercise", width: 1.9 },
          { header: "Dose", width: 1.7 },
          { header: "Side and load", width: 1.4 },
          { header: "Schedule", width: 1.4 },
          { header: "Dates", width: 1.6 },
          { header: "Done so far", width: 1.7 },
        ],
        options.program.map(homeProgramRow),
      );
    }
  }
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
      ...heldOutRow(group.sessions),
      [meta.label, present.length ? `first ${fmt(present[0])} · latest ${fmt(present[present.length - 1])}` : "not recorded"],
    ]);
    layout.table(
      [
        { header: "Measure", width: 2.3 },
        { header: "Side", width: 0.7 },
        { header: "Counted sessions", width: 0.9, align: "right" },
        { header: "Change since the first counted session (95 % range)", width: 2.9 },
        { header: "Trend", width: 1.1 },
      ],
      [
        ...primary.map((s) => modelRow(s, modelMeta.label, modelMeta.format, modelMeta.changeUnit)),
        ...form.map((s) => modelRow(s, "Form score", (v) => v.toFixed(0), "")),
      ],
    );
    layout.chart(
      primary.map((s) => ({
        label: `${s.side === "card" ? "" : `${sideLabel(s.side)} `}${modelMeta.label.toLowerCase()}`,
        color: s.side === "right" ? COLORS.orange : s.side === "left" ? COLORS.blue : COLORS.green,
        values: s.values,
      })),
      { first: day(first), last: day(last) },
      (v) => `${modelMeta.format(v)}${modelMeta.unit}`,
      `${modelMeta.label} by counted session${isIso ? " (% of the prescribed hold)" : ""}`,
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
        "Repetitions that met the full-range target, by session",
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
          { header: "Counted sessions", width: 0.8, align: "right" },
          { header: "Change since the first counted session (95 % range), or the measured values", width: 3.6 },
        ],
        extras.flatMap(({ def, series }) =>
          series.filter((s) => s.counted > 0).map((s) => [
            def.title,
            s.side === "card" ? "—" : sideLabel(s.side),
            String(s.counted),
            s.beforeCorrection
              ? `measured values only (${BEFORE_CORRECTION_NOTE}): ${measured(s, def.format, def.unit)}`
              : s.spec?.band === false
              ? `measured values only (${BAND_WITHHELD.has(`${s.spec.exercise}:${s.spec.measure}`)
                ? "the target changed after the trend model learned this measure"
                : "the trend model has no range for this measure yet"}): ${measured(s, def.format, def.unit)}`
              : s.fit
                ? changeText(s.fit, (v) => `${def.format(v)}${def.changeUnit}`)
                : `too few counted sessions so far (needs 2); measured: ${measured(s, def.format, def.unit)}`,
          ]),
        ),
      );
    }
  }

  const note = (text: string) => layout.paragraph(text, { size: 8.5, color: COLORS.muted });
  layout.heading("Limitations");
  note(ANGLE_NOTE);
  note("Sessions that were started but recorded no set are left out.");

  layout.heading("How to read this report");
  note(
    "Reading the trends: the 95 % range is where the change since the first counted session most likely lies; if it " +
      `includes zero, the change is not clear. A trend needs at least ${TREND_MODEL.minSessions} counted sessions, and a ` +
      "change estimate for the other measures at least 2.",
  );
  note(
    "Counted sessions: a session counts toward a measure when it has at least 3 repetitions on that side (for the form " +
      "score, 3 the camera tracked well enough to score; for holds, one set) and was not left out because the camera " +
      "tracked it poorly. Holds are compared as time in the target band, as a share of the prescribed hold.",
  );
  note(
    "Form score: the app's rule-based score from 0 to 100. It starts at 100 and loses points while the compensations the " +
      "app checks for that exercise, such as trunk lean, go past its thresholds, and it is averaged over the repetitions " +
      "the camera tracked well enough to score. It is not a clinical rating.",
  );

  layout.heading("Notes");
  note("Supplementary information for review with a physical therapist. It is not a diagnosis.");
  layout.paragraph(
    `For the app's developers: trend model ${TREND_MODEL.version}, a Gaussian-process model of each side's session results.`,
    { size: 8, color: COLORS.muted },
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

/**
 * Fetches the latest saved sessions and saves the progress report. The
 * patient's record and current program are added when they load (a patient's
 * own id comes from the sign-in), and the report says so where they did not.
 */
export async function downloadProgressReport(source: { patientId?: string }, patientName: string) {
  const sessions = await fetchProgressSessions(source);
  const patientId = source.patientId ?? (await fetchSignedInUserId());
  const [patient, program] = patientId
    ? await Promise.all([fetchReportPatient(patientId), fetchHomeProgram(patientId)])
    : [null, null];
  const generatedAt = new Date();
  downloadPdf(
    progressReportPdf(sessions, { patientName, generatedAt, patient, program }),
    reportFileName("progress", patientName, generatedAt),
  );
}
