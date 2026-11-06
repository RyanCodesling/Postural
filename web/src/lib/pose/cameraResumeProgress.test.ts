/**
 * cameraResumeProgress.test.ts
 *
 * A reload mid-session followed by Resume must not zero the end-of-session
 * card. Runs the camera page's own snapshot writer, reader and restore
 * helpers (extracted from CameraClient.tsx) against an in-memory
 * localStorage: completed sets, repetition outcomes and the capture tally
 * written before a disruption come back on Resume, survive a second
 * disruption, and older or malformed snapshots restore nothing.
 *
 *   npx tsx src/lib/pose/cameraResumeProgress.test.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import vm from "node:vm";
import { cameraDeclarations, transpile } from "../../../scripts/lib/cameraReplayHarness";
import { getExerciseDefinition } from "../exercises/registry";
import { EXERCISE_CONFIG_VERSIONS, exerciseVersionPayload, sha256Version } from "../exercises/versioning";
import { POSE_METRIC_ALGORITHM_VERSION } from "./metricVersion";

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`      ${err instanceof Error ? err.message : String(err)}`);
    failed += 1;
  }
}

const store = new Map<string, string>();
// What the page hashed from its own code (versionPayload.ts); the same strings
// as the server's, which coachingMeasurement.test.ts checks.
let pageVersions: Readonly<Record<string, string>> | null = EXERCISE_CONFIG_VERSIONS;
const ref = (current: any) => ({ current });
const rep = (peakValue: number, classification: "complete" | "partial", i: number) => ({
  index: i, startTimeMs: 1000 + i * 3000, peakTimeMs: 2000 + i * 3000, endTimeMs: 3000 + i * 3000, peakValue,
  ascentDurationMs: 1000, holdDurationMs: 100, descentDurationMs: 900, totalDurationMs: 2000, classification,
});
const setRecord = {
  setIndex: 1, targetReps: 12, leftReps: 12, rightReps: 12, pairedReps: 12,
  durationMs: 35101, terminatedBy: "min_reached", asymmetryIndex: 0,
};
const twelve = () => Array.from({ length: 12 }, (_, i) => rep(i === 0 ? 70 : 96, i === 0 ? "partial" : "complete", i + 1));

const context: any = vm.createContext({
  window: { localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  } },
  performance: { now: () => 50_000 },
  Date, JSON, Math, Number, Array, POSE_METRIC_ALGORITHM_VERSION,
  computedExerciseConfigVersions: () => pageVersions,
  useCallback: (fn: any) => fn,
  prescriptionRef: ref({ patientExerciseId: 77 }),
  sessionIdRef: ref(218),
  activeDefinitionRef: ref(getExerciseDefinition("ex_001")),
  sessionStateRef: ref("resting"),
  sessionStartMsRef: ref(1000),
  completedSetsRef: ref(1),
  repCountsRef: ref({ left: 0, right: 0 }),
  pairedHoldMsRef: ref(0), leftHoldMsRef: ref(0), rightHoldMsRef: ref(0),
  globalRepIndexRef: ref(24), rawFrameIndexRef: ref(0),
  completedSetsLogRef: ref([setRecord]),
  priorRepOutcomesRef: ref({ left: [], right: [] }),
  repLogRef: ref({ left: twelve(), right: twelve() }),
  captureFramesTotalRef: ref(1000), captureFramesOkRef: ref(950),
  captureRejectedByStatusRef: ref({ KNEES_NOT_VISIBLE: 40, NOT_VISIBLE: 10 }), captureDropoutResetsRef: ref(2),
  captureUnsteadyFramesRef: ref(12),
  captureCheckedFramesRef: ref(900),
  captureFrameSizesRef: ref({ "1280x720": 900, "640x480": 50 }),
  neckRestTallyRef: ref({ epochs: [{ from: "2026-10-19T10:00:00.000Z", readings: [1.5, -0.5, 2] }] }),
  recordingWantedRef: ref(false),
});
vm.runInContext(transpile(cameraDeclarations([
  "RESUME_KEY_PREFIX", "resumeKey", "readResumeSnapshot", "restoredSessionProgress", "sessionRepOutcomes", "writeResumeSnapshot",
]) + `
globalThis.api = { readResumeSnapshot, restoredSessionProgress, sessionRepOutcomes, writeResumeSnapshot };
`), context);
const api = context.api;
const plain = (v: any) => JSON.parse(JSON.stringify(v));

console.log("\ncamera resume progress\n");

test("a snapshot written after a completed set restores its sets, reps and capture tally", () => {
  api.writeResumeSnapshot();
  const snap = api.readResumeSnapshot(77);
  assert(snap, "snapshot is stored");
  const progress = plain(api.restoredSessionProgress(snap));
  assert.deepEqual(progress.setsLog, [setRecord]);
  assert.equal(progress.repOutcomes.left.length, 12);
  assert.equal(progress.repOutcomes.right.length, 12);
  assert.deepEqual(progress.repOutcomes.left[0], { peakValue: 70, classification: "partial" });
  assert.equal(progress.repOutcomes.left.filter((o: any) => o.classification === "complete").length, 11);
  assert.deepEqual(progress.captureFrames,
    { total: 1000, ok: 950, rejectedByStatus: { KNEES_NOT_VISIBLE: 40, NOT_VISIBLE: 10 }, dropoutResets: 2, unsteady: 12, checked: 900,
      frameSizes: { "1280x720": 900, "640x480": 50 } },
    "the frame sizes measured before the disruption come back, both of them");
  assert.deepEqual(progress.neckRest, { epochs: [{ from: "2026-10-19T10:00:00.000Z", readings: [1.5, -0.5, 2] }] },
    "the neck rest readings taken before the disruption come back with their calibration");
});

test("a snapshot from another measurement is not offered for Resume (D-48)", () => {
  api.writeResumeSnapshot();
  const key = "postural.resume.v1.77";
  const saved = JSON.parse(store.get(key)!);
  assert.equal(saved.poseMetricAlgorithm, POSE_METRIC_ALGORITHM_VERSION, "the writer records the measurement");
  assert(api.readResumeSnapshot(77), "this measurement's snapshot resumes");
  store.set(key, JSON.stringify({ ...saved, poseMetricAlgorithm: "pose_metrics_v2_frozen_neutral_tilt" }));
  assert.equal(api.readResumeSnapshot(77), null, "a snapshot from before the aspect correction does not");
  const { poseMetricAlgorithm: _dropped, ...unversioned } = saved;
  void _dropped;
  store.set(key, JSON.stringify(unversioned));
  assert.equal(api.readResumeSnapshot(77), null, "nor one written before the field existed");
  store.set(key, JSON.stringify(saved));
});

test("nor is one from another version of its exercise, under the same measurement (D-49)", () => {
  api.writeResumeSnapshot();
  const key = "postural.resume.v1.77";
  const saved = JSON.parse(store.get(key)!);
  assert.equal(saved.exerciseConfigVersion, EXERCISE_CONFIG_VERSIONS.ex_001, "the writer records the exercise's version");
  const neck = structuredClone(getExerciseDefinition("ex_004")!);
  assert(neck.kind === "dynamic");
  delete neck.primaryMetric.reference;
  const beforeEarLine = sha256Version(exerciseVersionPayload(neck));
  assert.notEqual(beforeEarLine, EXERCISE_CONFIG_VERSIONS.ex_004);
  const neckSnap = { ...saved, exerciseId: "ex_004", exerciseConfigVersion: EXERCISE_CONFIG_VERSIONS.ex_004 };
  store.set(key, JSON.stringify(neckSnap));
  assert(api.readResumeSnapshot(77), "a neck snapshot of this version resumes");
  store.set(key, JSON.stringify({ ...neckSnap, exerciseConfigVersion: beforeEarLine }));
  assert.equal(api.readResumeSnapshot(77), null, "one from before the calibration ear line does not");
  const { exerciseConfigVersion: _dropped, ...unversioned } = neckSnap;
  void _dropped;
  store.set(key, JSON.stringify(unversioned));
  assert.equal(api.readResumeSnapshot(77), null, "nor one written before the field existed");
  store.set(key, JSON.stringify(saved));
  pageVersions = null;
  assert.equal(api.readResumeSnapshot(77), null, "nothing is offered before the page has hashed its exercises");
  pageVersions = EXERCISE_CONFIG_VERSIONS;
  assert(api.readResumeSnapshot(77), "and the snapshot is offered once it has");
});

test("a second disruption keeps the restored outcomes plus the new ones", () => {
  const first = api.restoredSessionProgress(api.readResumeSnapshot(77));
  // As resumeSession does: restored outcomes go to the prior ref; the live log restarts.
  context.priorRepOutcomesRef.current = first.repOutcomes;
  context.repLogRef.current = { left: [rep(95, "complete", 25)], right: [] };
  context.sessionStateRef.current = "active";
  api.writeResumeSnapshot();
  const second = plain(api.restoredSessionProgress(api.readResumeSnapshot(77)));
  assert.equal(second.repOutcomes.left.length, 13, "12 restored + 1 new");
  assert.equal(second.repOutcomes.right.length, 12);
  assert.deepEqual(second.repOutcomes.left.at(-1), { peakValue: 95, classification: "complete" });
});

test("an older snapshot without the new fields restores nothing", () => {
  const old = { v: 1, sessionId: 218, exerciseId: "ex_001", patientExerciseId: 77, kind: "dynamic", completedSets: 1,
    currentSetReps: { left: 0, right: 0 }, pairedHoldMs: 0, elapsedMs: 40_000, globalRepIndex: 24, rawFrameIndex: 0,
    updatedAtWallMs: Date.now() };
  const progress = plain(api.restoredSessionProgress(old));
  assert.deepEqual(progress, { setsLog: [], repOutcomes: { left: [], right: [] },
    captureFrames: { total: 0, ok: 0, rejectedByStatus: {}, dropoutResets: 0, unsteady: 0, checked: 0, frameSizes: {} },
    neckRest: { epochs: [] } });
  // Neck rest readings with a bad start time, a non-number or too many restore none.
  for (const epochs of [[{ from: "yesterday", readings: [1] }], [{ from: "2026-10-19T10:00:00.000Z", readings: [1, "2"] }],
    [{ from: "2026-10-19T10:00:00.000Z", readings: new Array(3001).fill(0) }], "nope"]) {
    const restored = plain(api.restoredSessionProgress({ ...old, neckRest: { epochs } }));
    assert.deepEqual(restored.neckRest, { epochs: [] }, `restores none: ${JSON.stringify(epochs).slice(0, 60)}`);
  }
  // A snapshot from before the rejection reasons keeps its tally, with none.
  const tallyOnly = plain(api.restoredSessionProgress({ ...old, captureFrames: { total: 5, ok: 4 } }));
  assert.deepEqual(tallyOnly.captureFrames, { total: 5, ok: 4, rejectedByStatus: {}, dropoutResets: 0, unsteady: 0, checked: 0, frameSizes: {} });
  // Frame sizes adding up to more frames than passed, or with a malformed key, restore none.
  for (const frameSizes of [{ "1280x720": 5 }, { "1280-720": 2 }, { "0x720": 2 }, { "1280x720": -1 }, ["1280x720"]]) {
    const restored = plain(api.restoredSessionProgress({ ...old, captureFrames: { total: 5, ok: 4, frameSizes } }));
    assert.deepEqual(restored.captureFrames.frameSizes, {}, `restores none: ${JSON.stringify(frameSizes)}`);
    assert.equal(restored.captureFrames.ok, 4, "the rest of the tally is kept");
  }
  // More unsteady frames than tracked frames is inconsistent and restores none.
  const tooMany = plain(api.restoredSessionProgress({ ...old, captureFrames: { total: 5, ok: 4, unsteady: 9 } }));
  assert.equal(tooMany.captureFrames.unsteady, 0);
  // So is more checked frames than tracked frames.
  const tooManyChecked = plain(api.restoredSessionProgress({ ...old, captureFrames: { total: 5, ok: 4, checked: 9 } }));
  assert.equal(tooManyChecked.captureFrames.checked, 0);
});

test("malformed fields are dropped rather than restored", () => {
  const bad = { v: 1, sessionId: 218, completedSets: 1,
    completedSetsLog: [setRecord, { setIndex: "2" }, null],
    repOutcomes: { left: [{ peakValue: "96", classification: "complete" }, { peakValue: 90, classification: "maybe" },
      { peakValue: 88, classification: "partial" }], right: "nope" },
    captureFrames: { total: 5, ok: 9 } };
  const progress = plain(api.restoredSessionProgress(bad));
  assert.deepEqual(progress.setsLog, [setRecord]);
  assert.deepEqual(progress.repOutcomes, { left: [{ peakValue: 88, classification: "partial" }], right: [] });
  assert.deepEqual(progress.captureFrames, { total: 0, ok: 0, rejectedByStatus: {}, dropoutResets: 0, unsteady: 0, checked: 0, frameSizes: {} }, "ok cannot exceed total");
});

test("whole-attempt outcomes list restored ones before this page's", () => {
  const merged = plain(api.sessionRepOutcomes(
    { left: [{ peakValue: 80, classification: "partial" }], right: [] },
    { left: [rep(96, "complete", 2)], right: [rep(91, "complete", 1)] },
  ));
  assert.deepEqual(merged, {
    left: [{ peakValue: 80, classification: "partial" }, { peakValue: 96, classification: "complete" }],
    right: [{ peakValue: 91, classification: "complete" }],
  });
});

test("nothing is written outside an active or resting patient session", () => {
  store.clear();
  context.sessionStateRef.current = "ended";
  api.writeResumeSnapshot();
  assert.equal(store.size, 0);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exitCode = 1;
