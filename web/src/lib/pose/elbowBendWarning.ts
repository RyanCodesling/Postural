/**
 * Clearly bent elbows with the arm raised: a display-only coaching check.
 *
 * WHAT
 * Each arm's elbow angle on the image: the interior angle between the upper arm
 * and the forearm, 180 when straight (`computeElbowFlexion`, the reading the
 * tuning trace stores as `elbowFlexionDeg`). The cue's line is a level BELOW
 * which the elbow counts as clearly bent, so the check warns on `below`.
 *
 * WHY
 * Exercise instructions for raising the arm to the side ask for a straight
 * elbow. Three points on a straight line stay on a straight line in any camera
 * view, so a straight arm reads close to 180 whatever the camera angle, apart
 * from tracking noise and an arm pointing at the camera. A bend toward or away
 * from the camera reads smaller than it is, so the check can miss a bend
 * rather than cue a straight arm.
 *
 * WHEN
 * An arm is judged while its own primary (how far the arm is raised) is at
 * least `from`. Only the prescribed arms count; with both judged, the warning is
 * the more bent arm, with its side.
 *   - hold "repetition" (dynamic exercises): an angle that stays below the line
 *     for `persistMs` flags the arm, and its smallest angle is held as the
 *     warning until the arm is back below `restBelow`, the repetition start.
 *     Before a flag the live angle passes through while the arm is judged.
 *   - hold "live" (holds): the live angle passes through while the arm is
 *     judged. The warning latch's debounce gives the persistence, and the cue
 *     clears once the arm is straightened.
 * A frame that is not judged (no reading, or the arm below `from`) ends a run
 * that has not yet lasted `persistMs`; a flag already confirmed is kept.
 *
 * Display only: never scored, never stored as a measurement, and outside the
 * measurement version.
 */

export type ElbowBendCheck = {
  /** Primary level (the arm's own raise reading) from which an arm is judged. */
  from: number;
  /** How long the angle must stay below the line to flag ("repetition"). */
  persistMs: number;
  hold: "repetition" | "live";
  /** Primary below which the arm is at rest and a flag ends ("repetition"). */
  restBelow: number;
};

export type ElbowBendArmState = {
  /** Smallest flagged angle of the current repetition, or null. */
  heldValue: number | null;
  /** Start of the present run below the line, or null. */
  underSinceMs: number | null;
};

export type ElbowBendState = { left: ElbowBendArmState; right: ElbowBendArmState };

/** One arm in one frame: its raise reading and its elbow angle. */
export type ElbowBendArm = { primary: number | null; elbow: number | null };

const AT_REST: ElbowBendArmState = { heldValue: null, underSinceMs: null };

export function newElbowBendState(): ElbowBendState {
  return { left: { ...AT_REST }, right: { ...AT_REST } };
}

const finite = (value: number | null): value is number =>
  typeof value === "number" && Number.isFinite(value);

function updateArm(
  arm: ElbowBendArmState,
  input: ElbowBendArm,
  nowMs: number,
  check: ElbowBendCheck,
  level: number,
): { state: ElbowBendArmState; value: number | null } {
  const { primary, elbow } = input;
  if (check.hold === "live") {
    const judged = finite(primary) && primary >= check.from && finite(elbow);
    return { state: { ...AT_REST }, value: judged ? elbow : null };
  }
  // Back at rest: the repetition is over.
  if (finite(primary) && primary < check.restBelow) return { state: { ...AT_REST }, value: null };
  // Not judged: no reading, or the arm below `from`. It breaks a pending run;
  // a flagged repetition keeps its warning.
  if (!finite(primary) || !finite(elbow) || primary < check.from) {
    return { state: { heldValue: arm.heldValue, underSinceMs: null }, value: arm.heldValue };
  }
  let { heldValue, underSinceMs } = arm;
  if (elbow < level) {
    underSinceMs ??= nowMs;
    if (nowMs - underSinceMs >= check.persistMs) heldValue = Math.min(heldValue ?? Infinity, elbow);
  } else {
    underSinceMs = null;
  }
  return { state: { heldValue, underSinceMs }, value: heldValue ?? elbow };
}

/** One frame. Pure: the input state is not mutated. */
export function updateElbowBend(
  state: ElbowBendState,
  input: {
    left: ElbowBendArm;
    right: ElbowBendArm;
    /** The prescribed arms; only these can raise the warning. */
    sides: readonly ("left" | "right")[];
    nowMs: number;
  },
  check: ElbowBendCheck,
  level: number,
): { state: ElbowBendState; value: number | null; side: "left" | "right" | null } {
  const left = updateArm(state.left, input.left, input.nowMs, check, level);
  const right = updateArm(state.right, input.right, input.nowMs, check, level);
  let value: number | null = null;
  let side: "left" | "right" | null = null;
  for (const s of input.sides) {
    const v = s === "left" ? left.value : right.value;
    if (v !== null && (value === null || v < value)) {
      value = v;
      side = s;
    }
  }
  return { state: { left: left.state, right: right.state }, value, side };
}
