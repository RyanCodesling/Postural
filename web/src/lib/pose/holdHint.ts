/**
 * Which way an arm should move to get back into the arm hold's target band: a display-only hint.
 *
 * WHAT
 * Per arm, from its own hold reading (the same raw value the hold timer tests against the band): below the band,
 * "raise"; above it, "lower". The hint shows once the arm has stayed out on the same side for `HOLD_HINT_WAIT_MS`,
 * so an arm that grazes the band's edge does not flicker a hint, and it goes as soon as the arm is back in.
 *
 * WHY HELD BACK WHILE THE ARM IS UNSTEADY
 * When the camera keeps misplacing an arm's points, the reading moves with the misplacement, not with the arm. In
 * the evaluation server's session 3 a level left arm read a median of 98.9 above the 84.3-95.7 band while its wrist
 * point flickered, so a hint would have told the person to lower an arm that was already level. While the tracking
 * check finds that arm unsteady, the tracking message speaks instead and no hint is shown.
 *
 * Display only: no timer, completion rule or stored value depends on this.
 */

export type HoldHint = "raise" | "lower";

/** How long an arm must stay out of the band on one side before its hint shows. */
export const HOLD_HINT_WAIT_MS = 500;

export type HoldHintArmState = { direction: HoldHint | null; sinceMs: number | null; shown: HoldHint | null };
export type HoldHintState = { left: HoldHintArmState; right: HoldHintArmState };

const NONE: HoldHintArmState = { direction: null, sinceMs: null, shown: null };

export function newHoldHintState(): HoldHintState {
  return { left: { ...NONE }, right: { ...NONE } };
}

/** The way back into the band, or null when the arm is in it or has no reading. */
export function holdHintDirection(value: number | null, band: { lo: number; hi: number }): HoldHint | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value < band.lo ? "raise" : value > band.hi ? "lower" : null;
}

function updateArm(
  arm: HoldHintArmState,
  input: { value: number | null; unsteady: boolean },
  nowMs: number,
  band: { lo: number; hi: number },
): HoldHintArmState {
  const direction = input.unsteady ? null : holdHintDirection(input.value, band);
  if (direction === null) return { ...NONE };
  const sinceMs = arm.direction === direction && arm.sinceMs !== null ? arm.sinceMs : nowMs;
  return { direction, sinceMs, shown: nowMs - sinceMs >= HOLD_HINT_WAIT_MS ? direction : null };
}

/** One frame. Pure: the input state is not mutated. */
export function updateHoldHint(
  state: HoldHintState,
  input: {
    left: { value: number | null; unsteady: boolean };
    right: { value: number | null; unsteady: boolean };
    nowMs: number;
  },
  band: { lo: number; hi: number },
): HoldHintState {
  return {
    left: updateArm(state.left, input.left, input.nowMs, band),
    right: updateArm(state.right, input.right, input.nowMs, band),
  };
}
