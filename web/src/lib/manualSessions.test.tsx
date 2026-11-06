/** Manual-session callers with fixture transport; private SQL acceptance is
 * available through npm run verify:manual:db. No camera or patient data used. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import { cameraDeclarations } from "../../scripts/lib/cameraReplayHarness";
import { SESSION_VIDEO_NOTICE_VERSION, videoConsentFromContext } from "./prescriptionContext";
import { SESSION_VIDEO_NOTICE } from "./recording/consent";
import { readVideoChoice } from "./recording/videoChoice";

const nodeRequire = createRequire(import.meta.url);
const exercise = { id: "fixture-custom", patientExerciseId: 81, occurrenceId: 91, sets: 4, reps: 12, restSeconds: 30 };
const runtime = { ...exercise, exerciseId: exercise.id, sets: 2, reps: 5, restSeconds: 0, holdSeconds: 0,
  prescribedSide: "left", resistance: { type: "none", value: null, unit: null, label: null } };
const response = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const compile = (source: string) => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;

function cameraClient(fetchImpl: typeof fetch) {
  const context: any = vm.createContext({
    exports: {}, fetch: fetchImpl, user: { id: "fixture-patient", role: "patient" }, navigator: { userAgent: "fixture" },
    SESSION_VIDEO_NOTICE_VERSION, Date, Number,
    customSessionIdRef: { current: null }, customRecordingConsentRef: { current: false },
    customReportSessionIdRef: { current: null }, customRecordingStoppedRef: { current: false },
    assignedExercisesRef: { current: [exercise] }, cameraReadyRef: { current: true },
    sessionWallStartMsRef: { current: 0 }, sessionPerfStartMsRef: { current: 0 },
    readVideoChoice: () => ({ record: false, notice: SESSION_VIDEO_NOTICE_VERSION }),
    askPreSessionPain: async () => ({ status: "declined" }),
    setCustomRecordingOpen() {}, stopSessionRecording() {}, setAssignedExercises() {},
    setRecordingState() {}, setError: (error: string) => { context.error = error; },
    isRecord: (value: unknown) => value !== null && typeof value === "object" && !Array.isArray(value),
  });
  vm.runInContext(compile(cameraDeclarations(["beginCustomSession", "patchCustomSession", "endCustomSession"]) +
    "\nglobalThis.subject = {beginCustomSession, endCustomSession};"), context);
  return context;
}

/** The camera page's recorder calls, with a fixture recorder whose part closes when released. */
function recordingClient() {
  const recorders: Array<{ started: number; release: () => void }> = [];
  class FixtureRecorder {
    started = 0;
    release: () => void = () => {};
    private stopping: Promise<void> | null = null;
    constructor() { recorders.push(this); }
    async start() { this.started++; return true; }
    stop() { return this.stopping ??= new Promise<void>(resolve => { this.release = resolve; }); }
  }
  let fetchImpl: typeof fetch = async () => response(200, { success: true });
  const context: any = vm.createContext({
    exports: {}, fetch: (...args: Parameters<typeof fetch>) => fetchImpl(...args), SessionRecorder: FixtureRecorder,
    streamRef: { current: {} }, recorderRef: { current: null }, recordingWantedRef: { current: false },
    customSessionIdRef: { current: 71 }, customRecordingConsentRef: { current: true },
    customRecordingStoppedRef: { current: false }, customReportSessionIdRef: { current: null },
    perfToIso: () => new Date(0).toISOString(), performance: { now: () => 0 }, Date,
    setRecordingState() {}, setCustomRecordingOpen() {},
    isRecord: (value: unknown) => value !== null && typeof value === "object" && !Array.isArray(value),
  });
  vm.runInContext(compile(cameraDeclarations(["startSessionRecording", "stopSessionRecording", "recordCustomSet",
    "patchCustomSession", "endCustomSession"]) +
    "\nglobalThis.subject = {stopSessionRecording, recordCustomSet, endCustomSession};"), context);
  return { context, recorders, setFetch: (impl: typeof fetch) => { fetchImpl = impl; } };
}

function guided(props: Record<string, any>) {
  const state: any[] = [];
  let index = 0;
  const context = vm.createContext({ exports: {}, require: nodeRequire, Date, Math,
    useState(initial: any) {
      const slot = index++;
      if (!(slot in state)) state[slot] = typeof initial === "function" ? initial() : initial;
      return [state[slot], (value: any) => { state[slot] = typeof value === "function" ? value(state[slot]) : value; }];
    },
    useRef(initial: any) { const slot = index++; return state[slot] ?? (state[slot] = { current: initial }); },
    useEffect() {}, CARD_STYLE: {}, EYEBROW_STYLE: {}, ACCENT: {}, PRIMARY_BUTTON_STYLE: {}, SECONDARY_BUTTON_STYLE: {}, FIELD_STYLE: {},
  }) as any;
  vm.runInContext(compile(cameraDeclarations(["CustomGuidedSession"]) + "\nglobalThis.subject = CustomGuidedSession;"), context);
  const render = () => { index = 0; return context.subject({ sets: 4, restSeconds: 30, ...props }); };
  function find(node: any, label: string): any {
    if (!node || typeof node !== "object") return null;
    if (Array.isArray(node)) return node.map(n => find(n, label)).find(Boolean);
    const children = node.props?.children;
    if (node.type === "button" && renderToStaticMarkup(node).includes(label)) return node;
    return find(children, label);
  }
  const click = async (label: string) => {
    const button = find(render(), label);
    assert(button, `Missing button: ${label}`);
    button.props.onClick();
    await new Promise(resolve => setImmediate(resolve));
  };
  return { render, click, html: () => renderToStaticMarkup(render()) };
}

async function main() {
  for (const status of [401, 403, 409, 500]) {
    const client = cameraClient((async () => response(status, { error: "Rejected fixture start" })) as typeof fetch);
    assert.equal(await client.subject.beginCustomSession(exercise), false);
    assert.equal(client.customSessionIdRef.current, null);
  }
  const offline = cameraClient((async () => { throw new Error("offline"); }) as typeof fetch);
  assert.equal(await offline.subject.beginCustomSession(exercise), false);
  const accepted = cameraClient((async () => response(200, { sessionId: 71, runtimePrescription: runtime })) as typeof fetch);
  accepted.customReportSessionIdRef.current = 70;
  const dose = await accepted.subject.beginCustomSession(exercise);
  assert.equal(accepted.customReportSessionIdRef.current, null, "an unanswered report target stays with its own attempt");
  assert.deepEqual(JSON.parse(JSON.stringify(dose)), { sets: 2, restSeconds: 0 });
  assert.equal(accepted.assignedExercisesRef.current[0].reps, 5);
  assert.equal(accepted.assignedExercisesRef.current[0].prescribedSide, "left");
  console.log("PASS manual start rejects transport/auth/schedule errors and adopts the server prescription");

  let calls = 0;
  const retry = cameraClient((async () => ++calls === 1 ? response(500, { error: "Not saved" }) : response(200, { success: true })) as typeof fetch);
  retry.customSessionIdRef.current = 71;
  assert.equal(await retry.subject.endCustomSession("pain"), "Not saved");
  assert.equal(retry.customSessionIdRef.current, 71);
  assert.equal(retry.customReportSessionIdRef.current, null);
  assert.equal(await retry.subject.endCustomSession("pain"), null);
  assert.equal(calls, 2, "the retry sends a second request");
  assert.equal(retry.customSessionIdRef.current, null);
  assert.equal(retry.customReportSessionIdRef.current, 71);
  console.log("PASS pain-stop failure retains its target and a successful retry enables the pain report");

  let setStarts = 0;
  for (const before of [async () => false, async () => { throw new Error("offline"); }]) {
    const ui = guided({ onBeforeStart: before, onSetStart: () => setStarts++ });
    await ui.click("Start session");
    assert(ui.html().includes("Start session"));
  }
  assert.equal(setStarts, 0);
  let completed = 0;
  const ui = guided({ onBeforeStart: async () => ({ sets: 2, restSeconds: 0 }),
    onSetStart: () => setStarts++, onComplete: async () => { completed++; return null; } });
  await ui.click("Start session");
  assert(ui.html().includes("Set 1 of 2"));
  await ui.click("Set done");
  assert(ui.html().includes("Set 2 of 2"));
  await ui.click("Finish");
  assert.equal(completed, 1);
  console.log("PASS the actual guide stays idle on failure and completes the authoritative two-set dose");

  let finishPain!: (error: string | null) => void;
  const pain = guided({ onPainStop: () => new Promise<string | null>(resolve => { finishPain = resolve; }),
    onBackToSchedule() {} });
  await pain.click("Start session");
  await pain.click("Stop — I have pain");
  assert(pain.html().includes("Saving the pain stop"));
  assert(!pain.html().includes("has been notified"));
  assert(!pain.html().includes("Back to schedule"));
  finishPain("Save failed");
  await new Promise(resolve => setImmediate(resolve));
  assert(pain.html().includes("has not been saved"));
  assert(!pain.html().includes("has been notified"));
  await pain.click("Try saving again");
  finishPain(null);
  await new Promise(resolve => setImmediate(resolve));
  assert(pain.html().includes("has been notified"));
  console.log("PASS pain-stop feedback distinguishes pending, failed and acknowledged saves");

  const flush = () => new Promise(resolve => setImmediate(resolve));
  const rec = recordingClient();
  rec.context.subject.recordCustomSet();
  assert.equal(rec.recorders.length, 1);
  assert.equal(rec.recorders[0].started, 1, "the first set's part opens at once");
  rec.context.subject.stopSessionRecording();
  rec.context.subject.recordCustomSet();
  assert.equal(rec.recorders.length, 1, "with no rest the next part waits for the last one to close");
  rec.recorders[0].release();
  await flush();
  assert.equal(rec.recorders.length, 2);
  assert.equal(rec.recorders[1].started, 1, "then it opens");
  let finishPatch!: (value: Response) => void;
  rec.setFetch((() => new Promise<Response>(resolve => { finishPatch = resolve; })) as typeof fetch);
  rec.context.subject.stopSessionRecording();
  rec.context.subject.recordCustomSet();
  const ending = rec.context.subject.endCustomSession("user");
  rec.recorders[1].release();
  await flush();
  assert.equal(rec.recorders.length, 2, "no part opens once the session is ending");
  finishPatch(response(200, { success: true }));
  assert.equal(await ending, null);
  assert.equal(rec.context.customReportSessionIdRef.current, 71, "pain after this attempt follows an early end");
  console.log("PASS a custom set's part opens only after the last one closes, and never once the session ends");

  for (const [saved, asked] of [[null, true], ["Not saved", false]] as const) {
    const ends: string[] = [];
    const early = guided({ onEnd: async (reason: string) => { ends.push(reason); return saved; },
      painReport: { pending: () => true, save: async () => null } });
    await early.click("Start session");
    await early.click("End session");
    assert.deepEqual(ends, ["user"]);
    assert.equal(early.html().includes("Pain after this attempt"), asked, `early end ${saved ?? "saved"}`);
  }
  const parts: string[] = [];
  const noRest = guided({ onBeforeStart: async () => ({ sets: 2, restSeconds: 0 }),
    onSetStart: () => parts.push("open"), onRestStart: () => parts.push("close") });
  await noRest.click("Start session");
  await noRest.click("Set done");
  assert(noRest.html().includes("Set 2 of 2"));
  assert.deepEqual(parts, ["open", "close", "open"], "with no rest each set still gets its own part");
  const noted = guided({ startNote: "Session video: recorded, as you asked this device to remember." });
  assert(noted.html().includes("as you asked this device to remember"));
  await noted.click("Start session");
  assert(!noted.html().includes("as you asked this device to remember"), "the note shows only beside Start session");
  const camera = readFileSync(new URL("../app/(app)/camera/CameraClient.tsx", import.meta.url), "utf8");
  assert.match(camera, /startNote=\{videoChoiceNote\}/, "a custom exercise shows the remembered video choice");
  assert.match(camera, /\{!selectedExerciseObj\?\.isCustom && videoChoiceNote\}/, "a camera exercise keeps it");
  console.log("PASS End session asks pain after this attempt once saved, each set records its own part, and a remembered video choice shows beside a custom Start session");

  const oldConsent = { consentedAt: "2026-10-01T00:00:00Z", notice: "session_video_notice_v3" };
  assert.deepEqual(videoConsentFromContext({ videoConsent: oldConsent }), oldConsent);
  assert.equal(readVideoChoice("fixture", { getItem: () => JSON.stringify({ record: true, notice: oldConsent.notice }),
    setItem() {}, removeItem() {} }), null);
  assert(SESSION_VIDEO_NOTICE.join(" ").includes("not erased automatically"));
  assert.equal(SESSION_VIDEO_NOTICE_VERSION, "session_video_notice_v4");
  console.log("PASS the updated recovery notice expires old remembered choices without rewriting historical consent");

  const source = readFileSync(new URL("../app/api/sessions/manual/route.ts", import.meta.url), "utf8");
  let writes = 0;
  let user: any = { id: "fixture-patient", role: "patient" };
  class SessionNotScheduledError extends Error {}
  const route = vm.createContext({ exports: {}, console: { error() {} }, require(name: string) {
    if (name === "next/server") return { NextResponse: { json: (body: unknown, init?: any) => response(init?.status ?? 200, body) } };
    if (name === "@/lib/auth-server") return { getAuthenticatedUser: async () => user };
    if (name === "@/lib/prescriptionContext") return nodeRequire("./prescriptionContext.ts");
    if (name === "@/lib/db") return { SessionNotScheduledError, createCustomExerciseSession: async () => {
      writes++; return { id: 71, startedAt: "2026-11-02T04:00:00Z", runtimePrescription: runtime };
    } };
    throw new Error(`Unexpected dependency: ${name}`);
  } }) as any;
  vm.runInContext(compile(source), route);
  const request = (body: any) => ({ json: async () => ({ ...exercise, exerciseId: exercise.id, ...body }) });
  assert.equal((await route.exports.POST(request({ videoConsent: true, videoNotice: "session_video_notice_v3" }))).status, 409);
  assert.equal(writes, 0);
  const created = await route.exports.POST(request({ videoConsent: false }));
  assert.equal(created.status, 200);
  assert.equal((await created.json()).runtimePrescription.sets, 2);
  user = { id: "fixture-therapist", role: "therapist" };
  assert.equal((await route.exports.POST(request({}))).status, 403);
  user = null;
  assert.equal((await route.exports.POST(request({}))).status, 401);
  assert.equal(writes, 1);
  console.log("PASS the real manual route enforces current notice/auth and delivers the saved prescription");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
