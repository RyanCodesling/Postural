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
const ref = <T,>(current: T) => ({ current });
const video = {
  readyState: 4, videoWidth: 1280, videoHeight: 720,
  play: () => Promise.resolve(), onloadeddata: undefined as (() => void) | undefined,
};
const state = {
  canUseMediaDevices: true, isStarting: false, modelLoaded: false,
  selectedDeviceId: "", useFrontCameraHint: true,
  activeDefinition: { id: "ex_001" }, prescriptionRef: ref({ patientExerciseId: 1 }),
  readResumeSnapshot: () => { snapshotReads++; return null; },
  videoRef: ref(video), canvasRef: ref({ width: 1280, height: 720, getContext: () => null }),
  landmarkerRef: ref<object | null>(null), activeDefinitionRef: ref(null),
  streamRef: ref<unknown>(null), requestRef: ref(null),
  videoResolutionRef: ref<{ width: number; height: number } | null>(null),
  fpsFrameCountRef: ref(0), fpsWindowStartMsRef: ref(0), perfSampleCountRef: ref(0),
  inferMsSumRef: ref(0), frameMsSumRef: ref(0),
  setIsStarting: () => {}, setError: () => {}, setCameraStreamActive: () => {},
  setVideoResolution: () => {}, setFps: () => {}, setPerfMs: () => {},
  listCameras: async () => {}, getErrorName: (error: Error) => error.name,
  performance: { now: () => 100 }, requestAnimationFrame: () => ++frames,
  handleSessionStart: async () => { starts++; },
  navigator: { mediaDevices: { getUserMedia: async () => { cameraRequests++; return { getTracks: () => [] }; } } },
  stopCamera: async () => { state.streamRef.current = null; },
};
const context = vm.createContext(state);
vm.runInContext(code, context);
const subject = (context as unknown as { subject: { startSessionWithCamera(): void; resumeSession(): void } }).subject;

async function run() {
  subject.startSessionWithCamera();
  subject.resumeSession();
  for (let i = 0; i < 6; i++) await Promise.resolve();
  assert.equal(cameraRequests, 0, "loading Start/Resume must not request a camera");
  assert.equal(starts, 0, "loading Start must not create a session");
  assert.equal(snapshotReads, 0, "loading Resume must not restore progress");
  assert.equal(frames, 0);
  assert.equal(video.onloadeddata, undefined);

  state.modelLoaded = true;
  state.landmarkerRef.current = {};
  subject.resumeSession();
  assert.equal(snapshotReads, 1, "ready Resume reaches the snapshot lookup");
  // The null snapshot intentionally stops here: restoration/persistence is
  // covered elsewhere; this check proves the readiness boundary only.
  subject.startSessionWithCamera();
  for (let i = 0; i < 6; i++) await Promise.resolve();
  assert.equal(typeof video.onloadeddata, "function");
  video.onloadeddata!();
  assert.equal(cameraRequests, 1);
  assert.equal(starts, 1);
  assert.equal(frames, 1, "ready video schedules inference");
  assert.equal(state.videoResolutionRef.current?.width, 1280);
  assert.equal(state.videoResolutionRef.current?.height, 720);
  console.log("Camera startup readiness passed for Start and Resume; no camera or database used.");
}
run().catch(error => { console.error(error); process.exitCode = 1; });
