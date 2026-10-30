/**
 * Tests for the display-only body-turn message (bodyTurn.ts) and its place in the coaching configuration.
 * Run with: npx tsx src/lib/pose/bodyTurn.test.ts
 */

import { EXERCISE_REGISTRY } from "../exercises/registry";
import {
  BODY_TURN_HOLD_MS,
  BODY_TURN_LINE_DEG,
  BODY_TURN_OFF_DEG,
  NO_BODY_TURN,
  bodyTurnApplies,
  hipLineTurnDeg,
  turnExplainsCaptureFailure,
  updateBodyTurn,
  type BodyTurnState,
} from "./bodyTurn";
import { coachingConfiguration, validCoachingProvenance } from "./coachingConfig";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`      ${error instanceof Error ? error.message : String(error)}`);
    failed += 1;
  }
}

function assertEq(actual: unknown, expected: unknown, label: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

/** World landmarks with the hip line turned `deg` from square (hips 0.2 m apart, as the pose model places them). */
function turnedWorld(deg: number) {
  const r = (deg * Math.PI) / 180;
  const world = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0 }));
  world[23] = { x: 0.1 * Math.cos(r), y: 0, z: 0.1 * Math.sin(r) };
  world[24] = { x: -0.1 * Math.cos(r), y: 0, z: -0.1 * Math.sin(r) };
  return world;
}

/** Feeds a turn reading every 100 ms and returns whether the message shows on each frame. */
function shown(readings: (number | null)[]) {
  let state: BodyTurnState = NO_BODY_TURN;
  return readings.map((deg, i) => {
    state = updateBodyTurn(state, deg, i * 100);
    return state.shown;
  });
}

console.log("\nbodyTurn - a body turned away from the camera\n");

test("the hip line's turn is read from the world landmarks, whichever way the body turns", () => {
  for (const deg of [0, 10, 25, 45, 80]) {
    const read = hipLineTurnDeg(turnedWorld(deg));
    if (read === null || Math.abs(read - deg) > 1e-9) throw new Error(`${deg}: read ${read}`);
    const other = hipLineTurnDeg(turnedWorld(-deg));
    if (other === null || Math.abs(other - deg) > 1e-9) throw new Error(`-${deg}: read ${other}`);
  }
  assertEq([hipLineTurnDeg(undefined), hipLineTurnDeg([]), hipLineTurnDeg(Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0 })))],
    [null, null, null], "no hips, or both at one point");
});

test(`the message shows after ${BODY_TURN_HOLD_MS} ms at or above ${BODY_TURN_LINE_DEG} and goes below ${BODY_TURN_OFF_DEG}`, () => {
  const frames = [20, 20, 20, 20, 20, 20, 12, 12, 9, 20];
  assertEq(shown(frames), [false, false, false, false, false, true, true, true, false, false],
    "on after half a second, kept down to the off level, gone below it, and a new turn waits again");
});

test("a dip under the line before the half second is up starts the wait again, and a frame without a reading keeps the state", () => {
  // 20 from 0 ms, a dip to 14 at 300 ms, 20 again from 400 ms: shown at 900 ms (frame 9), not at 500 ms.
  const frames = [20, 20, 20, 14, ...Array.from({ length: 8 }, () => 20)];
  assertEq(shown(frames).indexOf(true), 9, "half a second after the dip");
  assertEq(shown([20, 20, 20, 20, 20, 20, null, null]).slice(-3), [true, true, true], "kept through frames without a reading");
});

test("facing the camera, as 34 of the researcher's sessions read it (largest 17.5, at 15 or more for 320 ms at most), never shows the message", () => {
  // A run like session 244's longest (about 300 ms at 15-17) among readings of 8-13, then readings cycling 5-17.
  if (shown([8, 12, 15, 16.5, 17.1, 15.5, 12, 9, 13, 15, 17.5, 12, 6, 3]).some(Boolean)) throw new Error("shown on a short run at 15-17");
  if (shown(Array.from({ length: 40 }, (_, i) => 5 + (i % 13))).some(Boolean)) throw new Error("shown on readings cycling 5-17");
});

test(`a hidden hand, knees or hips with the reading at or above ${BODY_TURN_LINE_DEG} is put down to the turn; nothing else is`, () => {
  for (const status of ["HANDS_NOT_VISIBLE", "KNEES_NOT_VISIBLE", "HIPS_NOT_VISIBLE"] as const) {
    assertEq([turnExplainsCaptureFailure(status, BODY_TURN_LINE_DEG), turnExplainsCaptureFailure(status, 85)], [true, true], `${status} while turned`);
    assertEq([turnExplainsCaptureFailure(status, BODY_TURN_LINE_DEG - 0.1), turnExplainsCaptureFailure(status, null)], [false, false],
      `${status} while facing, or without a reading`);
  }
  for (const status of ["OK", "MOVE_CLOSER", "MOVE_BACK", "MOVE_LEFT", "MOVE_RIGHT", "MOVE_UP", "MOVE_DOWN", "LOW_CONFIDENCE", "NOT_VISIBLE", "HEAD_NOT_POSITIONED"] as const) {
    assertEq(turnExplainsCaptureFailure(status, 85), false, status);
  }
});

test("side bends are left out, every other exercise uses it, and the configuration records its settings", () => {
  for (const def of Object.values(EXERCISE_REGISTRY)) {
    const expected = !def.requiresLateralRoom;
    assertEq(bodyTurnApplies(def), expected, def.id);
    const configuration = coachingConfiguration(def);
    assertEq(configuration.position.bodyTurn, expected ? { lineDeg: 15, offDeg: 10, holdMs: 500 } : null, `${def.id} configuration`);
    if (!validCoachingProvenance({ version: `sha256:${"0".repeat(64)}`, configuration })) throw new Error(`${def.id}: the configuration must validate`);
  }
  if (bodyTurnApplies(EXERCISE_REGISTRY.ex_005)) throw new Error("side bends must be left out");
});

test("configurations recorded before the position settings still validate; a malformed one does not", () => {
  const version = `sha256:${"0".repeat(64)}`;
  const configuration = coachingConfiguration(EXERCISE_REGISTRY.ex_001);
  const older: Record<string, unknown> = { ...configuration };
  delete older.position;
  if (!validCoachingProvenance({ version, configuration: older as typeof configuration })) throw new Error("an older configuration must validate");
  const malformed = { ...configuration, position: { ...configuration.position, picture: { sampleMs: 500, darkLuma: -1, brightLuma: 70 } } };
  if (validCoachingProvenance({ version, configuration: malformed })) throw new Error("a malformed position block must fail");
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
