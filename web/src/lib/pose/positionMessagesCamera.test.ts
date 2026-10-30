/**
 * The display-only additions of 2026-10-25 through the actual camera loop (`createCameraReplay`): the lateral raise's
 * past-shoulder-height cue, the arm hold's raise-or-lower hint, the dark-picture message and the body-turn message.
 * Run with: npx tsx src/lib/pose/positionMessagesCamera.test.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import { createCameraReplay } from "../../../scripts/lib/cameraReplayHarness";
import { getExerciseDefinition } from "../exercises/registry";
import { BODY_TURN_MESSAGE } from "./bodyTurn";
import { evaluateCaptureReadiness } from "./captureReadiness";
import { captureCoachingProvenance } from "./coachingConfig";
import { OVERLAY_LABELS } from "./drawCompensationOverlay";
import { DARK_PICTURE_MESSAGE } from "./pictureBrightness";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`      ${error instanceof Error ? error.message : String(error)}`);
    failed += 1;
  }
}

/**
 * A front-facing pose with each arm raised `left` / `right` degrees from hanging (as coachingMeasurement.test.ts),
 * the right forearm turned a further `rightBend` degrees at the elbow (0 = straight).
 */
function pose(left: number, right = left, rightBend = 0): any[] {
  const p = (x: number, y: number) => ({ x, y, z: 0, visibility: 1 });
  const lm = Array.from({ length: 33 }, () => p(0.5, 0.5));
  lm[7] = p(0.6, 0.23); lm[8] = p(0.4, 0.23);
  lm[11] = p(0.6, 0.35); lm[12] = p(0.4, 0.35);
  lm[23] = p(0.6, 0.7); lm[24] = p(0.4, 0.7);
  for (const [angle, shoulder, elbow, wrist, sign, bend] of [[left, 11, 13, 15, 1, 0], [right, 12, 14, 16, -1, rightBend]]) {
    const r = (angle * Math.PI) / 180;
    const f = ((angle + bend) * Math.PI) / 180;
    lm[elbow] = p(lm[shoulder].x + sign * 0.16 * Math.sin(r), 0.35 + 0.16 * Math.cos(r));
    lm[wrist] = p(lm[elbow].x + sign * 0.14 * Math.sin(f), lm[elbow].y + 0.14 * Math.cos(f));
  }
  return lm;
}

/** World landmarks with the hip line turned `deg` from square. */
function turnedWorld(deg: number) {
  const r = (deg * Math.PI) / 180;
  const world = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0 }));
  world[23] = { x: 0.1 * Math.cos(r), y: 0, z: 0.1 * Math.sin(r) };
  world[24] = { x: -0.1 * Math.cos(r), y: 0, z: -0.1 * Math.sin(r) };
  return world;
}

const BASELINE = { scapLeft: 0.12 / 0.35, scapRight: 0.12 / 0.35 };
const STOP = OVERLAY_LABELS.overRaise!;

async function main() {
  console.log("\nPosition messages and the past-shoulder-height cue through the camera loop\n");
  const raise = getExerciseDefinition("ex_001")!;
  const hold = getExerciseDefinition("ex_006")!;

  await test("a raise to shoulder height draws no past-shoulder-height cue; a raise well past it does, and both count", async () => {
    const replay = createCameraReplay(raise, await captureCoachingProvenance(raise));
    let now = 1000;
    const cycle = (top: number) => {
      const from = replay.frames.length;
      for (const a of [0, 0, 20, 45, 70, top * 0.8, top, top, top, top, top, top, top, top, top * 0.8, 60, 30, 10, 0, 0, 0, 0]) {
        replay.tick({ tMs: (now += 100), landmarks: pose(a, a), baselines: BASELINE });
      }
      return replay.frames.slice(from);
    };
    const shoulderHeight = cycle(95);
    assert(shoulderHeight.every((f: any) => !f.renderedTexts.includes(STOP)), "not drawn at shoulder height");
    const past = cycle(150); // reads about 134 on a 16:9 frame
    assert(past.some((f: any) => f.renderedTexts.includes(STOP)), "drawn well past shoulder height");
    assert.equal(replay.emitted.filter((r: any) => r.side === "left").length, 2, "both raises counted on the left");
    assert.equal(replay.emitted.filter((r: any) => r.side === "right").length, 2, "and on the right");
    assert(replay.frames.every((f: any) => !f.renderedTexts.includes("Raise your arms only to shoulder height.")), "the declared sentence stays unrendered");
  });

  await test("the arm hold shows which way an arm should move, and holds it back while that arm is unsteady", async () => {
    const replay = createCameraReplay(hold, await captureCoachingProvenance(hold));
    let now = 1000;
    for (let i = 0; i < 12; i++) replay.tick({ tMs: (now += 100), landmarks: pose(110, 90), baselines: BASELINE });
    assert.equal(replay.context.holdHintStateRef.current.left.shown, "lower", "the left arm above the band: lower");
    assert.equal(replay.context.holdHintStateRef.current.right.shown, null, "the right arm in the band: none");
    assert.equal(replay.context.setHoldStateOutput?.leftHint, "lower", "the hold display receives it");
    for (let i = 0; i < 12; i++) replay.tick({ tMs: (now += 100), landmarks: pose(110, 70), baselines: BASELINE });
    assert.equal(replay.context.holdHintStateRef.current.right.shown, "raise", "the right arm below the band: raise");
    replay.context.armUnsteadyAtMsRef.current.leftArm = now;
    replay.tick({ tMs: (now += 100), landmarks: pose(110, 70), baselines: BASELINE });
    assert.equal(replay.context.holdHintStateRef.current.left.shown, null, "held back while the left arm is unsteady");
  });

  // Review, 2026-10-25: the hint was worked out on every frame, so lowered arms during the rest between
  // sets got "raise", drawn above the rest screen.
  await test("the arm hold shows no hint while resting, and the wait starts over when the hold resumes", async () => {
    const replay = createCameraReplay(hold, await captureCoachingProvenance(hold));
    replay.context.sessionStateRef.current = "resting";
    let now = 1000;
    for (let i = 0; i < 30; i++) replay.tick({ tMs: (now += 100), landmarks: pose(10, 10), baselines: BASELINE });
    assert.equal(replay.context.setHoldStateOutput.leftHint, null, "no hint for the lowered left arm while resting");
    assert.equal(replay.context.setHoldStateOutput.rightHint, null, "nor for the right");
    replay.context.sessionStateRef.current = "active";
    replay.tick({ tMs: (now += 100), landmarks: pose(10, 10), baselines: BASELINE });
    assert.equal(replay.context.holdHintStateRef.current.left.shown, null, "not at once when the hold resumes");
    for (let i = 0; i < 6; i++) replay.tick({ tMs: (now += 100), landmarks: pose(10, 10), baselines: BASELINE });
    assert.equal(replay.context.setHoldStateOutput.leftHint, null, "still quiet before either arm starts counting");
    for (let i = 0; i < 4; i++) replay.tick({ tMs: (now += 100), landmarks: pose(90, 10), baselines: BASELINE });
    assert(replay.context.leftHoldMsRef.current > 0, "the left arm actually earns hold time");
    for (let i = 0; i < 7; i++) replay.tick({ tMs: (now += 100), landmarks: pose(10, 10), baselines: BASELINE });
    assert.equal(replay.context.setHoldStateOutput.leftHint, "raise", "after first credit and the wait, the lowered arm is told to raise");
  });

  // The user, after the live check (2026-10-25): with both arms prescribed, a cue to raise the arm left down.
  const RAISE = OVERLAY_LABELS.otherArmDown!;

  await test("with both arms prescribed, an arm left down while the other is held gets 'Raise this arm' after about a second", async () => {
    const replay = createCameraReplay(hold, await captureCoachingProvenance(hold), { prescribedSide: "both" });
    let now = 1000;
    const start = now + 100;
    for (let i = 0; i < 20; i++) replay.tick({ tMs: (now += 100), landmarks: pose(90, 10), baselines: BASELINE });
    const first = replay.frames.find((f: any) => f.renderedTexts.includes(RAISE));
    assert(first, "drawn");
    const after = first.tMs - start;
    assert(after >= 900 && after <= 1400, `about a second after the arm stayed down: ${after} ms`);
    assert.equal(replay.context.lastDrawnCueRef.current?.direction, "right", "at the lowered (right) arm");
    for (let i = 0; i < 15; i++) replay.tick({ tMs: (now += 100), landmarks: pose(90, 90), baselines: BASELINE });
    assert(!replay.frames.at(-1).renderedTexts.includes(RAISE), "gone once the arm is up");
  });

  await test("after first credit both lowered arms get height guidance, but an unprescribed arm and rest do not", async () => {
    const bothDown = createCameraReplay(hold, await captureCoachingProvenance(hold), { prescribedSide: "both" });
    let now = 1000;
    for (let i = 0; i < 25; i++) bothDown.tick({ tMs: (now += 100), landmarks: pose(10, 10), baselines: BASELINE });
    assert(bothDown.frames.every((f: any) => !f.renderedTexts.includes(RAISE)), "quiet before the set earns credit");
    for (let i = 0; i < 4; i++) bothDown.tick({ tMs: (now += 100), landmarks: pose(90, 10), baselines: BASELINE });
    assert(bothDown.context.leftHoldMsRef.current > 0, "one arm starts the set");
    for (let i = 0; i < 25; i++) bothDown.tick({ tMs: (now += 100), landmarks: pose(10, 10), baselines: BASELINE });
    assert(bothDown.frames.at(-1).renderedTexts.includes(RAISE), "active bilateral hold guides both lowered arms after first credit");
    assert.equal(bothDown.context.setHoldStateOutput.leftHint, "raise", "the panel's hint still says raise");
    const leftOnly = createCameraReplay(hold, await captureCoachingProvenance(hold), { prescribedSide: "left" });
    now = 1000;
    for (let i = 0; i < 25; i++) leftOnly.tick({ tMs: (now += 100), landmarks: pose(90, 10), baselines: BASELINE });
    assert(leftOnly.frames.every((f: any) => !f.renderedTexts.includes(RAISE)), "a left-only hold");
    const resting = createCameraReplay(hold, await captureCoachingProvenance(hold), { prescribedSide: "both" });
    resting.context.sessionStateRef.current = "resting";
    now = 1000;
    for (let i = 0; i < 25; i++) resting.tick({ tMs: (now += 100), landmarks: pose(90, 10), baselines: BASELINE });
    assert(resting.frames.every((f: any) => !f.renderedTexts.includes(RAISE)), "between sets");
  });

  // Exercise the actual readiness caller, rather than the historical-trace
  // fixture that accepts every frame. Bilateral means either wrist matters.
  const framedPose = (left: number, right: number) => {
    const lm = pose(left, right);
    lm[0] = { x: 0.5, y: 0.2, z: 0, visibility: 1 };
    lm[25] = { x: 0.6, y: 0.88, z: 0, visibility: 1 };
    lm[26] = { x: 0.4, y: 0.88, z: 0, visibility: 1 };
    return lm;
  };
  await test("a bilateral hold rejects either hidden wrist through the real camera readiness caller", async () => {
    for (const [index, side] of [[15, "left"], [16, "right"]] as const) {
      const replay = createCameraReplay(hold, await captureCoachingProvenance(hold), { prescribedSide: "both" });
      replay.context.evaluateCaptureReadiness = evaluateCaptureReadiness;
      const lm = framedPose(90, 90);
      replay.tick({ tMs: 1000, landmarks: lm, baselines: BASELINE });
      const before = [replay.context.leftHoldMsRef.current, replay.context.rightHoldMsRef.current];
      lm[index].visibility = 0.2;
      replay.tick({ tMs: 1100, landmarks: lm, baselines: BASELINE });
      assert.equal(replay.context.lastCaptureOkRef.current, false, `${side} wrist is required`);
      assert(replay.context.setCaptureMessageOutput.includes(`${side} hand`), "names the missing hand");
      assert.deepEqual([replay.context.leftHoldMsRef.current, replay.context.rightHoldMsRef.current], before,
        "neither hold timer credits a rejected frame");
    }
  });
  await test("unilateral raises still ignore the unprescribed hand through the real readiness caller", async () => {
    for (const [side, hidden] of [["left", 16], ["right", 15]] as const) {
      const replay = createCameraReplay(raise, await captureCoachingProvenance(raise), { prescribedSide: side });
      replay.context.evaluateCaptureReadiness = evaluateCaptureReadiness;
      const lm = framedPose(90, 90);
      lm[hidden].visibility = 0.2;
      for (let i = 0; i < 10; i++) replay.tick({ tMs: 1000 + 100 * i, landmarks: lm, baselines: BASELINE });
      assert.equal(replay.context.lastCaptureOkRef.current, true, `${side}: observation hand is optional`);
    }
  });
  await test("a visible lowered arm gets the cue on either side with the real bilateral readiness check", async () => {
    for (const side of ["left", "right"] as const) {
      const replay = createCameraReplay(hold, await captureCoachingProvenance(hold), { prescribedSide: "both" });
      replay.context.evaluateCaptureReadiness = evaluateCaptureReadiness;
      for (let i = 0; i < 30; i++) replay.tick({ tMs: 1000 + 100 * i,
        landmarks: framedPose(side === "left" ? 10 : 90, side === "right" ? 10 : 90), baselines: BASELINE });
      assert(replay.frames.some((f: any) => f.renderedTexts.includes(RAISE)), `${side}: the cue is drawn`);
      assert.equal(replay.context.lastDrawnCueRef.current?.direction, side, "the lowered arm is named");
    }
  });

  // Review of the new cue, 2026-10-25: each arm's hold time accrues on its own, so an arm that has reached
  // its hold may rest while the other finishes; and a cue whose arm turns unsteady lingered for its minimum
  // visible time.
  await test("an arm that has reached its hold rests without 'Raise this arm'; the arm still owing time gets it", async () => {
    const replay = createCameraReplay(hold, await captureCoachingProvenance(hold), { prescribedSide: "both" });
    replay.context.leftHoldMsRef.current = 31_000; // past the 30 s hold
    let now = 1000;
    for (let i = 0; i < 25; i++) replay.tick({ tMs: (now += 100), landmarks: pose(10, 90), baselines: BASELINE });
    assert(replay.frames.every((f: any) => !f.renderedTexts.includes(RAISE)), "the finished left arm rests");
    for (let i = 0; i < 20; i++) replay.tick({ tMs: (now += 100), landmarks: pose(90, 10), baselines: BASELINE });
    assert(replay.frames.at(-1).renderedTexts.includes(RAISE), "the right arm, still owing time, is cued");
    assert.equal(replay.context.lastDrawnCueRef.current?.direction, "right");
  });

  await test("'Raise this arm' goes at once when an arm's tracking turns unsteady", async () => {
    const replay = createCameraReplay(hold, await captureCoachingProvenance(hold), { prescribedSide: "both" });
    let now = 1000;
    for (let i = 0; i < 16; i++) replay.tick({ tMs: (now += 100), landmarks: pose(90, 10), baselines: BASELINE });
    assert(replay.frames.at(-1).renderedTexts.includes(RAISE), "drawn first");
    replay.context.armUnsteadyAtMsRef.current.rightArm = now + 100;
    const next = replay.tick({ tMs: (now += 100), landmarks: pose(90, 10), baselines: BASELINE });
    assert(!next.renderedTexts.includes(RAISE), "not drawn on the next frame");
    assert.notEqual(replay.context.lastDrawnCueRef.current?.metric, "otherArmDown", "nor kept as the last drawn cue");
  });

  // Review, 2026-10-25: drawn first, the lower-priority height cue kept the slot for the selector's 1.5 s
  // and "Straighten arms" was never drawn.
  await test("'Straighten arms' takes the slot from the past-shoulder-height cue as soon as the elbow bends", async () => {
    const run = async (definition: any) => {
      const replay = createCameraReplay(definition, await captureCoachingProvenance(definition), { prescribedSide: "right" });
      let now = 1000;
      const schedule = [
        ...Array.from({ length: 6 }, () => [0, 0]), // hanging
        ...Array.from({ length: 8 }, () => [150, 0]), // past shoulder height, elbow straight
        ...Array.from({ length: 5 }, () => [150, 70]), // still up, elbow bent
        [90, 0], [20, 0], [0, 0], [0, 0], [0, 0],
      ];
      for (const [angle, bend] of schedule) replay.tick({ tMs: (now += 100), landmarks: pose(0, angle, bend), baselines: BASELINE });
      return replay;
    };
    const withHeight = await run(raise);
    const withoutHeight = await run({ ...raise, coachingChecks: raise.coachingChecks!.filter((c) => c.name !== "overRaise") });
    const drawn = (replay: any, label: string) => replay.frames.filter((f: any) => f.renderedTexts.includes(label)).length;
    const STRAIGHTEN = OVERLAY_LABELS.elbowBend!;
    assert(drawn(withHeight, STOP) > 0, "the height cue is drawn first");
    assert(drawn(withoutHeight, STRAIGHTEN) > 0, "without the height check, the bend draws Straighten arms");
    assert.equal(drawn(withHeight, STRAIGHTEN), drawn(withoutHeight, STRAIGHTEN), "with it, on as many frames");
    for (const replay of [withHeight, withoutHeight]) {
      assert.equal(replay.emitted.filter((r: any) => r.side === "right").length, 1, "one right-arm repetition");
    }
  });

  await test("no person found in a dark picture names the light; in an ordinary picture the message is unchanged", async () => {
    const replay = createCameraReplay(raise, await captureCoachingProvenance(raise));
    replay.context.pictureLumaRef.current = 20;
    replay.context.lastLumaSampleMsRef.current = Infinity; // keep the set brightness: replays have no video frame
    replay.tick({ tMs: 1000, noPerson: true });
    assert.equal(replay.context.setCaptureMessageOutput, DARK_PICTURE_MESSAGE);
    replay.context.pictureLumaRef.current = 90;
    replay.tick({ tMs: 1100, noPerson: true });
    assert.equal(replay.context.setCaptureMessageOutput, "No person detected. Step into the frame.");
  });

  // Rehearsal session 246 (2026-10-28): at a laptop's distance the reading ran at a third to a half of the turn, and
  // the deep part of each turn hid a hand or the knees, where the knee message told the patient to step back.
  await test("a body turned 15 degrees or more for half a second shows the turn message; a hidden hand or hidden knees then get it too", async () => {
    const replay = createCameraReplay(raise, await captureCoachingProvenance(raise));
    let turn = 20; // under the earlier line of 25
    replay.context.landmarkerRef.current = { detectForVideo: () => ({ landmarks: [pose(0, 0)], worldLandmarks: [turnedWorld(turn)] }) };
    let now = 1000;
    for (let i = 0; i < 4; i++) replay.tick({ tMs: (now += 100), baselines: BASELINE });
    assert.equal(replay.context.turnHintRef.current, false, "not before half a second");
    for (let i = 0; i < 3; i++) replay.tick({ tMs: (now += 100), baselines: BASELINE });
    assert.equal(replay.context.setTurnHintOutput, true, "shown after half a second");
    turn = 12;
    replay.tick({ tMs: (now += 100), baselines: BASELINE });
    assert.equal(replay.context.setTurnHintOutput, true, "kept above the off level");
    turn = 8;
    replay.tick({ tMs: (now += 100), baselines: BASELINE });
    assert.equal(replay.context.setTurnHintOutput, false, "gone once facing the camera");
    // A capture failure: the turn's message while turned, the readiness check's own message while facing.
    for (const [status, message] of [
      ["HANDS_NOT_VISIBLE", "Show your left hand to the camera."],
      ["KNEES_NOT_VISIBLE", "Your left knee is not visible. Step back slightly."],
    ] as const) {
      replay.context.evaluateCaptureReadiness = () => ({ ok: false, status, message });
      turn = 18;
      replay.tick({ tMs: (now += 100), baselines: BASELINE });
      assert.equal(replay.context.setCaptureMessageOutput, BODY_TURN_MESSAGE, `${status} while turned`);
      turn = 5;
      replay.tick({ tMs: (now += 100), baselines: BASELINE });
      assert.equal(replay.context.setCaptureMessageOutput, message, `${status} while facing`);
    }
  });

  await test("side bends never show the turn message", async () => {
    const bend = getExerciseDefinition("ex_005")!;
    const replay = createCameraReplay(bend, await captureCoachingProvenance(bend));
    replay.context.landmarkerRef.current = { detectForVideo: () => ({ landmarks: [pose(0, 0)], worldLandmarks: [turnedWorld(40)] }) };
    let now = 1000;
    for (let i = 0; i < 20; i++) replay.tick({ tMs: (now += 100), baselines: BASELINE });
    assert.equal(replay.context.turnHintRef.current, false);
  });

  await test("the arm-raise height cue clears after correcting to shoulder height without going down to rest", async () => {
    const replay = createCameraReplay(raise, await captureCoachingProvenance(raise), { prescribedSide: "left" });
    let now = 1000;
    for (let i = 0; i < 6; i++) replay.tick({ tMs: (now += 100), landmarks: pose(0, 0), baselines: BASELINE });
    for (let i = 0; i < 20; i++) replay.tick({ tMs: (now += 100), landmarks: pose(130, 0), baselines: BASELINE });
    assert(replay.frames.some((f: any) => f.renderedTexts.includes(STOP)), "warning drawn above shoulder height");
    for (let i = 0; i < 8; i++) replay.tick({ tMs: (now += 100), landmarks: pose(90, 0), baselines: BASELINE });
    assert(!replay.frames.at(-1).renderedTexts.includes(STOP), "no stale warning while corrected at shoulder height");
    assert.equal(replay.emitted.length, 0, "arm never returned to rest to end the repetition");
  });

  await test("a lowered hold arm is guided on either side even when the other arm is slightly below its band", async () => {
    for (const side of ["left", "right"] as const) {
      const replay = createCameraReplay(hold, await captureCoachingProvenance(hold), { prescribedSide: "both" });
      let now = 1000;
      for (let i = 0; i < 4; i++) replay.tick({ tMs: (now += 100), landmarks: pose(90, 90), baselines: BASELINE });
      assert(replay.context.leftHoldMsRef.current > 0, "the set has earned credit");
      for (let i = 0; i < 25; i++) replay.tick({ tMs: (now += 100), landmarks: side === "right" ? pose(75, 10) : pose(10, 75), baselines: BASELINE });
      assert(replay.frames.at(-1).renderedTexts.includes(RAISE), `${side} arm is guided`);
      assert.equal(replay.context.lastDrawnCueRef.current?.direction, side, "at the lower arm");
    }
  });

  await test("a hold arm above its band gets a lower-to-shoulder-height cue on either side and clears when corrected", async () => {
    for (const side of ["left", "right"] as const) {
      const replay = createCameraReplay(hold, await captureCoachingProvenance(hold), { prescribedSide: "both" });
      let now = 1000;
      for (let i = 0; i < 25; i++) replay.tick({ tMs: (now += 100), landmarks: side === "right" ? pose(90, 115) : pose(115, 90), baselines: BASELINE });
      assert(replay.frames.at(-1).renderedTexts.includes("Lower to shoulder height"), `${side} arm is guided down`);
      assert.equal(replay.context.lastDrawnCueRef.current?.direction, side, "at the higher arm");
      replay.tick({ tMs: (now += 100), landmarks: pose(90, 90), baselines: BASELINE });
      assert(!replay.frames.at(-1).renderedTexts.includes("Lower to shoulder height"), "corrected hold reading clears the cue immediately");
    }
  });

  await test("hold-height cues and hints wait for actual credit, then either first arm enables independent guidance", async () => {
    for (const angle of [10, 115]) {
      const fresh = createCameraReplay(hold, await captureCoachingProvenance(hold), { prescribedSide: "both" });
      let now = 1000;
      for (let i = 0; i < 25; i++) fresh.tick({ tMs: (now += 100), landmarks: pose(angle, angle), baselines: BASELINE });
      assert.equal(fresh.context.leftHoldMsRef.current, 0);
      assert.equal(fresh.context.rightHoldMsRef.current, 0);
      assert(fresh.frames.every((f: any) => !f.renderedTexts.includes(RAISE) && !f.renderedTexts.includes("Lower to shoulder height")), "no height cue before either arm counts");
      assert.equal(fresh.context.holdHintStateRef.current.left.shown, null, "nor a left-arm hint");
      assert.equal(fresh.context.holdHintStateRef.current.right.shown, null, "nor a right-arm hint");
    }
    for (const first of ["left", "right"] as const) {
      const replay = createCameraReplay(hold, await captureCoachingProvenance(hold), { prescribedSide: "both" });
      let now = 1000;
      for (let i = 0; i < 4; i++) replay.tick({ tMs: (now += 100), landmarks: first === "left" ? pose(90, 10) : pose(10, 90), baselines: BASELINE });
      const other = first === "left" ? "right" : "left";
      assert(replay.context[`${first}HoldMsRef`].current > 0 && replay.context[`${first}HoldMsRef`].current < 1000, "subsecond credit from one arm is enough");
      assert.equal(replay.context.pairedHoldMsRef.current, 0, "simultaneous credit is not needed");
      assert.equal(replay.context[`${other}HoldMsRef`].current, 0, "the other arm never counted");
      for (let i = 0; i < 20; i++) replay.tick({ tMs: (now += 100), landmarks: first === "left" ? pose(75, 10) : pose(10, 75), baselines: BASELINE });
      assert(replay.frames.at(-1).renderedTexts.includes(RAISE), "guidance remains enabled even with both arms now below the band");
      assert.equal(replay.context.lastDrawnCueRef.current?.direction, other, "at the arm furthest below the band");
    }
  });

  // The review of 2026-10-28: with both arms down after first credit, the cue re-chose the arm furthest below on
  // every frame, so about a degree of reading noise moved it from arm to arm.
  await test("two arms lowered about equally far after first credit keep 'Raise this arm' on one arm", async () => {
    const replay = createCameraReplay(hold, await captureCoachingProvenance(hold), { prescribedSide: "both" });
    let now = 1000;
    for (let i = 0; i < 4; i++) replay.tick({ tMs: (now += 100), landmarks: pose(90, 90), baselines: BASELINE });
    assert(replay.context.leftHoldMsRef.current > 0, "the set has earned credit");
    const sides: string[] = [];
    for (let i = 0; i < 40; i++) {
      replay.tick({ tMs: (now += 100), landmarks: i % 2 === 0 ? pose(10, 11) : pose(11, 10), baselines: BASELINE });
      if (replay.frames.at(-1).renderedTexts.includes(RAISE)) sides.push(replay.context.lastDrawnCueRef.current?.direction);
    }
    assert(sides.length >= 20, `drawn for most of the 4 s: ${sides.length} frames`);
    assert.equal(new Set(sides).size, 1, `one arm throughout: ${sides.join(" ")}`);
    const raisedFirst = sides[0] === "left" ? pose(90, 10) : pose(10, 90);
    for (let i = 0; i < 15; i++) replay.tick({ tMs: (now += 100), landmarks: raisedFirst, baselines: BASELINE });
    assert(replay.frames.at(-1).renderedTexts.includes(RAISE), "still guided once that arm is up");
    assert.notEqual(replay.context.lastDrawnCueRef.current?.direction, sides[0], "now at the other arm");
  });

  // Rehearsal session 246 (2026-10-28): with one arm down, the raised side's shoulder sat higher, so LOWER latched
  // behind "Raise this arm". The shoulders levelled as the arm came up, and when "Raise this arm" went, LOWER took the
  // slot with its reading already back under its switch-off level, then stayed for its minimum visible time.
  /** `pose`, with the left shoulder and arm raised and the right shoulder and arm lowered by `lift` (picture heights). */
  const tiltedPose = (left: number, right: number, lift: number) => {
    const lm = pose(left, right);
    for (const [i, dy] of [[11, -lift], [13, -lift], [15, -lift], [12, lift], [14, lift], [16, lift]]) lm[i].y += dy;
    return lm;
  };
  await test("LOWER latched behind 'Raise this arm' is not drawn once the shoulders are level again, and is while they stay uneven", async () => {
    for (const levelled of [true, false]) {
      const replay = createCameraReplay(hold, await captureCoachingProvenance(hold), { prescribedSide: "both" });
      let now = 1000;
      for (let i = 0; i < 4; i++) replay.tick({ tMs: (now += 100), landmarks: pose(90, 90), baselines: BASELINE });
      for (let i = 0; i < 25; i++) replay.tick({ tMs: (now += 100), landmarks: tiltedPose(90, 10, 0.025), baselines: BASELINE });
      assert(replay.frames.at(-1).renderedTexts.includes(RAISE), "'Raise this arm' at the lowered arm");
      assert.equal(replay.context.compensationWarningLatchesRef.current.get("shoulderSymmetry")?.active, true, "LOWER latched behind it");
      const from = replay.frames.length;
      const lift = levelled ? 0 : 0.025;
      for (const right of [60, 75]) replay.tick({ tMs: (now += 100), landmarks: tiltedPose(90, right, lift), baselines: BASELINE });
      for (let i = 0; i < 12; i++) replay.tick({ tMs: (now += 100), landmarks: tiltedPose(90, 90, lift), baselines: BASELINE });
      const after = replay.frames.slice(from);
      assert(!after.at(-1).renderedTexts.includes(RAISE), "'Raise this arm' has gone");
      if (levelled) assert(after.every((f: any) => !f.renderedTexts.includes("LOWER")), "no LOWER for shoulders already level");
      else assert(after.some((f: any) => f.renderedTexts.includes("LOWER")), "LOWER for shoulders still uneven");
    }
  });

  await test("a new set must earn its own first credit, while restored in-set credit enables guidance", async () => {
    const replay = createCameraReplay(hold, await captureCoachingProvenance(hold), { prescribedSide: "both" });
    let now = 1000;
    for (let i = 0; i < 20; i++) replay.tick({ tMs: (now += 100), landmarks: pose(90, 10), baselines: BASELINE });
    assert(replay.frames.at(-1).renderedTexts.includes(RAISE), "guidance began in the first set");
    // Zero the per-set accumulators as set completion does. Leave the old
    // warnings present: the closed gate must clear them through the callback.
    replay.context.leftHoldMsRef.current = 0;
    replay.context.rightHoldMsRef.current = 0;
    replay.context.pairedHoldMsRef.current = 0;
    replay.context.lastIsometricTickMsRef.current = null;
    for (let i = 0; i < 25; i++) replay.tick({ tMs: (now += 100), landmarks: pose(10, 10), baselines: BASELINE });
    assert(!replay.frames.at(-1).renderedTexts.includes(RAISE), "the previous set cannot arm this one");
    assert.equal(replay.context.holdHintStateRef.current.left.shown, null, "the hint also waits for fresh credit");
    replay.context.leftHoldMsRef.current = 100; // a partial set restored by Resume
    for (let i = 0; i < 20; i++) replay.tick({ tMs: (now += 100), landmarks: pose(75, 10), baselines: BASELINE });
    assert(replay.frames.at(-1).renderedTexts.includes(RAISE), "restored progress arms the current set");
    assert.equal(replay.context.lastDrawnCueRef.current?.direction, "right");
    assert.equal(replay.context.leftHoldMsRef.current, 100, "display gating changes no earned credit");
    assert.equal(replay.context.rightHoldMsRef.current, 0);
  });

  await test("an observation-only arm cannot start a unilateral hold's height hints", async () => {
    const replay = createCameraReplay(hold, await captureCoachingProvenance(hold), { prescribedSide: "left" });
    let now = 1000;
    for (let i = 0; i < 25; i++) replay.tick({ tMs: (now += 100), landmarks: pose(10, 90), baselines: BASELINE });
    assert(replay.context.rightHoldMsRef.current > 0, "the observation arm has time");
    assert.equal(replay.context.leftHoldMsRef.current, 0, "the prescribed arm has not begun");
    assert.equal(replay.context.holdHintStateRef.current.left.shown, null, "observation credit cannot enable the prescribed arm's hint");
  });

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
