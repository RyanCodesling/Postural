/**
 * The LOWER cue ("Level your shoulders.") judges the shoulders against their
 * own resting line, taken in the neutral calibration, instead of the camera
 * tilt frozen there.
 *
 * The frozen camera tilt comes from the hip and ear lines. When the hips are
 * not level with the resting shoulders, still shoulders already read part of
 * the way to the cue's switch-on level, so the cue shows more or less often
 * depending on the setup rather than on the movement. Measured from the
 * resting shoulder line, a still body reads 0 and only a change from it
 * counts.
 *
 * Display only: the compensation score, the stored raw features and the
 * measurement versions keep the frozen-tilt reading. The coaching
 * configuration records this reference (`shoulderReference`).
 */
import { medianFinite } from "./neutralCalibration";
import { computeShoulderSymmetry, shoulderLineAngleDeg, type ShoulderSymmetryResult } from "./poseMetrics";

/** How the LOWER cue's shoulder reading is referenced (coaching configuration). */
export const SHOULDER_CUE_REFERENCE = "resting_shoulder_line_v1" as const;

type Landmarks = Parameters<typeof shoulderLineAngleDeg>[0];

/** The resting shoulder line: the median shoulder line over the calibration's samples, or null. */
export function restingShoulderLineDeg(samples: readonly Landmarks[]): number | null {
  return medianFinite(
    samples.map((landmarks) => shoulderLineAngleDeg(landmarks)).filter((v): v is number => v !== null),
  );
}

/**
 * The cue's shoulder reading: the shoulder line against the resting line, in
 * the same form as `computeShoulderSymmetry` (size and elevated side). Null
 * without a resting line or without both shoulders.
 */
export function restReferencedShoulderSymmetry(
  landmarks: Landmarks,
  restLineDeg: number | null,
): ShoulderSymmetryResult | null {
  if (restLineDeg === null || !Number.isFinite(restLineDeg)) return null;
  return computeShoulderSymmetry(landmarks, { cameraTiltDeg: restLineDeg, confidence: "high", divergenceDeg: null });
}
