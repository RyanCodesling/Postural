/**
 * The per-session PDF: what was prescribed, what was done on each side, how
 * each set ended, pain before and after, the coaching cues that were drawn,
 * and how well the camera tracked. Built from the stored session detail, so a
 * download reflects what the server saved. Kind, metric and targets come from
 * the session's own record, never today's registry when history has them.
 *
 * The layout follows official lab and imaging reports: a patient block and a
 * session block first, then results against the prescribed targets with a
 * flag where a result is below target, then the limitations. It leaves out
 * what such reports have and this app cannot back: no normal ranges (the
 * angles are camera estimates), no impression or diagnosis, no sign-off.
 */
import { getDisplayHoldSeconds } from "@/lib/exercises/prescriptionDisplay";
import { getExerciseDefinition, type MetricName } from "@/lib/exercises/registry";
import { cueEpisodes, setCoachingAudit } from "@/lib/pose/coachingAudit";
import { OVERLAY_LABELS } from "@/lib/pose/drawCompensationOverlay";
import {
  formatPainAfter,
  formatPreSessionPain,
  formatResistanceContext,
  preSessionPainFromContext,
  recordedExercise,
  type PainReportStatus,
  type PainTiming,
  type SessionContextSnapshot,
  type SessionEndReason,
} from "@/lib/prescriptionContext";
import type { DeviceContext } from "@/lib/sessionReadModels";
import {
  ANGLE_ESTIMATE_LABEL,
  prescribedOutcomeSides,
  sideLabel,
} from "@/lib/sessionOutcomePresentation";
import { downloadPdf, reportFileName } from "./download";
import { COLORS, ReportLayout, type TableCell, type TableColumn } from "./pdfWriter";
import { fetchReportPatient, patientCells, reportFooter, type ReportPatient } from "./reportPatient";

type StoredAttempt = { setIndex: number; holdQuality: unknown };

/** The fields of `GET /api/sessions/[id]` the report reads. */
export type SessionReportInput = {
  id: number;
  patientId?: string;
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
  /** The browser and system the session was recorded on. */
  deviceContext?: DeviceContext | null;
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

export type ReportOptions = {
  patientName: string;
  generatedAt: Date;
  timeZone?: string;
  /** The patient's record; null when it could not be loaded, and the report then says so. */
  patient?: ReportPatient | null;
};

/**
 * Where this session falls among the patient's sessions of the same exercise
 * that recorded a set or repetition: `index` is null when this one recorded
 * none, so it is not counted.
 */
export type SessionNumber = { index: number | null; total: number };

export type SessionReportOptions = ReportOptions & { sessionNumber?: SessionNumber | null };

export const ANGLE_NOTE =
  `Angles labelled "${ANGLE_ESTIMATE_LABEL}" are estimated from a single camera image. They are not anatomical degrees or ` +
  "goniometer measurements, so compare them with this patient's earlier sessions recorded with the same camera setup, " +
  "not with clinical norms.";

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

export { formatPainAfter };

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

function sessionNumberText(number: SessionNumber | null): string {
  if (!number) return "not available";
  if (number.index === null) return "not counted (no set recorded)";
  return `${number.index} of ${number.total} so far`;
}

export function sessionReportPdf(input: SessionReportInput, options: SessionReportOptions): Uint8Array<ArrayBuffer> {
  const date = reportDateFormatter(options.timeZone);
  const patient = options.patient ?? null;
  const layout = new ReportLayout(
    `Session report: ${input.exerciseName}`,
    reportFooter("session", patient?.name ?? options.patientName, patient?.id ?? null, date(options.generatedAt)),
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

  layout.title("Session report", `${input.exerciseName} · report generated ${date(options.generatedAt)}`);
  layout.detailsBox("Patient", patientCells(patient, options.patientName, options.generatedAt, options.timeZone));
  layout.detailsBox("Session", [
    { label: "Exercise", value: input.exerciseName },
    { label: "Session no. (this exercise)", value: sessionNumberText(options.sessionNumber ?? null) },
    { label: "Recorded with", value: input.deviceContext ? `${input.deviceContext.browser} on ${input.deviceContext.platform}` : "not recorded" },
    { label: "Started", value: date(input.startedAt) },
    { label: "Ended", value: input.endedAt ? `${date(input.endedAt)} · ${formatDuration(durationMs)} long` : "not ended" },
    { label: "Outcome", value: input.endReason ? SESSION_ENDINGS[input.endReason] : "Not ended" },
    {
      label: "Prescription",
      value: prescription
        ? [
            `${prescription.sets} set${prescription.sets === 1 ? "" : "s"} of ${isIso ? `${holdPerSet}s hold` : `${prescription.reps} reps`}`,
            `${prescription.restSeconds}s rest`,
            prescribedSide === "both" ? "both sides" : `${prescribedSide} side`,
            formatResistanceContext(prescription.resistance),
          ].join(" · ")
        : "not recorded for this older session",
      wide: true,
    },
  ]);

  // Results against their targets. The angle target is the exercise's
  // full-range target, never a clinical norm (the angles are camera estimates).
  layout.heading("Results");
  const repsOn = (side: string) => input.reps.filter((r) => r.side === side);
  const average = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
  const flag = (below: boolean): TableCell => (below ? { text: "Below target", color: COLORS.amber, bold: true } : "");
  const results: TableCell[][] = [[
    "Sets done",
    String(input.sets.length),
    prescription ? String(prescription.sets) : "not recorded",
    flag(prescription !== null && input.sets.length < prescription.sets),
  ]];
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
    for (const side of sides) {
      // Compared as printed, so a result shown equal to its target is not flagged.
      const held = (heldMs(side) / 1000).toFixed(1);
      const targeted = (recordedTargetMs / 1000).toFixed(0);
      results.push([
        `${sideLabel(side)} time in position`,
        `${held}s held in ${recordedSets}`,
        [
          ...(recordedTargetMs ? [`${targeted}s in the recorded sets`] : []),
          prescription ? `prescribed ${prescription.sets} x ${holdPerSet}s` : "prescription not recorded",
        ].join(" · "),
        flag(recordedTargetMs > 0 && Number(held) < Number(targeted)),
      ]);
    }
  } else {
    const prescribedReps = prescription ? prescription.sets * prescription.reps : null;
    for (const side of sides) {
      const reps = repsOn(side);
      const attempted = input.sets.reduce((sum, set) => sum + ((side === "left" ? set.leftReps : set.rightReps) ?? 0), 0);
      const complete = reps.filter((r) => r.classification === "complete").length;
      const peak = average(reps.map((r) => r.peakValue).filter((v): v is number => v !== null));
      // The target saved with the repetitions, else the one in the start context.
      const target = reps.find((r) => typeof r.targetRom === "number" && Number.isFinite(r.targetRom))?.targetRom ??
        exercise.recordedTarget;
      results.push(
        [
          `${sideLabel(side)} repetitions done`,
          String(attempted),
          prescription && prescribedReps !== null ? `${prescribedReps} (${prescription.sets} x ${prescription.reps})` : "not recorded",
          flag(prescribedReps !== null && attempted < prescribedReps),
        ],
        [`${sideLabel(side)} repetitions that met the full-range target`, `${complete} of ${attempted}`, "every repetition", flag(complete < attempted)],
        [
          `${sideLabel(side)} average ${peakLabel}`,
          peak === null ? "—" : fmtPeak(peak),
          target !== null ? fmtPeak(target) : "not recorded",
          flag(peak !== null && target !== null && Number(fmtPeak(peak)) < Number(fmtPeak(target))),
        ],
      );
    }
  }
  results.push(
    ["Pain before the session (patient-reported)", formatPreSessionPain(preSessionPainFromContext(input.context)), "—", ""],
    ["Pain after the attempt (patient-reported)", formatPainAfter(input.painReport), "—", ""],
  );
  layout.table(
    [
      { header: "Measure", width: 2.8 },
      { header: "Result", width: 1.7 },
      { header: "Target", width: 1.9 },
      { header: "Flag", width: 1 },
    ],
    results,
  );

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
    layout.paragraph("No coaching cue was shown in the recorded sets (counted only while the app was processing camera frames).");
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
    const counted = [
      ...(input.sets.length > 0
        ? [`the ${cues.auditedSets} of ${input.sets.length} set${input.sets.length === 1 ? "" : "s"} with a coaching record`]
        : []),
      ...(attempts > 0
        ? [`${attempts} attempt${attempts === 1 ? "" : "s"} in which no movement was counted (marked "uncredited"; not part of the results above)`]
        : []),
    ];
    layout.paragraph(
      `Counted in ${counted.join(" and in ")}, only while the app was processing camera frames; pauses in the camera feed are not counted.` +
        (cues.dropped > 0 ? " The earliest part of a long set's coaching record was not kept." : ""),
      { size: 8.5, color: COLORS.muted },
    );
  }

  layout.heading("Limitations");
  const note = (text: string) => layout.paragraph(text, { size: 8.5, color: COLORS.muted });
  note(input.captureQuality
    ? `Camera tracking: ${input.captureQuality.pctOk}% of frames tracked (${input.captureQuality.framesOk} of ${input.captureQuality.framesTotal}).`
    : "Camera tracking: not recorded for this session.");
  note(ANGLE_NOTE);

  layout.heading("Notes");
  note("Descriptive record of the session for review with a physical therapist. It is not a diagnosis.");
  if (input.context?.version === 3) {
    layout.paragraph(
      `For the app's developers: configuration registry ${input.context.versions.registry.slice(0, 12)}, exercise ${input.context.versions.exerciseConfig.slice(0, 19)}, session ${input.id}.`,
      { size: 8, color: COLORS.muted },
    );
  }
  return layout.finish();
}

type ListedSession = { id: number; exerciseId: string; startedAt: string; setCount?: number; totalReps?: number };

const isListedSession = (value: unknown): value is ListedSession => {
  const s = value as Partial<ListedSession> | null;
  return !!s && typeof s.id === "number" && typeof s.exerciseId === "string" && typeof s.startedAt === "string";
};

/**
 * Where the session falls among the patient's sessions of the same exercise
 * that recorded a set or repetition (the sessions the progress report counts),
 * or null when the list cannot be loaded. The list route reads the patient
 * from the sign-in for a patient and from `patientId` for their therapist.
 */
export async function fetchSessionNumber(
  session: Pick<SessionReportInput, "id" | "patientId" | "exerciseId">,
): Promise<SessionNumber | null> {
  if (!session.patientId) return null;
  try {
    const response = await fetch(`/api/sessions?patientId=${encodeURIComponent(session.patientId)}`, { cache: "no-store" });
    if (!response.ok) return null;
    const body = (await response.json()) as { sessions?: unknown };
    if (!Array.isArray(body.sessions)) return null;
    const withResults = body.sessions
      .filter(isListedSession)
      .filter((s) => s.exerciseId === session.exerciseId && ((s.setCount ?? 0) > 0 || (s.totalReps ?? 0) > 0))
      .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime() || a.id - b.id);
    const at = withResults.findIndex((s) => s.id === session.id);
    return { index: at >= 0 ? at + 1 : null, total: withResults.length };
  } catch {
    return null;
  }
}

/**
 * Loads the stored session and saves its report. Throws when the session
 * cannot be loaded; the patient's record and the session number are added
 * when they load, and the report says so where they did not.
 */
export async function downloadSessionReport(sessionId: number, patientName: string): Promise<void> {
  const response = await fetch(`/api/sessions/${sessionId}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`session ${sessionId} returned ${response.status}`);
  const { session } = (await response.json()) as { session: SessionReportInput | null };
  if (!session) throw new Error(`session ${sessionId} is missing`);
  const [patient, sessionNumber] = await Promise.all([
    session.patientId ? fetchReportPatient(session.patientId) : Promise.resolve(null),
    fetchSessionNumber(session),
  ]);
  const generatedAt = new Date();
  downloadPdf(
    sessionReportPdf(session, { patientName, generatedAt, patient, sessionNumber }),
    reportFileName("session", session.exerciseName, generatedAt),
  );
}
