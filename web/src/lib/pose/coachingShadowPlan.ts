/**
 * Minimal boundary shape needed to protect coaching-shadow capture exports.
 * The full session-step definition stays in CameraClient because it is UI-only.
 */
export type CoachingShadowPlanBoundary = {
  startsCapture?: boolean;
};

/**
 * Blocks leaving a capture while its retained decisions have not been exported.
 * Moving between labelled segments of the same capture remains allowed.
 */
export function shouldBlockCoachingShadowPlanAdvance(
  plan: readonly CoachingShadowPlanBoundary[],
  currentIndex: number,
  recordCount: number,
  exported: boolean,
): boolean {
  if (recordCount <= 0 || exported) return false;
  const nextStep = plan[currentIndex + 1];
  return nextStep === undefined || nextStep.startsCapture === true;
}
