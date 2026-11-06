/**
 * Changes whenever the meaning of a persisted pose-derived metric changes.
 *
 * This is separate from registry thresholds. The v2 boundary recorded that
 * camera tilt is calibrated from a capture-ready neutral window and then held
 * fixed while an attempt is evaluated.
 *
 * ── v3, 2026-10-21: THE ASPECT CORRECTION IS ON (D-48) ───────────────────────
 *
 * The live path now passes each frame's real aspect, so every persisted angle is
 * the aspect-corrected image-plane angle and the same movement produces a
 * different number than under v2. This string feeds `poseMetricAlgorithm` in
 * `exercises/versioning.ts`, which feeds every `exerciseConfigVersion`, so
 * sessions from before and after the switch are filed under different
 * measurement contracts and a therapist's trend view never splices them into one
 * line. The switch moved together, as this note required while it was pending:
 *   1. the aspect into `computePoseMetricsForExercise` AND into the frozen
 *      neutral-tilt capture (each calibration sample carries its frame's
 *      aspect), so a tilt is never subtracted from geometry in the other space;
 *   2. every direct metric caller, including the trace-metrics builder and the
 *      baseline/scapular-delta helpers (the metric functions now require the
 *      aspect, so the type checker lists any caller that forgets it);
 *   3. the replay converts the baselines and frozen tilt stored in older traces
 *      from their recorded frame size (`scripts/replay-coaching.ts`);
 *   4. the four `primary-coupled` scoring fits, refitted in corrected units;
 *   5. this identifier.
 * Readers must accept both identifiers: stored v2 records stay valid, in the
 * old unit.
 */
export const POSE_METRIC_ALGORITHM_VERSION =
  "pose_metrics_v3_aspect_corrected" as const;

/** The identifier before the aspect correction, still found on stored records. */
export const PRE_ASPECT_POSE_METRIC_ALGORITHM_VERSION =
  "pose_metrics_v2_frozen_neutral_tilt" as const;
