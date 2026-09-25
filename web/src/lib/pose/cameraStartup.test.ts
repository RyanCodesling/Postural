/** Execute the camera's actual startup functions with fake browser dependencies. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const filename = fileURLToPath(new URL("../../app/(app)/camera/CameraClient.tsx", import.meta.url));
const source = readFileSync(filename, "utf8");
const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = ast.statements.find((node): node is ts.FunctionDeclaration =>
  ts.isFunctionDeclaration(node) && node.name?.text === "CameraClient",
);
assert(component?.body);
const wanted = ["predictWebcam", "startCamera", "startSessionWithCamera", "resumeSession"];
const functions = component.body.statements.filter(node =>
  ts.isFunctionDeclaration(node)
    ? wanted.includes(node.name?.text ?? "")
    : ts.isVariableStatement(node) && node.declarationList.declarations.some(d => wanted.includes(d.name.getText(ast))),
);
assert.equal(functions.length, wanted.length);
const code = ts.transpileModule(
  functions.map(node => node.getText(ast)).join("\n") +
    "\nglobalThis.subject = {startSessionWithCamera, resumeSession};",
  { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } },
).outputText;

let frames = 0, starts = 0, cameraRequests = 0, snapshotReads = 0;
let failure: string | null = null;
let stops = 0;
let resumeSnapshot: { exerciseId: string } | null = null;
const ref = <T,>(current: T) => ({ current });
const video = {
  readyState: 4, videoWidth: 1280, videoHeight: 720,
  play: () => Promise.resolve(), onloadeddata: undefined as (() => void) | undefined,
};
const state = {
  canUseMediaDevices: true, isStarting: false, modelLoaded: false,
  selectedDeviceId: "", useFrontCameraHint: true,
  activeDefinition: { id: "ex_001" }, prescriptionRef: ref({ patientExerciseId: 1 }),
  readResumeSnapshot: () => { snapshotReads++; return resumeSnapshot; },
  videoRef: ref(video), canvasRef: ref({ width: 1280, height: 720, getContext: () => null }),
  landmarkerRef: ref<object | null>(null), activeDefinitionRef: ref(null),
  streamRef: ref<unknown>(null), requestRef: ref(null),
  sessionStartPendingRef: ref(false), cameraStartEpochRef: ref(0),
  cameraReadyRef: ref(false),
  setTimeout, clearTimeout,
  videoResolutionRef: ref<{ width: number; height: number } | null>(null),
  fpsFrameCountRef: ref(0), fpsWindowStartMsRef: ref(0), perfSampleCountRef: ref(0),
  inferMsSumRef: ref(0), frameMsSumRef: ref(0),
  setIsStarting: () => {}, setError: () => {}, setCameraStreamActive: () => {},
  setVideoResolution: () => {}, setFps: () => {}, setPerfMs: () => {},
  listCameras: async () => {}, getErrorName: (error: Error) => error.name,
  performance: { now: () => 100 }, requestAnimationFrame: () => ++frames,
  handleSessionStart: async () => { starts++; },
  navigator: { mediaDevices: { getUserMedia: async () => {
    cameraRequests++;
    if (failure) throw Object.assign(new Error(failure), { name: failure });
    return { getTracks: () => [{ stop: () => { stops++; } }] };
  } } },
  stopCamera: async () => {
    const stream = state.streamRef.current as { getTracks(): { stop(): void }[] } | null;
    stream?.getTracks().forEach(t => t.stop());
    state.streamRef.current = null;
    state.cameraReadyRef.current = false;
    state.cameraStartEpochRef.current++;
  },
};
const context = vm.createContext(state);
vm.runInContext(code, context);
const subject = (context as unknown as { subject: { startSessionWithCamera(): Promise<void>; resumeSession(): Promise<void> } }).subject;

async function run() {
  await subject.startSessionWithCamera();
  await subject.resumeSession();
  for (let i = 0; i < 6; i++) await Promise.resolve();
  assert.equal(cameraRequests, 0, "loading Start/Resume must not request a camera");
  assert.equal(starts, 0, "loading Start must not create a session");
  assert.equal(snapshotReads, 0, "loading Resume must not restore progress");
  assert.equal(frames, 0);
  assert.equal(video.onloadeddata, undefined);

  state.modelLoaded = true;
  state.landmarkerRef.current = {};
  await subject.resumeSession();
  assert.equal(snapshotReads, 1, "ready Resume reaches the snapshot lookup");
  // The null snapshot intentionally stops here: restoration/persistence is
  // covered elsewhere; this check proves the readiness boundary only.
  await Promise.all([subject.startSessionWithCamera(), subject.startSessionWithCamera()]);
  assert.equal(cameraRequests, 1);
  assert.equal(starts, 1);
  assert.equal(frames, 1, "ready video schedules inference");
  assert.equal(state.videoResolutionRef.current?.width, 1280);
  assert.equal(state.videoResolutionRef.current?.height, 720);
  for (const name of ["NotAllowedError", "NotFoundError", "NotReadableError", "OverconstrainedError"]) {
    await state.stopCamera(); failure = name;
    const startsBeforeFailure: number = starts;
    await subject.startSessionWithCamera();
    assert.equal(starts, startsBeforeFailure, `${name} must not open persistence`);
    assert.equal(state.streamRef.current, null);
    assert.equal(state.sessionStartPendingRef.current, false);
    resumeSnapshot = { exerciseId: "ex_001" };
    await subject.resumeSession();
    assert.equal(starts, startsBeforeFailure, `${name}: failed Resume must not create a session`);
    assert.equal(state.streamRef.current, null);
    resumeSnapshot = null;
  }
  failure = null;
  const play = video.play;
  video.play = () => Promise.reject(new Error("video playback failed"));
  await subject.startSessionWithCamera();
  assert.equal(starts, 1, "playback failure must not open persistence");
  assert(stops >= 2, "failed playback releases its stream");
  video.play = play;
  state.canUseMediaDevices = false;
  await subject.startSessionWithCamera();
  assert.equal(starts, 1, "missing camera API must not open persistence");
  state.canUseMediaDevices = true;
  state.isStarting = true;
  await subject.startSessionWithCamera();
  assert.equal(starts, 1, "an in-flight camera request is not camera success");
  state.isStarting = false;
  video.readyState = 0;
  const pendingStart = subject.startSessionWithCamera();
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.equal(starts, 1, "a granted stream must wait for playable video before persistence");
  assert.equal(typeof video.onloadeddata, "function");
  video.readyState = 4;
  video.onloadeddata!();
  await pendingStart;
  assert.equal(starts, 2);
  console.log("Camera Start readiness, concurrent clicks, permission/device/playback failures passed; no camera or database used.");
}
run().catch(error => { console.error(error); process.exitCode = 1; });
