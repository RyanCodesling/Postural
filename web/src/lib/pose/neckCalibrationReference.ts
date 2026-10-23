/**
 * The neck side bend (ex_004) counts from the head's own resting ear line,
 * taken in the neutral calibration, instead of the camera tilt frozen there
 * (D-49).
 *
 * The frozen camera tilt comes from the hip and ear lines. When the resting
 * ear line is not parallel to the hip line in the picture (the hips not level,
 * or the patient standing at an angle to the camera), a still head reads off
 * zero for the whole session, and every repetition reaches the counting lines
 * that much early on one side and late on the other. Measured from the ear
 * line frozen over the same baseline, the still head reads 0.
 *
 * Everything the neck reading feeds follows it: the per-side counters, card,
 * warning and score, the stored repetition peaks, the raw trace, and the rest
 * record that trend data rule 4 corrects the peaks with (it then holds only
 * how far the resting head sits from the calibration posture). Every other
 * metric keeps the camera tilt.
 */
import type { ExerciseDefinition } from "../exercises/registry";
import { medianFinite } from "./neutralCalibration";
import { earLineAngleDeg, type TiltReference } from "./poseMetrics";
import type { RestSample } from "./shoulderRestReference";

/** The resting ear line: the median ear line over the calibration's samples, or null. */
export function restingEarLineDeg(samples: readonly RestSample[]): number | null {
  return medianFinite(
    samples
      .map((sample) => earLineAngleDeg(sample.landmarks, sample.frameAspect))
      .filter((v): v is number => v !== null),
  );
}

/** Whether the definition's primary metric counts from the calibration's ear line. */
export function countsFromCalibrationEarLine(definition: ExerciseDefinition): boolean {
  return definition.kind === "dynamic" && definition.primaryMetric.reference === "calibration-ear-line";
}

/**
 * The primary metric's own reference for `computePoseMetricsForExercise`: the
 * frozen ear line for a definition that counts from it, otherwise none (the
 * camera tilt applies).
 */
export function primaryReferenceFor(
  definition: ExerciseDefinition,
  earLineDeg: number | null,
): TiltReference | undefined {
  if (!countsFromCalibrationEarLine(definition)) return undefined;
  if (earLineDeg === null || !Number.isFinite(earLineDeg)) return undefined;
  return { cameraTiltDeg: earLineDeg, confidence: "high", divergenceDeg: null };
}
