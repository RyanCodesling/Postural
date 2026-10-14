/**
 * cameraEndReport.test.ts
 *
 * The end-of-session card offers a session's PDF only for a complete record.
 * Runs the camera page's own `endSessionPersistence` (extracted from
 * CameraClient.tsx) with fake transports: the report becomes available only
 * when the session row closed AND every queued result was delivered, never
 * while results remain unsent, and never for a run a newer one replaced.
 *
 *   npx tsx src/lib/pose/cameraEndReport.test.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import vm from "node:vm";
import { cameraDeclarations, transpile } from "../../../scripts/lib/cameraReplayHarness";
import { buildCaptureQualitySummary } from "../sessionReadModels";

const ref = (current: any) => ({ current });

function harness(options: { sessionId: number | null; rowOk?: boolean; drained?: boolean }) {
  const offered: Array<number | null> = [];
  const bodies: any[] = [];
  let stoppedRecording = 0;
  let releaseDrain: () => void = () => {};
  const drainGate = new Promise<void>((resolve) => { releaseDrain = resolve; });
  const context: any = vm.createContext({
    console: { warn() {} },
    sessionIdRef: ref(options.sessionId),
    prescriptionRef: ref({ patientExerciseId: 3 }),
    sessionTokenRef: ref(7),
    pendingStaleEndReasonRef: ref(undefined),
    reportSessionIdRef: ref(null),
    captureFramesTotalRef: ref(100),
    captureFramesOkRef: ref(90),
    captureRejectedByStatusRef: ref({ KNEES_NOT_VISIBLE: 8, NOT_VISIBLE: 2 }),
    captureDropoutResetsRef: ref(1),
    captureUnsteadyFramesRef: ref(3),
    captureCheckedFramesRef: ref(80),
    videoResolutionRef: ref({ width: 1280, height: 720 }),
    buildCaptureQualitySummary,
    resetSessionPersistence: () => {},
    stopSessionRecording: () => { stoppedRecording += 1; },
    flushRawFrames: () => {},
    setLastSessionId: (id: number | null) => offered.push(id),
    fetch: async (_url: string, init?: { body?: string }) => {
      if (init?.body) bodies.push(JSON.parse(init.body));
      return { ok: options.rowOk ?? true, status: options.rowOk === false ? 500 : 200 };
    },
    eventOutboxRef: ref({
      drain: async () => { await drainGate; return { drained: options.drained ?? true }; },
      clearStorage: () => {},
    }),
  });
  vm.runInContext(transpile(cameraDeclarations(["SESSION_END_DRAIN_TIMEOUT_MS", "endSessionPersistence"]) +
    "\nglobalThis.end = endSessionPersistence;"), context);
  return { context, offered, bodies, releaseDrain, recordingStops: () => stoppedRecording, end: () => context.end(false, "user") as Promise<string> };
}

async function run() {
  console.log("\ncamera end-card report availability\n");

  {
    const h = harness({ sessionId: 218 });
    const ending = h.end();
    assert.deepEqual(h.offered, [null], "nothing is offered while results are still being saved");
    h.releaseDrain();
    assert.equal(await ending, "saved");
    assert.deepEqual(h.offered, [null, 218], "a fully saved session gets its report");
    assert.equal(h.recordingStops(), 1, "ending the session ends its video recording");
    assert.deepEqual(h.bodies[0]?.captureQualitySummary, {
      framesTotal: 100, framesOk: 90, pctOk: 90,
      rejectedFramesByStatus: { KNEES_NOT_VISIBLE: 8, NOT_VISIBLE: 2 }, sustainedDropoutResets: 1,
      unsteadyFrames: 3, checkedFrames: 80, frame: { width: 1280, height: 720 },
    }, "the end request saves why frames were rejected, the dropout resets, the unsteady and checked frames, and the picture size");
    console.log("  ✓ saved: the report is offered after the save completes");
  }

  {
    const h = harness({ sessionId: 218, drained: false });
    const ending = h.end();
    h.releaseDrain();
    assert.equal(await ending, "partial");
    assert.deepEqual(h.offered, [null, null], "unsent results mean no report");
    console.log("  ✓ partial: no report while results are unsent");
  }

  {
    const h = harness({ sessionId: 218, rowOk: false });
    const ending = h.end();
    h.releaseDrain();
    assert.equal(await ending, "failed");
    assert.deepEqual(h.offered, [null, null]);
    console.log("  ✓ failed: no report when the session row did not close");
  }

  {
    const h = harness({ sessionId: 218 });
    const ending = h.end();
    h.context.sessionTokenRef.current += 1; // a new run starts while this one drains
    h.releaseDrain();
    assert.equal(await ending, "saved");
    assert.deepEqual(h.offered, [null], "a replaced run does not claim the end card");
    console.log("  ✓ a newer run keeps the end card");
  }

  {
    const h = harness({ sessionId: null });
    assert.equal(await h.end(), "pending");
    assert.deepEqual(h.offered, [null], "no session row, no report");
    console.log("  ✓ an unresolved create offers nothing");
  }

  console.log("\n5 passed, 0 failed\n");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
