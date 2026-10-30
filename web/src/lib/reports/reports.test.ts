/**
 * PDF reports: the writer's file structure (xref offsets, stream lengths, page
 * count, ASCII-only output), text encoding and wrapping, cue episodes read from
 * a real coaching audit, and the session and progress reports' content,
 * including the "angle (camera estimate)" wording and the pain columns, the
 * patient and session blocks, the results against their targets, the home
 * exercise program, and the loaders behind them.
 *
 *   npx tsx src/lib/reports/reports.test.ts
 *
 * Set REPORT_SAMPLE_DIR to an existing folder to also save the sample session
 * and progress PDFs there for a visual check.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import { POSE_METRIC_ALGORITHM_VERSION } from "../pose/metricVersion";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { getExerciseDefinition } from "../exercises/registry";
import { captureCoachingProvenance } from "../pose/coachingConfig";
import { CoachingAuditBuffer, cueEpisodes, setCoachingAudit } from "../pose/coachingAudit";
import type { SessionContextSnapshot } from "../prescriptionContext";
import { reportFileName } from "./download";
import { fetchHomeProgram, homeProgramFromRows, homeProgramRow, type HomeProgramItem } from "./homeProgram";
import { fitText, pdfText, ReportLayout, textWidth, wrapText } from "./pdfWriter";
import { ageOn, fetchReportPatient, fetchSignedInUserId, formatDateKey, patientCells, type ReportPatient } from "./reportPatient";
import { cueSummary, fetchSessionNumber, sessionReportPdf, type SessionReportInput } from "./sessionReport";
import { fetchProgressSessions, progressReportPdf, type ProgressReportSession } from "../../app/(app)/dashboard/_components/progressReport";
import { groupSessionsByExercise, primaryMetricMeta } from "../../app/(app)/dashboard/_components/ExerciseTrends";

const sampleDir = process.env.REPORT_SAMPLE_DIR;
const saveSample = (name: string, bytes: Uint8Array) => {
  if (sampleDir) writeFileSync(join(sampleDir, name), bytes);
};

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`      ${err instanceof Error ? err.message : String(err)}`);
    failed += 1;
  }
}

const WIN_ANSI: Record<number, string> = {
  0x85: "…", 0x91: "‘", 0x92: "’", 0x93: "“", 0x94: "”",
  0x95: "•", 0x96: "–", 0x97: "—", 0xb0: "°", 0xb7: "·",
};

/** Checks the file structure and returns the page count. */
function checkStructure(bytes: Uint8Array): number {
  assert(bytes.every((b) => b < 128), "output is ASCII only");
  const text = new TextDecoder().decode(bytes);
  assert(text.startsWith("%PDF-1.4\n") && text.endsWith("%%EOF\n"), "header and trailer");
  const startxref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)![1]);
  assert(text.slice(startxref).startsWith("xref\n"), "startxref points at the xref table");
  const size = Number(/\/Size (\d+)/.exec(text)![1]);
  const entries = text.slice(startxref).split("\n").slice(3, 2 + size);
  assert.equal(entries.length, size - 1);
  entries.forEach((entry, i) => {
    assert.equal(entry.length, 19, "xref entries are 20 bytes with their newline");
    assert(text.slice(Number(entry.slice(0, 10))).startsWith(`${i + 1} 0 obj\n`), `object ${i + 1} offset`);
  });
  for (const m of text.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) {
    const start = m.index! + m[0].length;
    assert(text.slice(start + Number(m[1])).startsWith("\nendstream"), "stream length matches its content");
  }
  const pages = (text.match(/\/Type \/Page /g) ?? []).length;
  assert.equal(pages, Number(/\/Count (\d+)/.exec(text)![1]), "page tree count");
  return pages;
}

/** Every drawn string, decoded and joined by spaces. */
function drawnText(bytes: Uint8Array): string {
  const text = new TextDecoder().decode(bytes);
  return [...text.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)]
    .map((m) => m[1].replace(/\\([0-7]{3}|.)/g, (_, e: string) =>
      e.length === 3 ? WIN_ANSI[parseInt(e, 8)] ?? "�" : e))
    .join(" ");
}

async function auditWith(frames: Array<[number, null | [string, string]]>, closedAtMs: number) {
  const definition = getExerciseDefinition("ex_001")!;
  const provenance = await captureCoachingProvenance(definition);
  const buffer = new CoachingAuditBuffer();
  for (const [t, cue] of frames) {
    buffer.observe(t, {
      capture: "available", sessionState: "active", baselineReady: true,
      movement: { left: "ASCENDING", right: "ASCENDING", activeSide: null }, selected: null,
      rendered: cue ? [{ metric: cue[0] as any, text: cue[1], direction: null }] : [],
      renderEvidence: "canvas-frame", suppressedMetrics: [], absenceReason: cue ? null : "not-selected",
    });
  }
  return buffer.snapshot(provenance, closedAtMs, "2026-09-25T16:40:00.000Z");
}

const frames = (from: number, to: number, cue: null | [string, string]) =>
  Array.from({ length: Math.floor((to - from) / 33) + 1 }, (_, i): [number, null | [string, string]] => [from + i * 33, cue]);

async function run() {
  console.log("\nPDF reports\n");

  await test("text is limited to what Helvetica encodes, and widths follow the AFM metrics", () => {
    assert.equal(pdfText("Café → 7 ≥ 5 × 2 · ok 😀"), "Cafe -> 7 >= 5 x 2 · ok ?");
    assert.equal(Math.round(textWidth("Hello", "regular", 10) * 100) / 100, 22.78);
    assert(textWidth("Hello", "bold", 10) > textWidth("Hello", "regular", 10), "bold is wider");
    const lines = wrapText("A fairly long sentence that has to wrap across several short lines, plus Supercalifragilisticexpialidocious.", "regular", 10, 90);
    assert(lines.length > 3, "wraps");
    assert(lines.every((line) => textWidth(line, "regular", 10) <= 90), "no line is wider than the column");
    assert.equal(lines.join(" ").replace(/ /g, ""), "Afairlylongsentencethathastowrapacrossseveralshortlines,plusSupercalifragilisticexpialidocious.");
    const width = textWidth("counted session (95", "regular", 10) + 1;
    assert.deepEqual(wrapText("counted session (95 % range)", "regular", 10, width), ["counted session (95", "% range)"], "breaks at a space");
    assert.deepEqual(wrapText("counted session (95 % range)", "regular", 10, width), ["counted session", "(95 % range)"],
      "a no-break space keeps 95 % together");
  });

  await test("the file structure is valid across page breaks, and text is escaped", () => {
    const layout = new ReportLayout("Structure (check)", "footer", new Date("2026-09-26T00:00:00Z"));
    layout.title("Title", "Sub (title) with \\ and · and —");
    layout.table([{ header: "Date", width: 1 }, { header: "Value", width: 1, align: "right" }],
      Array.from({ length: 90 }, (_, i) => [`Row ${i}`, String(i)]));
    layout.chart([{ label: "Series", color: [0, 0, 0], values: [1, null, 3, 2] }], { first: "a", last: "b" }, String);
    const bytes = layout.finish();
    const pages = checkStructure(bytes);
    assert(pages >= 3, `90 rows need several pages (got ${pages})`);
    const text = new TextDecoder().decode(bytes);
    assert(text.includes("(Sub \\(title\\) with \\\\ and \\267 and \\227) Tj"), "parentheses, backslash and WinAnsi escapes");
    assert.equal((drawnText(bytes).match(/\bDate\b/g) ?? []).length, pages, "the table header repeats on each page");
    assert(drawnText(bytes).includes(`Page ${pages} of ${pages}`), "page numbers");
    assert(text.includes("/CreationDate (D:20260926000000Z)"), "creation date");
  });

  const audit = await auditWith([
    ...frames(0, 297, null),
    ...frames(330, 1320, ["trunkLean", "STRAIGHTEN"]),
    ...frames(1353, 1980, null),
    ...frames(2013, 2475, ["trunkLean", "STRAIGHTEN"]),
    ...frames(3000, 3297, ["shoulderSymmetry", "LOWER"]),
  ], 3400);

  await test("cue episodes merge consecutive draws and split at gaps", async () => {
    assert(setCoachingAudit({ version: "coaching_set_v1", coaching: audit }), "a valid audit is read back");
    assert.equal(setCoachingAudit({ version: "coaching_set_v1", coaching: { ...audit, clock: "wall" } }), null, "an invalid one is not");
    const episodes = cueEpisodes(audit);
    assert.deepEqual(episodes.map((e) => [e.metric, e.startMs, e.endMs]), [
      ["trunkLean", 330, 1320], ["trunkLean", 2013, 2475], ["shoulderSymmetry", 3000, 3297],
    ]);
    const gapped = await auditWith([...frames(0, 330, ["trunkLean", "STRAIGHTEN"]), ...frames(900, 1230, ["trunkLean", "STRAIGHTEN"])], 1300);
    assert.equal(cueEpisodes(gapped).length, 2, "an unsampled gap ends the episode");
  });

  const context = {
    version: 3,
    prescription: { version: 2, sets: 2, reps: 12, restSeconds: 30, holdSeconds: 0, sequenceIndex: 1, prescribedSide: "both",
      resistance: { type: "none", value: null, unit: null, label: null } },
    versions: { registry: "a1b2c3d4e5f6a7b8", exerciseConfig: "sha256:0123456789abcdef0123" },
    preSessionPain: { status: "reported", score: 3, bodyArea: "left shoulder" },
  } as unknown as SessionContextSnapshot;
  const rep = (setIndex: number, side: string, peakValue: number, classification = "complete") =>
    ({ setIndex, side, peakValue, targetRom: 90 as number | null | undefined, classification });
  const detail: SessionReportInput = {
    id: 218, patientId: "patient_007", exerciseId: "ex_001", exerciseName: "Lateral Arm Raises",
    startedAt: "2026-09-25T16:40:00.000Z", endedAt: "2026-09-25T16:48:07.898Z", endReason: "user", context,
    painReport: { status: "reported", score: 2, timing: "after", bodyArea: null },
    captureQuality: { framesTotal: 1000, framesOk: 950, pctOk: 95 },
    deviceContext: { browser: "Chrome", platform: "Windows" },
    sets: [
      { setIndex: 1, exerciseKind: "dynamic", leftReps: 12, rightReps: 12, targetHoldMs: 0, pairedHoldMs: 0, durationMs: 35101,
        terminatedBy: "min_reached", holdQuality: { version: "coaching_set_v1", coaching: audit } },
      { setIndex: 2, exerciseKind: "dynamic", leftReps: 5, rightReps: 5, targetHoldMs: 0, pairedHoldMs: 0, durationMs: 14000,
        terminatedBy: "user", holdQuality: null },
    ],
    reps: [
      rep(1, "left", 70, "partial"), ...Array.from({ length: 11 }, () => rep(1, "left", 96)),
      ...Array.from({ length: 12 }, () => rep(1, "right", 94)),
      ...Array.from({ length: 5 }, () => rep(2, "left", 90)), ...Array.from({ length: 5 }, () => rep(2, "right", 88)),
    ],
  };

  // A fictional patient record, as `GET /api/users/[id]` returns it.
  const samplePatient: ReportPatient = {
    id: "patient_007", name: "Test Patient", dateOfBirth: "1990-03-04", age: 30, gender: "Female",
    therapistName: "Sarah Therapist", diagnosis: "Left shoulder impingement (sample entry)", condition: "Sample condition text",
  };
  // What official results carry and this app cannot back.
  const NOT_BACKED = /normal range|reference range|reference interval|impression|signature|signed by|sign-off|verified by/i;

  await test("session report: patient and session blocks, results against targets, cues and the angle label", () => {
    const bytes = sessionReportPdf(detail, {
      patientName: "Test Patient", generatedAt: new Date("2026-09-26T01:00:00Z"), timeZone: "Asia/Manila",
      patient: samplePatient, sessionNumber: { index: 2, total: 3 },
    });
    saveSample("sample-session-report.pdf", bytes);
    checkStructure(bytes);
    const text = drawnText(bytes);
    for (const expected of [
      "Session report", "Lateral Arm Raises · report generated Sep 26, 2026, 9:00 AM",
      "PATIENT NAME Test Patient PATIENT ID patient_007 DATE OF BIRTH (AGE) Mar 4, 1990 (36 years)",
      "GENDER Female ASSIGNED THERAPIST Sarah Therapist",
      "DIAGNOSIS (ENTERED BY THE CLINIC) Left shoulder impingement (sample entry)",
      "CONDITION (ENTERED BY THE CLINIC) Sample condition text",
      "SESSION EXERCISE Lateral Arm Raises SESSION NO. (THIS EXERCISE) 2 of 3 so far RECORDED WITH Chrome on Windows",
      "STARTED Sep 26, 2026, 12:40 AM", "Ended early by the patient",
      "PRESCRIPTION 2 sets of 12 reps · 30s rest · both sides · No resistance",
      "Results Measure Result Target Flag", "Sets done 2 2",
      "Left repetitions done 17 24 (2 x 12) Below target",
      "Left repetitions that met the full-range target 16 of 17 every repetition Below target",
      "Left average peak angle (camera estimate) 93 90",
      "Right repetitions that met the full-range target 17 of 17 every repetition",
      "Right average peak angle (camera estimate) 92 90",
      "Pain before the session (patient-reported) 3/10 · left shoulder", "Pain after the attempt (patient-reported) 2/10 · after",
      "Target reached", "Ended by patient", "Trunk lean", "“STRAIGHTEN”".replace(/[“”]/g, '"'),
      "Asymmetric shoulders", "Counted in the 1 of 2 sets with a coaching record",
      "only while the app was processing camera frames",
      "Limitations Camera tracking: 95% of frames tracked (950 of 1000).", "not anatomical degrees",
      "compare them with this patient's earlier sessions", "Notes Descriptive record of the session", "It is not a diagnosis.",
      "For the app's developers: configuration registry",
      "Postural session report · Test Patient · ID patient_007 · generated Sep 26, 2026, 9:00 AM",
    ]) assert(text.includes(expected), `missing: ${expected}`);
    assert(!/Right repetitions that met the full-range target 17 of 17 every repetition Below/.test(text), "a met target is not flagged");
    assert(!/\(camera estimate\) 9[23] 90 Below/.test(text), "an average at or above its target is not flagged");
    assert(!text.includes("°"), "no degree sign for readings");
    assert(!NOT_BACKED.test(text), "no normal range, impression or sign-off");
    for (const jargon of ["pipeline units", "observed part", "unobserved gaps", "Recorded configuration"]) {
      assert(!text.includes(jargon), `engineering wording left: ${jargon}`);
    }
    const cues = cueSummary(detail.sets);
    assert.deepEqual(cues.cues.map((c) => [c.label, c.times]), [["Trunk lean", 2], ["Asymmetric shoulders", 1]]);
  });

  await test("session report: the share of unsteady tracking is shown, and flagged at trend data rule 2's line", () => {
    const render = (captureQuality: SessionReportInput["captureQuality"]) => drawnText(sessionReportPdf({ ...detail, captureQuality },
      { patientName: "Test Patient", generatedAt: new Date("2026-09-26T01:00:00Z"), timeZone: "Asia/Manila" }));
    // The evaluation server's session 3: 770 unsteady frames of 1,568 judged.
    const high = render({ framesTotal: 2468, framesOk: 1568, pctOk: 64, unsteadyFrames: 770, checkedFrames: 1568 });
    assert(high.includes("Camera tracking: 64% of frames tracked (1568 of 2468)."), "the tracked share stays");
    assert(high.includes("unsteady on 49% of the frames it judged"), "the unsteady share is shown");
    assert(high.includes("may be unreliable"), "a large share is flagged");
    const low = render({ framesTotal: 1000, framesOk: 950, pctOk: 95, unsteadyFrames: 95, checkedFrames: 950 });
    assert(low.includes("unsteady on 10% of the frames it judged") && !low.includes("may be unreliable"), "a small share is shown, not flagged");
    const steady = render({ framesTotal: 1000, framesOk: 950, pctOk: 95, unsteadyFrames: 0, checkedFrames: 950 });
    assert(!steady.includes("unsteady"), "no unsteady frames: nothing added");
  });

  await test("session report: older session without context or coaching record", () => {
    const text = drawnText(sessionReportPdf({
      ...detail, context: null, deviceContext: null, sets: detail.sets.map((s) => ({ ...s, holdQuality: null })),
      reps: detail.reps.map((r) => ({ ...r, targetRom: null })),
    }, { patientName: "Test Patient", generatedAt: new Date(), timeZone: "Asia/Manila" }));
    assert(text.includes("not recorded for this older session"), "prescription");
    assert(text.includes("Left average peak angle (camera estimate) 93 not recorded") && !text.includes("93 90"),
      "no target is borrowed from today's registry");
    assert(text.includes("Sets done 2 not recorded"), "sets without a prescription");
    assert(text.includes("Pain before the session (patient-reported) not recorded"), "pain before");
    assert(text.includes("No coaching record is stored for this session"), "no audit");
    assert(text.includes("RECORDED WITH not recorded"), "device");
    assert(text.includes("SESSION NO. (THIS EXERCISE) not available"), "no session number");
    assert(text.includes("NAME Test Patient OTHER DETAILS The patient's record could not be loaded"), "patient block without a record");
    assert(!text.includes(" ID "), "no patient ID without a record");
  });

  // Sessions measured with the current measurement (D-48), as saved sessions carry it.
  const CURRENT_CONTEXT = { versions: { poseMetrics: POSE_METRIC_ALGORITHM_VERSION } };
  const trend = (i: number, peak: number, extra: Partial<ProgressReportSession> = {}): ProgressReportSession => ({
    exerciseId: "ex_001", exerciseName: "Lateral Arm Raises", exerciseKind: "dynamic",
    startedAt: `2026-09-${String(10 + i).padStart(2, "0")}T03:00:00.000Z`,
    avgPeakValue: peak, avgLeftPeakValue: peak, avgRightPeakValue: peak - 2,
    completeLeftReps: 8 + i, completeRightReps: 7 + i, leftReps: 12, rightReps: 12,
    totalPairedHoldMs: null, setCount: 2, totalReps: 24, prescribedSide: "both",
    resistance: { type: "none", value: null, unit: null, label: null }, exerciseConfigVersion: "sha256:x",
    endReason: "completed", context: CURRENT_CONTEXT,
    painReport: { status: "reported", score: 1, timing: null, bodyArea: null }, ...extra,
  });
  const iso = getExerciseDefinition("ex_006")!;
  const opts = { patientName: "Test Patient", generatedAt: new Date("2026-09-26T01:00:00Z"), timeZone: "Asia/Manila" };

  // `GET /api/patient-exercises` rows: one running, one about to start, one ended.
  const programRows = [
    { exercise_id: "ex_001", name: "Lateral Arm Raises", monitoring_mode: "camera", sets: 2, reps: 12, rest_seconds: 30,
      hold_seconds: 0, prescribed_side: "both", resistance_type: "none", resistance_value: null, resistance_unit: null,
      resistance_label: null, recurrence: "interval", interval_days: 1, weekdays: null, start_date: "2026-09-20",
      end_date: "2026-10-03", assigned_date: "2026-09-20", prescription_state: "active",
      occurrence_summary: { scheduled: 14, completed: 5, missed: 1, inProgress: 0, remaining: 8, cancelled: 0, painStopped: 0 } },
    { exercise_id: "custom_towel", name: "Towel stretch", monitoring_mode: "manual", sets: 1, reps: 10, rest_seconds: null,
      hold_seconds: null, prescribed_side: "left", resistance_type: "resistance_band", resistance_value: null, resistance_unit: null,
      resistance_label: "Resistance band", recurrence: "weekly", interval_days: null, weekdays: [5, 1, 3],
      start_date: "2026-09-28", end_date: "2026-10-25", assigned_date: "2026-09-28", prescription_state: "upcoming",
      occurrence_summary: { scheduled: 12, completed: 0, missed: 0, inProgress: 0, remaining: 12, cancelled: 0, painStopped: 0 } },
    { exercise_id: "ex_006", name: "Ended programme", monitoring_mode: "camera", sets: 3, reps: 0, hold_seconds: 30,
      prescribed_side: "both", resistance_type: "none", prescription_state: "ended", occurrence_summary: {} },
  ];
  const sampleProgram: HomeProgramItem[] = homeProgramFromRows(programRows);

  await test("progress report: trend, charts, pain columns and every group", () => {
    const sessions: ProgressReportSession[] = [
      trend(3, 97, { context: { ...CURRENT_CONTEXT, preSessionPain: { status: "reported", score: 7, bodyArea: "neck" } } }),
      trend(2, 94, { context: { ...CURRENT_CONTEXT, preSessionPain: { status: "declined" } } }),
      trend(1, 91, { painReport: { status: "declined", score: null, timing: null, bodyArea: null } }),
      trend(0, 88, { endReason: "user" }),
      { ...trend(0, 0), exerciseId: iso.id, exerciseName: iso.name, exerciseKind: "isometric", avgPeakValue: null,
        avgLeftPeakValue: null, avgRightPeakValue: null, totalPairedHoldMs: 25000, setCount: 1, totalReps: 0 },
      { ...trend(4, 0), setCount: 0, totalReps: 0 },
    ];
    const bytes = progressReportPdf(sessions, {
      patientName: "Test Patient", generatedAt: new Date("2026-09-26T01:00:00Z"), timeZone: "Asia/Manila",
      patient: samplePatient, program: sampleProgram,
    });
    saveSample("sample-progress-report.pdf", bytes);
    checkStructure(bytes);
    const text = drawnText(bytes);
    for (const expected of [
      "Progress report", "PATIENT NAME Test Patient PATIENT ID patient_007", "ASSIGNED THERAPIST Sarah Therapist",
      "REPORT DATA AS OF Sep 26, 2026, 9:00 AM SESSIONS WITH RESULTS 5, from Sep 10, 2026 to Sep 13, 2026 EXERCISES 2",
      "download it again to include later sessions",
      "Current home exercise program Exercise Dose Side and load Schedule Dates Done so far",
      "Lateral Arm Raises 2 sets of 12 reps · 30s rest Both sides · No resistance Every day Sep 20, 2026 to Oct 3, 2026 " +
        "5 of 14 scheduled days done · 1 missed",
      "Towel stretch (done without the camera) 1 set of 10 reps Left side · Resistance band",
      "3x a week · Mon, Wed, Fri (not started yet) Sep 28, 2026 to Oct 25, 2026 0 of 12 scheduled days done",
      "Lateral Arm Raises", "Measure Side Counted sessions Change since the first counted session (95 % range) Trend",
      "Peak angle (camera estimate) Left 4 +", "Peak angle (camera estimate) Right 4 +", "(95 % range +", "Rising",
      "Form score Left", "too few counted sessions so far (needs 3)",
      "Peak angle (camera estimate) by counted session",
      "Repetitions that met the full-range target, by session", "Counted sessions",
      "Peak angle (camera estimate) first 88 · latest 97",
      "Left full-range reps", "7/10 · neck", "skipped", "declined", "1/10", "Ended early", "Completed",
      iso.name, "Hold time", "25.0s", "machine-learning trend model",
      "Other measure", "Repetitions reaching the target range",
      "Limitations Angles labelled", "Sessions that were started but recorded no set are left out.",
      "How to read this report Reading the trends:", "Form score: the app's rule-based score from 0 to 100",
      "Notes Supplementary information for review with a physical therapist. It is not a diagnosis.",
      "For the app's developers: trend model",
      "Postural progress report · Test Patient · ID patient_007 · generated Sep 26, 2026, 9:00 AM",
    ]) assert(text.includes(expected), `missing: ${expected}`);
    assert(!text.includes("Ended programme"), "an ended prescription is not listed");
    assert(!NOT_BACKED.test(text), "no normal range, impression or sign-off");
    for (const jargon of ["pipeline units", "scoring configuration", "Model change", "Gaussian-process model of each side's session results that learned"]) {
      assert(!text.includes(jargon), `engineering wording left: ${jargon}`);
    }
    assert.equal((text.match(/Sep 14, 2026/g) ?? []).length, 0, "a session without a set is left out");

    const unloaded = drawnText(progressReportPdf(sessions.slice(0, 1), {
      patientName: "Test Patient", generatedAt: new Date("2026-09-26T01:00:00Z"), timeZone: "Asia/Manila", patient: null, program: null,
    }));
    assert(unloaded.includes("The patient's prescriptions could not be loaded"), "a program that failed to load says so");
    assert(unloaded.includes("The patient's record could not be loaded"), "so does the patient's record");
    const none = drawnText(progressReportPdf(sessions.slice(0, 1), { ...opts, program: [] }));
    assert(none.includes("No exercise is prescribed at the moment."), "an empty program");
    assert(!drawnText(progressReportPdf(sessions.slice(0, 1), opts)).includes("Current home exercise program"),
      "the section is left out when no program was given");
  });

  await test("progress report: a measure without a model band lists its measured values", () => {
    // Lateral-raise lowering time failed its band check, so the report gives values, not a model change.
    const sessions = [0, 1, 2].map((i) => trend(i, 90 + i, { avgLeftLoweringMs: 650 + 50 * i, avgRightLoweringMs: 600 }));
    const text = drawnText(progressReportPdf(sessions, opts));
    for (const expected of [
      "Lowering time (descent control)", "measured values only (the trend model has no range for this measure yet):",
      "Sep 10, 2026: 0.65 s", "Sep 11, 2026: 0.70 s", "Sep 12, 2026: 0.75 s",
    ]) assert(text.includes(expected), `missing: ${expected}`);
  });

  await test("old sessions keep their own target, kind and metric, not today's registry", () => {
    const oldDefinition = structuredClone(getExerciseDefinition("ex_001")!) as any;
    oldDefinition.primaryMetric.thresholds.targetROM = 70;
    const withOldTarget = { ...(context as any), exercise: { id: "ex_001", kind: "dynamic", definition: oldDefinition } };
    const noSavedTargets = detail.reps.map((r) => ({ ...r, targetRom: undefined }));
    const fromContext = drawnText(sessionReportPdf({ ...detail, context: withOldTarget, reps: noSavedTargets }, opts));
    assert(fromContext.includes("Left average peak angle (camera estimate) 93 70") && !fromContext.includes("93 90"),
      "the start context's target");
    const fromReps = drawnText(sessionReportPdf({ ...detail, context: withOldTarget, reps: detail.reps.map((r) => ({ ...r, targetRom: 65 })) }, opts));
    assert(fromReps.includes("Left average peak angle (camera estimate) 93 65"), "the target saved with the repetitions comes first");

    // ex_004 was a hold before it became repetitions; its old sessions stay holds.
    const oldHold: ProgressReportSession = {
      ...trend(0, 0), exerciseId: "ex_004", exerciseName: "Neck exercise (old hold)", exerciseKind: "isometric",
      avgPeakValue: null, avgLeftPeakValue: null, avgRightPeakValue: null, totalPairedHoldMs: 25000,
      totalLeftHoldMs: 25000, totalRightHoldMs: 25000, setCount: 1, totalReps: 0, exerciseConfigVersion: "historic-hold",
    };
    const [group] = groupSessionsByExercise([oldHold]);
    assert.equal(group.exerciseKind, "isometric", "the recorded kind, not today's dynamic ex_004");
    assert.equal(primaryMetricMeta(group.exerciseKind, group.primaryMetric).label, "Hold time");
    const [fromStart] = groupSessionsByExercise([{ ...oldHold, exerciseKind: null, context: { exercise: { kind: "isometric", definition: {} } } }]);
    assert.equal(fromStart.exerciseKind, "isometric", "the start context decides when no set recorded a kind");
    assert.equal(primaryMetricMeta("dynamic", "wristShoulderVertical").isAngle, false, "normalized units are not angles");
    const holdText = drawnText(progressReportPdf([oldHold], opts));
    assert(holdText.includes("Hold time first 25.0s") && !holdText.includes("Peak angle"), "reported as a hold");
    assert(!holdText.includes("full-range reps"), "no repetition chart for a hold");
    const holdSession = drawnText(sessionReportPdf({
      ...detail, exerciseId: "ex_004", exerciseName: "Neck exercise (old hold)", reps: [],
      context: { ...(context as any), exercise: { id: "ex_004", kind: "isometric", definition: {} } },
      sets: [{ setIndex: 1, exerciseKind: "isometric", leftReps: 0, rightReps: 0, targetHoldMs: 30000, pairedHoldMs: 25000,
        durationMs: 26000, terminatedBy: "user", holdQuality: null }],
    }, opts));
    assert(holdSession.includes("2 sets of 30s hold") && !holdSession.includes("12 reps"), "the prescription reads as a hold");
  });

  await test("cue labels are the app's own, and uncredited attempts still count as shown", async () => {
    const shoulderHead = await auditWith(frames(0, 300, ["scapularElevation", "Shoulder / head position"]), 400);
    const summary = cueSummary([{ setIndex: 1, holdQuality: { version: "coaching_set_v1", coaching: shoulderHead } }]);
    assert.deepEqual(summary.cues.map((c) => c.label), ["Shoulder / head position"], "names the region, not a movement");
    const onlyAttempt = drawnText(sessionReportPdf({
      ...detail, sets: [], reps: [],
      auditAttempts: [{ setIndex: 1, holdQuality: { version: "coaching_set_v1", coaching: shoulderHead, auditOnly: true } }],
    }, opts));
    assert(!onlyAttempt.includes("No coaching record is stored"), "an uncredited attempt's record counts");
    assert(onlyAttempt.includes("1 (uncredited)"), "marked uncredited");
    assert(onlyAttempt.includes("Counted in 1 attempt in which no movement was counted"), "coverage names the attempt");
    assert(!onlyAttempt.includes("0 of 0 sets"), "no empty set count");
    assert(!/shrug/i.test(onlyAttempt), "no movement the metric cannot identify");
  });

  await test("hold results keep the recorded sets apart from the whole prescription", () => {
    const holdContext = {
      ...(context as any), prescription: { ...(context as any).prescription, sets: 3, holdSeconds: 30 },
      exercise: { id: iso.id, kind: "isometric", definition: {} },
    };
    const text = drawnText(sessionReportPdf({
      ...detail, exerciseId: iso.id, exerciseName: iso.name, context: holdContext, reps: [],
      sets: [{ setIndex: 1, exerciseKind: "isometric", leftReps: 0, rightReps: 0, targetHoldMs: 30000, pairedHoldMs: 30000,
        durationMs: 31000, terminatedBy: "user", holdQuality: { leftInBandMs: 30000, rightInBandMs: 28000 } }],
    }, opts));
    assert(text.includes("Left time in position 30.0s held in 1 recorded set 30s in the recorded sets · prescribed 3 x 30s"), "left");
    assert(!text.includes("prescribed 3 x 30s Below target Right"), "a hold that met its recorded target is not flagged");
    assert(text.includes("Right time in position 28.0s held in 1 recorded set 30s in the recorded sets · prescribed 3 x 30s Below target"), "right");
    assert(text.includes("Sets done 1 3 Below target"), "sets short of the prescription");
    assert(text.includes("3 sets of 30s hold"), "prescription");
  });

  await test("patient block: the clinic's entries, the age on the report date, and the fallbacks", () => {
    assert.equal(formatDateKey("1990-03-04"), "Mar 4, 1990");
    // 2026-09-25 16:30 UTC is already Sep 26 in Manila: the birthday has come.
    assert.equal(ageOn("1990-09-26", new Date("2026-09-25T16:30:00Z"), "Asia/Manila"), 36);
    assert.equal(ageOn("1990-09-26", new Date("2026-09-25T16:30:00Z"), "UTC"), 35);
    assert.equal(ageOn("not a date", new Date(), "UTC"), null);
    const on = new Date("2026-09-26T01:00:00Z");
    const cells = (patient: ReportPatient) => Object.fromEntries(patientCells(patient, "x", on, "Asia/Manila").map((c) => [c.label, c.value]));
    assert.equal(cells({ ...samplePatient, dateOfBirth: null })["Date of birth (age)"], "not recorded (age 30 as entered)");
    assert.equal(cells({ ...samplePatient, dateOfBirth: null, age: null })["Date of birth (age)"], "not recorded");
    const blank = cells({ ...samplePatient, gender: " ", therapistName: null, diagnosis: "", condition: null });
    assert.deepEqual([blank.Gender, blank["Assigned therapist"], blank["Diagnosis (entered by the clinic)"], blank["Condition (entered by the clinic)"]],
      ["not recorded", "none assigned", "not recorded", "not recorded"]);

    // A long clinic entry continues on the next page instead of running off this one.
    const long = sessionReportPdf(detail, { ...opts, patient: { ...samplePatient, diagnosis: "Long clinic entry. ".repeat(400) } });
    assert(checkStructure(long) >= 2, "the block continues on a second page");
    assert(drawnText(long).includes("Long clinic entry. Long clinic entry."), "the entry is kept, not cut");

    // A long name is cut in the footer rather than run into the page number.
    const footer = fitText(`Postural session report · ${"Very Long Name ".repeat(20)}`, "regular", 7.5, 300);
    assert(footer.endsWith("…") && textWidth(footer, "regular", 7.5) <= 300, "cut with an ellipsis");
    const longName = drawnText(sessionReportPdf(detail, { ...opts, patient: { ...samplePatient, name: "Very Long Name ".repeat(20).trim() } }));
    assert(longName.includes("…") && longName.includes("Page 1 of"), "the page number is still drawn");
  });

  await test("loaders: patient record, session number, home program and the signed-in id", async () => {
    const realFetch = globalThis.fetch;
    const calls: string[] = [];
    const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
    const route = (handler: (url: string) => Response | Promise<Response>) => {
      globalThis.fetch = (async (url: string, init?: RequestInit) => {
        calls.push(`${url} ${init?.cache ?? ""}`);
        return handler(url);
      }) as typeof fetch;
    };
    try {
      route(() => reply(200, { user: { ...samplePatient, email: "p@example.com", age: 30 } }));
      assert.deepEqual(await fetchReportPatient("patient 7"), samplePatient, "the record's fields, nothing else");
      assert.equal(calls.at(-1), "/api/users/patient%207 no-store");
      route(() => reply(403, { error: "Forbidden" }));
      assert.equal(await fetchReportPatient("patient_007"), null, "a refused record is null");
      route(() => reply(200, { user: { id: 7 } }));
      assert.equal(await fetchReportPatient("patient_007"), null, "a malformed record is null");
      route(() => { throw new Error("offline"); });
      assert.equal(await fetchReportPatient("patient_007"), null, "a network failure is null");

      const listed = (id: number, exerciseId: string, day: number, setCount: number) =>
        ({ id, exerciseId, startedAt: `2026-09-${String(day).padStart(2, "0")}T03:00:00.000Z`, setCount, totalReps: setCount * 10 });
      route(() => reply(200, { sessions: [
        listed(230, "ex_001", 24, 2), listed(218, "ex_001", 20, 2), listed(219, "ex_002", 21, 2),
        listed(217, "ex_001", 19, 0), listed(210, "ex_001", 12, 1),
      ] }));
      assert.deepEqual(await fetchSessionNumber({ id: 218, patientId: "patient_007", exerciseId: "ex_001" }), { index: 2, total: 3 },
        "ordered by start, same exercise, sessions with results only");
      assert.equal(calls.at(-1), "/api/sessions?patientId=patient_007 no-store");
      assert.deepEqual(await fetchSessionNumber({ id: 217, patientId: "patient_007", exerciseId: "ex_001" }), { index: null, total: 3 },
        "a session without a set is not counted");
      const before = calls.length;
      assert.equal(await fetchSessionNumber({ id: 218, exerciseId: "ex_001" }), null, "no patient, no number");
      assert.equal(calls.length, before, "and no request");
      route(() => reply(500, {}));
      assert.equal(await fetchSessionNumber({ id: 218, patientId: "patient_007", exerciseId: "ex_001" }), null);

      route(() => reply(200, { exercises: programRows }));
      const program = await fetchHomeProgram("patient_007");
      assert.deepEqual(program?.map((item) => [item.name, item.state]), [["Lateral Arm Raises", "active"], ["Towel stretch", "upcoming"]],
        "running and upcoming prescriptions only");
      assert.equal(calls.at(-1), "/api/patient-exercises?patientId=patient_007 no-store");
      assert.deepEqual(homeProgramRow(program![0]), [
        "Lateral Arm Raises", "2 sets of 12 reps · 30s rest", "Both sides · No resistance", "Every day",
        "Sep 20, 2026 to Oct 3, 2026", "5 of 14 scheduled days done · 1 missed",
      ]);
      route(() => reply(403, {}));
      assert.equal(await fetchHomeProgram("patient_007"), null, "a refused program is null");

      route(() => reply(200, { user: { id: "patient_007", role: "patient" } }));
      assert.equal(await fetchSignedInUserId(), "patient_007");
      assert.equal(calls.at(-1), "/api/auth/me no-store");
      route(() => reply(401, {}));
      assert.equal(await fetchSignedInUserId(), null);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  await test("the progress download fetches the saved sessions afresh", async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    let saved: ProgressReportSession[] = [trend(0, 88)];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      return new Response(JSON.stringify({ sessions: saved }), { status: 200 });
    }) as typeof fetch;
    try {
      assert.equal((await fetchProgressSessions({ patientId: "p 1" })).length, 1);
      saved = [trend(1, 91), trend(0, 88)]; // saved after the page loaded
      assert.equal((await fetchProgressSessions({})).length, 2, "the newer session is included");
      assert.deepEqual(calls.map(([url, init]) => [url, init?.cache]), [
        ["/api/sessions?patientId=p%201", "no-store"], ["/api/sessions", "no-store"],
      ]);
      globalThis.fetch = (async () => new Response("{}", { status: 403 })) as typeof fetch;
      await assert.rejects(fetchProgressSessions({}), /403/, "a failed load is an error, not an empty report");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  await test("file names are plain and dated", () => {
    assert.equal(reportFileName("progress", "José Dela Cruz", new Date(2026, 8, 26, 23, 0)), "postural-progress-report-jose-dela-cruz-2026-09-26.pdf");
    assert.equal(reportFileName("session", "Arm Abduction at 90°", new Date(2026, 8, 26)), "postural-session-report-arm-abduction-at-90-2026-09-26.pdf");
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exitCode = 1;
}

void run();
