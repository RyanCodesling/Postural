/**
 * cameraPreSessionSurvey.test.ts
 *
 * A patient's new session waits for the before-session pain survey. Runs the
 * camera page's own start step and survey helpers (extracted from
 * CameraClient.tsx) with fake dependencies: Back cancels the start without
 * running its confirm callback, Save and Skip continue with their answer, and
 * staff or schedule-locked starts show no survey.
 *
 *   npx tsx src/lib/pose/cameraPreSessionSurvey.test.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import vm from "node:vm";
import { cameraDeclarations, transpile } from "../../../scripts/lib/cameraReplayHarness";

const ref = (current: any) => ({ current });
const plain = (v: any) => JSON.parse(JSON.stringify(v));
const settle = () => new Promise((resolve) => setImmediate(resolve));

function harness(options: { patientExerciseId?: number; actionable?: boolean }) {
  const calls = { provenance: 0, confirmed: 0, survey: [] as any[], notices: [] as any[] };
  const context: any = vm.createContext({
    activeDefinition: { id: "ex_001" },
    user: { role: options.patientExerciseId === undefined ? "therapist" : "patient" },
    selectedExercise: "ex_001",
    actionableOccurrenceIds: new Set(options.actionable === false ? [] : [5]),
    prescriptionRef: ref({ patientExerciseId: options.patientExerciseId, occurrenceId: 5 }),
    setScheduleNotice: (notice: any) => calls.notices.push(notice),
    preSessionPainRef: ref({ status: "declined" }), // left over from an earlier start
    preSessionSurveyResolveRef: ref(null),
    setPreSessionSurvey: (survey: any) => calls.survey.push(survey),
    coachingProvenanceRef: ref(null),
    captureCoachingProvenance: async () => { calls.provenance += 1; return null; },
    // A camera that is not ready ends the start right after the survey step.
    cameraReadyRef: ref(false),
    streamRef: ref(null),
    activeDefinitionRef: ref({ id: "ex_001" }),
  });
  vm.runInContext(transpile(cameraDeclarations(["askPreSessionPain", "answerPreSessionSurvey", "handleSessionStart"]) +
    "\nglobalThis.api = { answerPreSessionSurvey, handleSessionStart };"), context);
  const start = () => context.api.handleSessionStart(() => { calls.confirmed += 1; });
  return { context, calls, start, answer: context.api.answerPreSessionSurvey };
}

async function run() {
  console.log("\ncamera before-session pain survey\n");

  {
    const { context, calls, start, answer } = harness({ patientExerciseId: 1 });
    const started = start();
    await settle();
    assert.deepEqual(plain(calls.survey), [{ score: 0, bodyArea: "" }], "the survey opens at 0 with no body area");
    assert.equal(calls.provenance, 0, "nothing after the survey runs before an answer");
    assert.equal(calls.confirmed, 0, "the start is still cancellable");
    answer(null);
    await started;
    assert.equal(calls.survey.at(-1), null, "the survey closes");
    assert.equal(calls.provenance, 0, "Back cancels the start");
    assert.equal(calls.confirmed, 0, "Back does not run the confirm callback (Start over keeps its snapshot)");
    assert.equal(context.preSessionPainRef.current, null, "an earlier answer does not carry over");
    console.log("  ✓ Back cancels the start");
  }

  for (const answerValue of [{ status: "reported", score: 8, bodyArea: "neck" }, { status: "declined" }]) {
    const { context, calls, start, answer } = harness({ patientExerciseId: 1 });
    const started = start();
    await settle();
    answer(answerValue);
    await started;
    assert.equal(calls.confirmed, 1, "the confirm callback runs once the survey is answered");
    assert.equal(calls.provenance, 1, "the start continues");
    assert.deepEqual(plain(context.preSessionPainRef.current), answerValue, "the answer is kept for the session create");
    console.log(`  ✓ ${answerValue.status === "declined" ? "Skip" : "Save"} continues with its answer`);
  }

  {
    const { context, calls, start } = harness({});
    await start();
    assert.equal(calls.survey.length, 0, "staff starts have no survey");
    assert.equal(calls.confirmed, 1);
    assert.equal(calls.provenance, 1);
    assert.equal(context.preSessionPainRef.current, null, "no answer is sent for a staff start");
    console.log("  ✓ staff starts skip the survey");
  }

  {
    const { calls, start } = harness({ patientExerciseId: 1, actionable: false });
    await start();
    assert.equal(calls.survey.length, 0, "a start refused by the schedule asks nothing");
    assert.equal(calls.notices.length, 1, "the schedule notice is shown instead");
    assert.equal(calls.confirmed, 0);
    console.log("  ✓ schedule-locked starts show the notice, not the survey");
  }

  console.log("\n5 passed, 0 failed\n");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
