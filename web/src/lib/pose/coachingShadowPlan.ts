/**
 * Minimal boundary shape needed to protect coaching-shadow capture exports.
 * The full session-step definition stays in CameraClient because it is UI-only.
 */
export type CoachingShadowPlanBoundary = {
  startsCapture?: boolean;
};

/**
 * Which capture a step belongs to: the number of capture starts at or before it.
 *
 * Steps sharing this number are segments of the same capture, so moving between
 * them does not put retained decisions at risk. Crossing to a different number
 * leaves the capture.
 */
function captureOrdinalOf(
  plan: readonly CoachingShadowPlanBoundary[],
  index: number,
): number {
  let ordinal = 0;
  for (let i = 0; i <= index && i < plan.length; i++) {
    if (plan[i]?.startsCapture === true) ordinal += 1;
  }
  return ordinal;
}

/**
 * Blocks LEAVING a capture while its retained decisions have not been exported.
 * Moving between labelled segments of the same capture remains allowed.
 *
 * DIRECTION-AGNOSTIC, and deliberately so. The original guard tested only
 * `plan[currentIndex + 1]`, which left the main panel's Back button and its
 * "plan complete" restart free to cross a capture boundary with the ring still
 * unexported — Back from the first step of a capture, and restart jumping over
 * every boundary at once. Both discard or mislabel staff-only research
 * evidence exactly as a forward step would. The invariant is about leaving a
 * capture, not about the direction of travel, so it is expressed that way here.
 */
export function shouldBlockCoachingShadowPlanTransition(
  plan: readonly CoachingShadowPlanBoundary[],
  currentIndex: number,
  targetIndex: number,
  recordCount: number,
  exported: boolean,
): boolean {
  if (recordCount <= 0 || exported) return false;
  // Leaving the plan entirely always leaves the capture.
  if (targetIndex < 0 || targetIndex >= plan.length) return true;
  return captureOrdinalOf(plan, targetIndex) !== captureOrdinalOf(plan, currentIndex);
}

/**
 * Forward-step convenience wrapper, retained as the original public shape.
 *
 * Equivalent to the general transition check with `targetIndex = currentIndex + 1`:
 * the capture ordinal changes on a forward step exactly when the next step
 * declares `startsCapture`, and running off the end of the plan leaves it.
 */
export function shouldBlockCoachingShadowPlanAdvance(
  plan: readonly CoachingShadowPlanBoundary[],
  currentIndex: number,
  recordCount: number,
  exported: boolean,
): boolean {
  return shouldBlockCoachingShadowPlanTransition(
    plan,
    currentIndex,
    currentIndex + 1,
    recordCount,
    exported,
  );
}
