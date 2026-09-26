/**
 * cameraPreSessionSurvey.test.ts
 *
 * A patient's new session waits for the before-session pain survey and then
 * the session video question. Runs the camera page's own start step and
 * question helpers (extracted from CameraClient.tsx) with fake dependencies:
 * Back on either screen cancels the start without running its confirm
 * callback; the video answer is kept for the session create and, when asked,
 * remembered for this patient; a remembered answer skips the question; staff
 * and schedule-locked starts ask nothing.
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

function harness(options: { patientExerciseId?: number; actionable?: boolean; remembered?: boolean }) {
  const calls = { provenance: 0, confirmed: 0, survey: [] as any[], question: [] as any[], notices: [] as any[] };
  const stored = new Map<string, boolean>();
  if (options.remembered !== undefined) stored.set("p1", options.remembered);
  const context: any = vm.createContext({
    activeDefinition: { id: "ex_001" },
    user: { id: "p1", role: options.patientExerciseId === undefined ? "therapist" : "patient" },
    selectedExercise: "ex_001",
    actionableOccurrenceIds: new Set(options.actionable === false ? [] : [5]),
    prescriptionRef: ref({ patientExerciseId: options.patientExerciseId, occurrenceId: 5 }),
    setScheduleNotice: (notice: any) => calls.notices.push(notice),
    preSessionPainRef: ref({ status: "declined" }), // left over from an earlier start
    preSessionSurveyResolveRef: ref(null),
    setPreSessionSurvey: (survey: any) => calls.survey.push(survey),
    videoQuestionResolveRef: ref(null),
    setVideoQuestion: (question: any) => calls.question.push(question),
    readVideoChoice: (userId: string) => (stored.has(userId) ? { record: stored.get(userId), notice: "notice_remembered" } : null),
    rememberVideoChoice: (userId: string, record: boolean) => { stored.set(userId, record); },
    SESSION_VIDEO_NOTICE_VERSION: "notice_shown",
    videoConsentRef: ref(true), // left over from an earlier start
    videoConsentRememberedRef: ref(true),
    videoConsentNoticeRef: ref("notice_old"),
    recordingWantedRef: ref(true),
    setRecordingState: () => {},
    coachingProvenanceRef: ref(null),
    captureCoachingProvenance: async () => { calls.provenance += 1; return null; },
    // A camera that is not ready ends the start right after the questions.
    cameraReadyRef: ref(false),
    streamRef: ref(null),
    activeDefinitionRef: ref({ id: "ex_001" }),
  });
  vm.runInContext(transpile(cameraDeclarations([
    "askPreSessionPain", "answerPreSessionSurvey", "askVideoChoice", "answerVideoChoice", "handleSessionStart",
  ]) + "\nglobalThis.api = { answerPreSessionSurvey, answerVideoChoice, handleSessionStart };"), context);
  const start = () => context.api.handleSessionStart(() => { calls.confirmed += 1; });
  return { context, calls, stored, start, answerPain: context.api.answerPreSessionSurvey, answerVideo: context.api.answerVideoChoice };
}

async function run() {
  console.log("\ncamera before-session questions\n");
  let passed = 0;

  {
    const { context, calls, start, answerPain } = harness({ patientExerciseId: 1 });
    const started = start();
    await settle();
    assert.deepEqual(plain(calls.survey), [{ score: 0, bodyArea: "" }], "the pain survey opens at 0 with no body area");
    assert.equal(calls.provenance, 0, "nothing after the questions runs before an answer");
    answerPain(null);
    await started;
    assert.equal(calls.survey.at(-1), null, "the survey closes");
    assert.equal(calls.question.length, 0, "Back on the pain screen asks nothing more");
    assert.equal(calls.provenance, 0, "Back cancels the start");
    assert.equal(calls.confirmed, 0, "Back does not run the confirm callback (Start over keeps its snapshot)");
    assert.equal(context.preSessionPainRef.current, null, "an earlier answer does not carry over");
    assert.equal(context.videoConsentRef.current, false, "Back never consents to recording");
    assert.equal(context.videoConsentNoticeRef.current, null, "no notice is carried over");
    console.log("  ✓ Back on the pain screen cancels the start");
    passed += 1;
  }

  for (const [pain, video] of [
    [{ status: "reported", score: 8, bodyArea: "neck" }, { record: true, remember: false }],
    [{ status: "declined" }, { record: false, remember: true }],
  ] as const) {
    const { context, calls, stored, start, answerPain, answerVideo } = harness({ patientExerciseId: 1 });
    const started = start();
    await settle();
    answerPain(pain);
    await settle();
    assert.deepEqual(plain(calls.question), [{ remember: false }], "the video question follows, not remembering by default");
    assert.equal(calls.confirmed, 0, "the start is still cancellable at the video question");
    answerVideo(video);
    await started;
    assert.equal(calls.question.at(-1), null, "the question closes");
    assert.deepEqual(plain(context.preSessionPainRef.current), pain, "the pain answer is kept for the session create");
    assert.equal(context.videoConsentRef.current, video.record, "the video answer is kept for the session create");
    assert.equal(context.videoConsentRememberedRef.current, false, "an answer given now is not a remembered one");
    assert.equal(context.videoConsentNoticeRef.current, "notice_shown", "the answer is to the notice this page showed");
    assert.deepEqual([...stored.entries()], video.remember ? [["p1", video.record]] : [], "remembered only when asked");
    assert.equal(calls.confirmed, 1);
    assert.equal(calls.provenance, 1, "the start continues");
    console.log(`  ✓ ${video.record ? "Yes" : "No"} ${video.remember ? "(remembered) " : ""}continues the start`);
    passed += 1;
  }

  for (const remembered of [true, false]) {
    const { context, calls, start, answerPain } = harness({ patientExerciseId: 1, remembered });
    const started = start();
    await settle();
    answerPain({ status: "declined" });
    await started;
    assert.equal(calls.question.length, 0, "a remembered answer skips the question");
    assert.equal(context.videoConsentRef.current, remembered);
    assert.equal(context.videoConsentRememberedRef.current, true, "the consent is marked as remembered");
    assert.equal(context.videoConsentNoticeRef.current, "notice_remembered", "a remembered answer carries the notice it was given under");
    assert.equal(calls.provenance, 1);
    console.log(`  ✓ a remembered ${remembered ? "yes" : "no"} skips the question`);
    passed += 1;
  }

  {
    const { context, calls, stored, start, answerPain, answerVideo } = harness({ patientExerciseId: 1 });
    const started = start();
    await settle();
    answerPain({ status: "declined" });
    await settle();
    answerVideo(null);
    await started;
    assert.equal(calls.provenance, 0, "Back on the video question cancels the start");
    assert.equal(calls.confirmed, 0);
    assert.equal(context.videoConsentRef.current, false, "no consent without an answer");
    assert.equal(stored.size, 0, "nothing is remembered");
    console.log("  ✓ Back on the video question cancels the start");
    passed += 1;
  }

  {
    const { context, calls, start } = harness({});
    await start();
    assert.equal(calls.survey.length + calls.question.length, 0, "staff starts ask nothing");
    assert.equal(calls.confirmed, 1);
    assert.equal(context.videoConsentRef.current, false, "staff starts never record");
    console.log("  ✓ staff starts skip the questions");
    passed += 1;
  }

  {
    const { calls, start } = harness({ patientExerciseId: 1, actionable: false });
    await start();
    assert.equal(calls.survey.length + calls.question.length, 0, "a start refused by the schedule asks nothing");
    assert.equal(calls.notices.length, 1, "the schedule notice is shown instead");
    assert.equal(calls.confirmed, 0);
    console.log("  ✓ schedule-locked starts show the notice, not the questions");
    passed += 1;
  }

  console.log(`\n${passed} passed, 0 failed\n`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
