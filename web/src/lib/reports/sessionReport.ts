/**
 * The per-session PDF: what was prescribed, what was done on each side, how
 * each set ended, pain before and after, the coaching cues that were drawn,
 * and how well the camera tracked. Built from the stored session detail, so a
 * download reflects what the server saved. Kind, metric and targets come from
 * the session's own record, never today's registry when history has them.
 */
import { getDisplayHoldSeconds } from "@/lib/exercises/prescriptionDisplay";
import { getExerciseDefinition, type MetricName } from "@/lib/exercises/registry";
import { cueEpisodes, setCoachingAudit } from "@/lib/pose/coachingAudit";
import { OVERLAY_LABELS } from "@/lib/pose/drawCompensationOverlay";
import {
  formatPreSessionPain,
  formatResistanceContext,
  preSessionPainFromContext,
  recordedExercise,
  type PainReportStatus,
  type PainTiming,
  type SessionContextSnapshot,
  type SessionEndReason,
} from "@/lib/prescriptionContext";
import {
  ANGLE_ESTIMATE_LABEL,
  fullRomOutcomeText,
  prescribedOutcomeSides,
  sideLabel,
} from "@/lib/sessionOutcomePresentation";
import { downloadPdf, reportFileName } from "./download";
import { COLORS, ReportLayout, type TableColumn } from "./pdfWriter";

type StoredAttempt = { setIndex: number; holdQuality: unknown };

/** The fields of `GET /api/sessions/[id]` the report reads. */
export type SessionReportInput = {
  id: number;
  exerciseId: string;
  exerciseName: string;
  startedAt: string;
  endedAt: string | null;
  endReason: SessionEndReason | null;
  context: SessionContextSnapshot | null;
  painReport: {
    status: PainReportStatus;
    score: number | null;
    timing: PainTiming | null;
    bodyArea: string | null;
  };
  captureQuality: { framesTotal: number; framesOk: number; pctOk: number } | null;
  sets: Array<StoredAttempt & {
    exerciseKind: string;
    leftReps: number | null;
    rightReps: number | null;
    targetHoldMs: number | null;
    pairedHoldMs: number | null;
    durationMs: number | null;
    terminatedBy: string | null;
  }>;
  reps: Array<{
    setIndex: number;
    side: string;
    peakValue: number | null;
    targetRom?: number | null;
    classification: string;
  }>;
  /** Attempts that credited no movement: coaching evidence only, never outcomes. */
  auditAttempts?: StoredAttempt[];
};

export type ReportOptions = { patientName: string; generatedAt: Date; timeZone?: string };

export const REPORT_NOTES = [
  `Angles are labelled "${ANGLE_ESTIMATE_LABEL}": they are pipeline units measured from a 2D camera, not anatomical degrees.`,
  "Descriptive record of the session for review with a physical therapist. It is not a diagnosis.",
];

const SET_ENDINGS: Record<string, string> = {
  min_reached: "Target reached",
  user: "Ended by patient",
  pain: "Stopped for pain",
  capture_lost: "Camera lost tracking",
  stall: "No movement detected",
};

const SESSION_ENDINGS: Record<SessionEndReason, string> = {
  completed: "Completed all prescribed sets",
  user: "Ended early by the patient",
  pain: "Stopped for pain",
  superseded: "Replaced by a newer attempt",
};

export function reportDateFormatter(timeZone?: string, withTime = true) {
  const format = new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone,
    ...(withTime ? { hour: "numeric", minute: "2-digit" } as const : {}),
  });
  return (value: string | Date) => {
    const date = typeof value === "string" ? new Date(value) : value;
    return Number.isNaN(date.getTime()) ? "unknown" : format.format(date);
  };
}

export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return "—";
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * The exercise as this session recorded it: the saved sets' kind first, then
 * the start context. Today's registry fills in only for older sessions saved
 * without a context. A target is never taken from today's registry.
 */
export function sessionExercise(input: Pick<SessionReportInput, "exerciseId" | "context" | "sets">) {
  const recorded = recordedExercise(input.context);
  const current = recorded ? null : getExerciseDefinition(input.exerciseId);
  const setKind = input.sets.find((s) => s.exerciseKind === "dynamic" || s.exerciseKind === "isometric")?.exerciseKind;
  const kind = (setKind as "dynamic" | "isometric" | undefined) ?? recorded?.kind ?? current?.kind ?? null;
  const primaryMetric = recorded
    ? recorded.primaryMetric
    : current?.kind === "dynamic" ? current.primaryMetric.name : null;
  return {
    kind,
    isAngle: kind !== "isometric" && primaryMetric !== "wristShoulderVertical",
    recordedTarget: recorded?.targetROM ?? null,
  };
}

export function formatPainAfter(report: SessionReportInput["painReport"]): string {
  if (report.status === "declined") return "declined";
  if (report.status !== "reported" || report.score === null) return "not reported";
  const timing = report.timing === "both" ? "during and after" : report.timing;
  return [`${report.score}/10`, timing, report.bodyArea].filter(Boolean).join(" · ");
}

/**
 * Cue display per compensation, from the stored coaching audits of the sets
 * and of the attempts that credited no movement. Labels are the app's own
 * on-screen labels, which name what the metric can identify.
 */
export function cueSummary(sets: StoredAttempt[], attempts: StoredAttempt[] = []) {
  const byMetric = new Map<MetricName, { label: string; words: Set<string>; times: number; ms: number; where: Set<string> }>();
  let auditedSets = 0;
  let auditedAttempts = 0;
  let dropped = 0;
  const read = (rows: StoredAttempt[], uncredited: boolean) => {
    for (const row of rows) {
      const audit = setCoachingAudit(row.holdQuality);
      if (!audit) continue;
      if (uncredited) auditedAttempts += 1;
      else auditedSets += 1;
      dropped += audit.droppedRecords;
      for (const episode of cueEpisodes(audit)) {
        const entry = byMetric.get(episode.metric) ?? {
          label: OVERLAY_LABELS[episode.metric] ?? episode.metric,
          words: new Set<string>(), times: 0, ms: 0, where: new Set<string>(),
        };
        entry.words.add(episode.text);
        entry.times += 1;
        entry.ms += episode.endMs - episode.startMs;
        entry.where.add(uncredited ? `${row.setIndex} (uncredited)` : String(row.setIndex));
        byMetric.set(episode.metric, entry);
      }
    }
  };
  read(sets, false);
  read(attempts, true);
  return { auditedSets, auditedAttempts, dropped, cues: [...byMetric.values()].sort((a, b) => b.times - a.times) };
}

export function sessionReportPdf(input: SessionReportInput, options: ReportOptions): Uint8Array<ArrayBuffer> {
  const date = reportDateFormatter(options.timeZone);
  const layout = new ReportLayout(
    `Session report: ${input.exerciseName}`,
    `Postural session report · ${options.patientName} · generated ${date(options.generatedAt)}`,
    options.generatedAt,
  );
  const prescription = input.context?.prescription ?? null;
  const prescribedSide = prescription?.prescribedSide ?? "both";
  const sides = prescribedOutcomeSides(prescribedSide);
  const exercise = sessionExercise(input);
  const isIso = exercise.kind === "isometric";
  const isAngle = exercise.isAngle;
  const holdPerSet = prescription ? getDisplayHoldSeconds(prescription.holdSeconds) : null;
  const fmtPeak = (v: number) => (isAngle ? String(Math.round(v)) : v.toFixed(2));
  const peakLabel = isAngle ? `peak ${ANGLE_ESTIMATE_LABEL}` : "peak";
  const startedMs = new Date(input.startedAt).getTime();
  const durationMs = input.endedAt ? new Date(input.endedAt).getTime() - startedMs : null;

  layout.title("Session report", `${input.exerciseName} · ${options.patientName}`);
  layout.keyValues([
    ["Started", date(input.startedAt)],
    ["Ended", input.endedAt ? `${date(input.endedAt)} · ${formatDuration(durationMs)} long` : "not ended"],
    ["Outcome", input.endReason ? SESSION_ENDINGS[input.endReason] : "Not ended"],
    ["Prescription", prescription
      ? [
          `${prescription.sets} set${prescription.sets === 1 ? "" : "s"} of ${isIso ? `${holdPerSet}s hold` : `${prescription.reps} reps`}`,
          `${prescription.restSeconds}s rest`,
          prescribedSide === "both" ? "both sides" : `${prescribedSide} side`,
          formatResistanceContext(prescription.resistance),
        ].join(" · ")
      : "not recorded for this older session"],
    ["Sets done", prescription ? `${input.sets.length} of ${prescription.sets}` : String(input.sets.length)],
    ["Pain before the session", formatPreSessionPain(preSessionPainFromContext(input.context))],
    ["Pain after the attempt", formatPainAfter(input.painReport)],
    ["Camera tracking", input.captureQuality
      ? `${input.captureQuality.pctOk}% of frames tracked (${input.captureQuality.framesOk} of ${input.captureQuality.framesTotal})`
      : "not recorded"],
  ]);

  layout.heading("Results by side");
  const repsOn = (side: string) => input.reps.filter((r) => r.side === side);
  const average = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
  if (isIso) {
    const heldMs = (side: "left" | "right") => input.sets.reduce((sum, set) => {
      const quality = set.holdQuality as { leftInBandMs?: unknown; rightInBandMs?: unknown } | null;
      const own = side === "left" ? quality?.leftInBandMs : quality?.rightInBandMs;
      return sum + (typeof own === "number" ? own : set.pairedHoldMs ?? 0);
    }, 0);
    // The targets of the sets actually recorded, kept apart from the whole
    // prescription: after an early stop they differ.
    const recordedTargetMs = input.sets.reduce((sum, set) => sum + (set.targetHoldMs ?? 0), 0);
    const recordedSets = `${input.sets.length} recorded set${input.sets.length === 1 ? "" : "s"}`;
    layout.keyValues(sides.map((side) => [
      `${sideLabel(side)} time in position`,
      [
        `${(heldMs(side) / 1000).toFixed(1)}s held${recordedTargetMs ? ` of ${(recordedTargetMs / 1000).toFixed(0)}s targeted in ${recordedSets}` : ` in ${recordedSets}`}`,
        prescription ? `prescribed ${prescription.sets} x ${holdPerSet}s` : "prescription not recorded",
      ].join(" · "),
    ] as const), 190);
  } else {
    layout.keyValues(sides.flatMap((side) => {
      const reps = repsOn(side);
      const attempted = input.sets.reduce((sum, set) => sum + ((side === "left" ? set.leftReps : set.rightReps) ?? 0), 0);
      const complete = reps.filter((r) => r.classification === "complete").length;
      const peak = average(reps.map((r) => r.peakValue).filter((v): v is number => v !== null));
      // The target saved with the repetitions, else the one in the start context.
      const target = reps.find((r) => typeof r.targetRom === "number" && Number.isFinite(r.targetRom))?.targetRom ??
        exercise.recordedTarget;
      return [
        [`${sideLabel(side)} repetitions`, fullRomOutcomeText(complete, attempted)],
        [`${sideLabel(side)} average ${peakLabel}`, peak === null
          ? "—"
          : `${fmtPeak(peak)} · ${target !== null ? `target ${fmtPeak(target)}` : "target not recorded"}`],
      ] as const;
    }), 230);
  }

  layout.heading("Sets");
  if (input.sets.length === 0) {
    layout.paragraph("No set was recorded.");
  } else {
    const columns: TableColumn[] = [{ header: "Set", width: 0.6 }];
    for (const side of sides) {
      columns.push(isIso
        ? { header: `${sideLabel(side)} held`, width: 1.2, align: "right" }
        : { header: `${sideLabel(side)} full-range reps`, width: 1.4, align: "right" });
    }
    if (!isIso) for (const side of sides) columns.push({ header: `${sideLabel(side)} average ${peakLabel}`, width: 1.3, align: "right" });
    if (isIso) columns.push({ header: "Target", width: 1, align: "right" });
    columns.push({ header: "Duration", width: 1, align: "right" }, { header: "How it ended", width: 1.6 });
    const rows = input.sets.map((set) => {
      const row = [String(set.setIndex)];
      const setReps = input.reps.filter((r) => r.setIndex === set.setIndex);
      for (const side of sides) {
        if (isIso) {
          const quality = set.holdQuality as { leftInBandMs?: unknown; rightInBandMs?: unknown } | null;
          const own = side === "left" ? quality?.leftInBandMs : quality?.rightInBandMs;
          row.push(`${((typeof own === "number" ? own : set.pairedHoldMs ?? 0) / 1000).toFixed(1)}s`);
        } else {
          const complete = setReps.filter((r) => r.side === side && r.classification === "complete").length;
          row.push(`${complete}/${(side === "left" ? set.leftReps : set.rightReps) ?? 0}`);
        }
      }
      if (!isIso) {
        for (const side of sides) {
          const peak = average(setReps.filter((r) => r.side === side).map((r) => r.peakValue).filter((v): v is number => v !== null));
          row.push(peak === null ? "—" : fmtPeak(peak));
        }
      }
      if (isIso) row.push(set.targetHoldMs ? `${Math.round(set.targetHoldMs / 1000)}s` : "—");
      row.push(formatDuration(set.durationMs), SET_ENDINGS[set.terminatedBy ?? ""] ?? set.terminatedBy ?? "—");
      return row;
    });
    layout.table(columns, rows);
  }

  layout.heading("Coaching cues shown");
  const cues = cueSummary(input.sets, input.auditAttempts ?? []);
  if (cues.auditedSets + cues.auditedAttempts === 0) {
    layout.paragraph("No coaching record is stored for this session. Sessions recorded before the coaching record existed have none.");
  } else if (cues.cues.length === 0) {
    layout.paragraph("No coaching cue was drawn during the observed part of the recorded attempts.");
  } else {
    layout.table(
      [
        { header: "Cue (app label)", width: 1.6 },
        { header: "Text drawn on screen", width: 1.5 },
        { header: "Times shown", width: 0.9, align: "right" },
        { header: "Time on screen", width: 1, align: "right" },
        { header: "Sets", width: 1.1, align: "right" },
      ],
      cues.cues.map((cue) => [
        cue.label,
        [...cue.words].map((w) => `"${w}"`).join(", "),
        String(cue.times),
        cue.ms < 500 ? "under 1s" : `about ${Math.round(cue.ms / 1000)}s`,
        [...cue.where].sort((a, b) => parseInt(a, 10) - parseInt(b, 10) || a.localeCompare(b)).join(", "),
      ]),
    );
  }
  if (cues.auditedSets + cues.auditedAttempts > 0) {
    const attempts = cues.auditedAttempts;
    layout.paragraph(
      `Counted from the observed part of ${cues.auditedSets} of ${input.sets.length} set${input.sets.length === 1 ? "" : "s"}` +
        (attempts > 0
          ? ` and ${attempts} attempt${attempts === 1 ? "" : "s"} that credited no movement (marked "uncredited"; they are not in the results above)`
          : "") +
        "; unobserved gaps are not counted." +
        (cues.dropped > 0 ? " Some early records of a long set were not kept." : ""),
      { size: 8.5, color: COLORS.muted },
    );
  }

  layout.heading("Notes");
  for (const note of REPORT_NOTES) layout.paragraph(note, { size: 8.5, color: COLORS.muted });
  if (input.context?.version === 3) {
    layout.paragraph(
      `Recorded configuration: registry ${input.context.versions.registry.slice(0, 12)} · exercise ${input.context.versions.exerciseConfig.slice(0, 19)} · session ${input.id}.`,
      { size: 8, color: COLORS.muted },
    );
  }
  return layout.finish();
}

/** Loads the stored session and saves its report. Throws when it cannot. */
export async function downloadSessionReport(sessionId: number, patientName: string): Promise<void> {
  const response = await fetch(`/api/sessions/${sessionId}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`session ${sessionId} returned ${response.status}`);
  const { session } = (await response.json()) as { session: SessionReportInput | null };
  if (!session) throw new Error(`session ${sessionId} is missing`);
  const generatedAt = new Date();
  downloadPdf(
    sessionReportPdf(session, { patientName, generatedAt }),
    reportFileName("session", session.exerciseName, generatedAt),
  );
}
