/**
 * PDF reports: the writer's file structure (xref offsets, stream lengths, page
 * count, ASCII-only output), text encoding and wrapping, cue episodes read from
 * a real coaching audit, and the session and progress reports' content,
 * including the "angle (camera estimate)" wording and the pain columns.
 *
 *   npx tsx src/lib/reports/reports.test.ts
 *
 * Set REPORT_SAMPLE_DIR to an existing folder to also save the sample session
 * and progress PDFs there for a visual check.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { getExerciseDefinition } from "../exercises/registry";
import { captureCoachingProvenance } from "../pose/coachingConfig";
import { CoachingAuditBuffer, cueEpisodes, setCoachingAudit } from "../pose/coachingAudit";
import type { SessionContextSnapshot } from "../prescriptionContext";
import { reportFileName } from "./download";
import { pdfText, ReportLayout, textWidth, wrapText } from "./pdfWriter";
import { cueSummary, sessionReportPdf, type SessionReportInput } from "./sessionReport";
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
    id: 218, exerciseId: "ex_001", exerciseName: "Lateral Arm Raises",
    startedAt: "2026-09-25T16:40:00.000Z", endedAt: "2026-09-25T16:48:07.898Z", endReason: "user", context,
    painReport: { status: "reported", score: 2, timing: "after", bodyArea: null },
    captureQuality: { framesTotal: 1000, framesOk: 950, pctOk: 95 },
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

  await test("session report: outcome, sides, sets, pain, cues and the angle label", () => {
    const bytes = sessionReportPdf(detail, { patientName: "Test Patient", generatedAt: new Date("2026-09-26T01:00:00Z"), timeZone: "Asia/Manila" });
    saveSample("sample-session-report.pdf", bytes);
    checkStructure(bytes);
    const text = drawnText(bytes);
    for (const expected of [
      "Session report", "Lateral Arm Raises · Test Patient", "Sep 26, 2026, 12:40 AM", "Ended early by the patient",
      "2 sets of 12 reps · 30s rest · both sides · No resistance", "Sets done 2 of 2",
      "Pain before the session 3/10 · left shoulder", "Pain after the attempt 2/10 · after",
      "95% of frames tracked (950 of 1000)", "Left repetitions 16/17 met full-ROM target",
      "Right repetitions 17/17 met full-ROM target", "Left average peak angle (camera estimate)",
      "Target reached", "Ended by patient", "Trunk lean", "“STRAIGHTEN”".replace(/[“”]/g, '"'),
      "Asymmetric shoulders", "Counted from the observed part of 1 of 2 sets", "not anatomical degrees",
      "93 · target 90",
    ]) assert(text.includes(expected), `missing: ${expected}`);
    assert(!text.includes("°"), "no degree sign for readings");
    const cues = cueSummary(detail.sets);
    assert.deepEqual(cues.cues.map((c) => [c.label, c.times]), [["Trunk lean", 2], ["Asymmetric shoulders", 1]]);
  });

  await test("session report: older session without context or coaching record", () => {
    const text = drawnText(sessionReportPdf({
      ...detail, context: null, sets: detail.sets.map((s) => ({ ...s, holdQuality: null })),
      reps: detail.reps.map((r) => ({ ...r, targetRom: null })),
    }, { patientName: "Test Patient", generatedAt: new Date(), timeZone: "Asia/Manila" }));
    assert(text.includes("not recorded for this older session"), "prescription");
    assert(text.includes("target not recorded") && !text.includes("target 90"), "no target is borrowed from today's registry");
    assert(text.includes("Pain before the session not recorded"), "pain before");
    assert(text.includes("No coaching record is stored for this session"), "no audit");
  });

  const trend = (i: number, peak: number, extra: Partial<ProgressReportSession> = {}): ProgressReportSession => ({
    exerciseId: "ex_001", exerciseName: "Lateral Arm Raises", exerciseKind: "dynamic",
    startedAt: `2026-09-${String(10 + i).padStart(2, "0")}T03:00:00.000Z`,
    avgPeakValue: peak, avgLeftPeakValue: peak, avgRightPeakValue: peak - 2,
    completeLeftReps: 8 + i, completeRightReps: 7 + i, leftReps: 12, rightReps: 12,
    totalPairedHoldMs: null, setCount: 2, totalReps: 24, prescribedSide: "both",
    resistance: { type: "none", value: null, unit: null, label: null }, exerciseConfigVersion: "sha256:x",
    endReason: "completed", context: null,
    painReport: { status: "reported", score: 1, timing: null, bodyArea: null }, ...extra,
  });
  const iso = getExerciseDefinition("ex_006")!;

  await test("progress report: trend, charts, pain columns and every group", () => {
    const sessions: ProgressReportSession[] = [
      trend(3, 97, { context: { preSessionPain: { status: "reported", score: 7, bodyArea: "neck" } } }),
      trend(2, 94, { context: { preSessionPain: { status: "declined" } } }),
      trend(1, 91, { painReport: { status: "declined", score: null, timing: null, bodyArea: null } }),
      trend(0, 88, { endReason: "user" }),
      { ...trend(0, 0), exerciseId: iso.id, exerciseName: iso.name, exerciseKind: "isometric", avgPeakValue: null,
        avgLeftPeakValue: null, avgRightPeakValue: null, totalPairedHoldMs: 25000, setCount: 1, totalReps: 0 },
      { ...trend(4, 0), setCount: 0, totalReps: 0 },
    ];
    const bytes = progressReportPdf(sessions, { patientName: "Test Patient", generatedAt: new Date("2026-09-26T01:00:00Z"), timeZone: "Asia/Manila" });
    saveSample("sample-progress-report.pdf", bytes);
    checkStructure(bytes);
    const text = drawnText(bytes);
    for (const expected of [
      "Progress report", "Data as of Sep 26, 2026, 9:00 AM", "download it again to include later sessions",
      "Sessions with results 5, from Sep 10, 2026 to Sep 13, 2026", "Exercises 2",
      "Lateral Arm Raises", "Trend (left) Rising, change +", "Trend (right) Rising, change +",
      "Form score (left)", "Peak angle (camera estimate) first 88 · latest 97",
      "Left full-range reps", "7/10 · neck", "skipped", "declined", "1/10", "Ended early", "Completed",
      iso.name, "Hold time", "25.0s", "needs at least 3 counted sessions", "machine-learning trend model",
      "Other measure", "Repetitions reaching the target range",
    ]) assert(text.includes(expected), `missing: ${expected}`);
    assert.equal((text.match(/Sep 14, 2026/g) ?? []).length, 0, "a session without a set is left out");
  });

  const opts = { patientName: "Test Patient", generatedAt: new Date("2026-09-26T01:00:00Z"), timeZone: "Asia/Manila" };

  await test("progress report: a measure without a model band lists its measured values", () => {
    // Lateral-raise lowering time failed its band check, so the report gives values, not a model change.
    const sessions = [0, 1, 2].map((i) => trend(i, 90 + i, { avgLeftLoweringMs: 650 + 50 * i, avgRightLoweringMs: 600 }));
    const text = drawnText(progressReportPdf(sessions, opts));
    for (const expected of [
      "Lowering time (descent control)", "no model band; measured",
      "Sep 10, 2026: 0.65 s", "Sep 11, 2026: 0.70 s", "Sep 12, 2026: 0.75 s",
    ]) assert(text.includes(expected), `missing: ${expected}`);
  });

  await test("old sessions keep their own target, kind and metric, not today's registry", () => {
    const oldDefinition = structuredClone(getExerciseDefinition("ex_001")!) as any;
    oldDefinition.primaryMetric.thresholds.targetROM = 70;
    const withOldTarget = { ...(context as any), exercise: { id: "ex_001", kind: "dynamic", definition: oldDefinition } };
    const noSavedTargets = detail.reps.map((r) => ({ ...r, targetRom: undefined }));
    const fromContext = drawnText(sessionReportPdf({ ...detail, context: withOldTarget, reps: noSavedTargets }, opts));
    assert(fromContext.includes("target 70") && !fromContext.includes("target 90"), "the start context's target");
    const fromReps = drawnText(sessionReportPdf({ ...detail, context: withOldTarget, reps: detail.reps.map((r) => ({ ...r, targetRom: 65 })) }, opts));
    assert(fromReps.includes("target 65"), "the target saved with the repetitions comes first");

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
    assert(onlyAttempt.includes("0 of 0 sets and 1 attempt that credited no movement"), "coverage names the attempt");
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
    assert(text.includes("Left time in position 30.0s held of 30s targeted in 1 recorded set · prescribed 3 x 30s"), "left");
    assert(text.includes("Right time in position 28.0s held"), "right");
    assert(text.includes("3 sets of 30s hold"), "prescription");
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
