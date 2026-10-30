/**
 * The trunk-lean cue ("Keep your torso upright.") judges the trunk against its
 * own resting line, taken in the neutral calibration, instead of the camera
 * tilt frozen there (D-65), as the LOWER cue does for the shoulders (D-47).
 *
 * The lean is the hip-midpoint-to-shoulder-midpoint line's angle from vertical
 * after removing the frozen camera tilt, which comes from the hip and ear
 * lines. Whatever angle the still trunk makes with that reference at
 * calibration stays in every reading until the next calibration, so a lean
 * reaches the cue's line that much early on one side and late on the other.
 * Measured from the resting trunk line, a still trunk reads 0 and only a change
 * from it counts.
 *
 * Display only: the compensation score, the stored raw features, the trend
 * measures and the measurement versions keep the frozen-tilt reading. The
 * coaching configuration records this reference (`trunkLeanReference`).
 */
import { medianFinite } from "./neutralCalibration";
import { computeTrunkLateralLean, trunkLineAngleDeg, type TrunkLeanResult } from "./poseMetrics";
import type { RestSample } from "./shoulderRestReference";

/** How the trunk-lean cue's reading is referenced (coaching configuration). */
export const TRUNK_LEAN_CUE_REFERENCE = "resting_trunk_line_v1" as const;

type Landmarks = Parameters<typeof trunkLineAngleDeg>[0];

/** The resting trunk line: the median trunk line over the calibration's samples, or null. */
export function restingTrunkLineDeg(samples: readonly RestSample[]): number | null {
  return medianFinite(
    samples
      .map((sample) => trunkLineAngleDeg(sample.landmarks, sample.frameAspect))
      .filter((v): v is number => v !== null),
  );
}

/**
 * The cue's lean reading: the trunk line against the resting line, in the same
 * form as `computeTrunkLateralLean` (size and image-space direction). Null
 * without a resting line or without both shoulders and both hips.
 */
export function restReferencedTrunkLean(
  landmarks: Landmarks,
  restLineDeg: number | null,
  frameAspect: number,
): TrunkLeanResult | null {
  if (restLineDeg === null || !Number.isFinite(restLineDeg)) return null;
  // computeTrunkLateralLean measures from vertical (-90 in image coordinates)
  // after removing a camera tilt, so the resting line reads 0 under a tilt
  // equal to its own offset from vertical.
  return computeTrunkLateralLean(
    landmarks,
    { cameraTiltDeg: restLineDeg + 90, confidence: "high", divergenceDeg: null },
    frameAspect,
  );
}
