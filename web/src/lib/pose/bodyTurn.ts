/**
 * A body turned away from the camera: a display-only position message.
 *
 * WHAT
 * The hip line's turn from square to the camera, in degrees, from MediaPipe's world landmarks (its 3D estimate in
 * metres, origin between the hips): atan2(|dz|, |dx|) between the two hips. 0 is square to the camera, 90 side-on.
 *
 * WHY
 * Against motion capture (REHAB24-6 exercise 1, 8 people, 28,622 frames including the turns between blocks, filmed at
 * about 5 m) this reading followed the true hip turn within 3.3 degrees on average (correlation 0.98). Turns of 10-20
 * read about 5, so a slight turn is not detected, and it does not need to be: arm-raise accuracy was the same facing
 * 0-5 and 5-11 degrees off square. Turned about 45 degrees, the far arm's points jumped constantly, its hand was hidden
 * (capture paused with "Show your ... hand to the camera."), and the elbow check misfired on straight arms.
 * At a laptop's distance the reading runs lower. In the rehearsal of 2026-10-28 (session 246, two turns of about 65
 * and 85 degrees) it read 14.7 at about 45 degrees and reached 25 only at about 40-57, judged from the shoulders'
 * width in the picture. The deep part of each turn hid a hand or the knees, and capture refused those frames, so the
 * first rule (25, held 1 s) showed the message only as the patient turned back. A refusal of 300 ms or more also
 * restarts a hold's time.
 * Facing the camera at 2-3 m, 34 of the researcher's traced arm and neck sessions (33,053 frames, 44 minutes) read 15
 * or more on 0.061% of frames and never for longer than 320 ms (largest 17.5). A line of 15 held for 0.5 s never
 * showed there, and neither did 12. Side bends move the hips (25 or more on 0.7% of frames), so they are left out
 * until checked.
 *
 * WHEN
 * The message shows once the reading has stayed at or above `BODY_TURN_LINE_DEG` for `BODY_TURN_HOLD_MS`, and goes
 * when it falls below `BODY_TURN_OFF_DEG`. A capture failure that a turn causes shows the message instead of the
 * check's own ("Show your ... hand", "... knee is not visible. Step back slightly.") whenever the current reading is at
 * or above the line, since the turn is then the likely cause (`turnExplainsCaptureFailure`).
 *
 * Display only: never scored, never stored as a measurement, and never pauses an exercise.
 */
import type { ExerciseDefinition } from "@/lib/exercises/registry";
import type { ReadinessStatus } from "./captureReadiness";

export const BODY_TURN_LINE_DEG = 15;
/** Below this the message goes; the gap to the line keeps it from flickering at the line. */
export const BODY_TURN_OFF_DEG = 10;
export const BODY_TURN_HOLD_MS = 500;
export const BODY_TURN_MESSAGE = "Turn to face the camera.";

/**
 * Capture failures a turn causes: the far hand hidden behind the body, or one knee behind the other. Hips are checked
 * only on side bends, which have no turn reading yet.
 */
const TURN_CAPTURE_FAILURES: ReadonlySet<ReadinessStatus> = new Set(["HANDS_NOT_VISIBLE", "KNEES_NOT_VISIBLE", "HIPS_NOT_VISIBLE"]);

/** Whether a capture failure is put down to the turn: one a turn causes, with the current reading at or above the line. */
export function turnExplainsCaptureFailure(status: ReadinessStatus, turnDeg: number | null): boolean {
  return turnDeg !== null && turnDeg >= BODY_TURN_LINE_DEG && TURN_CAPTURE_FAILURES.has(status);
}

type WorldPoint = { x: number; y: number; z: number };

/** The hip line's turn from square, in degrees, or null without both hips. */
export function hipLineTurnDeg(world: ArrayLike<WorldPoint> | null | undefined): number | null {
  const l = world?.[23];
  const r = world?.[24];
  if (!l || !r) return null;
  const dx = l.x - r.x;
  const dz = l.z - r.z;
  if (!Number.isFinite(dx) || !Number.isFinite(dz) || (dx === 0 && dz === 0)) return null;
  return (Math.atan2(Math.abs(dz), Math.abs(dx)) * 180) / Math.PI;
}

/** Side bends move the hips sideways and turn them, so the message is not used there yet. */
export function bodyTurnApplies(definition: ExerciseDefinition | null | undefined): boolean {
  return !!definition && !definition.requiresLateralRoom;
}

export type BodyTurnState = { overSinceMs: number | null; shown: boolean };

export const NO_BODY_TURN: BodyTurnState = { overSinceMs: null, shown: false };

/** One frame. A frame without a reading keeps the current state. Pure. */
export function updateBodyTurn(state: BodyTurnState, turnDeg: number | null, nowMs: number): BodyTurnState {
  if (turnDeg === null) return state;
  if (turnDeg >= BODY_TURN_LINE_DEG) {
    const overSinceMs = state.overSinceMs ?? nowMs;
    return { overSinceMs, shown: state.shown || nowMs - overSinceMs >= BODY_TURN_HOLD_MS };
  }
  if (state.shown && turnDeg >= BODY_TURN_OFF_DEG) return { overSinceMs: null, shown: true };
  return NO_BODY_TURN;
}
