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
  Date, JSON, Math, Number, Array,
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
  assert.deepEqual(progress.captureFrames, { total: 1000, ok: 950 });
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
  assert.deepEqual(progress, { setsLog: [], repOutcomes: { left: [], right: [] }, captureFrames: { total: 0, ok: 0 } });
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
  assert.deepEqual(progress.captureFrames, { total: 0, ok: 0 }, "ok cannot exceed total");
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
