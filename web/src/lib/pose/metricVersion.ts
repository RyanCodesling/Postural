/**
 * Changes whenever the meaning of a persisted pose-derived metric changes.
 *
 * This is separate from registry thresholds: the v2 boundary records that
 * camera tilt is calibrated from a capture-ready neutral window and then held
 * fixed while an attempt is evaluated.
 *
 * ── MUST BE BUMPED WITH THE ASPECT CORRECTION ────────────────────────────────
 *
 * `poseMetrics.ts` can now correct for frame aspect ratio, but the live path
 * still runs with the correction DISABLED (`frameAspect` defaults to 1), so the
 * meaning of every persisted metric is unchanged and this identifier is still
 * accurate today.
 *
 * The moment the live path passes a real aspect, that stops being true: the
 * same movement produces a different number, and this string feeds
 * `poseMetricAlgorithm` in `exercises/versioning.ts`, which feeds every
 * `exerciseConfigVersion`. Leaving it unchanged would file pre- and
 * post-correction sessions under ONE measurement contract, so a therapist's
 * trend view would silently splice two different measurements into one line —
 * the same class of harm the cue-exclusion invariant exists to prevent, but in
 * the opposite direction: there the hash must NOT move for a non-measurement
 * change, here it MUST move for a real one.
 *
 * So the live switch is not a one-line change. It has to move together:
 *   1. the aspect into `computePoseMetricsForExercise` AND into the frozen
 *      neutral-tilt capture, which is currently taken with no aspect — a tilt
 *      measured in one space cannot be subtracted from geometry in the other
 *      (pinned by the SWITCH-OVER HAZARD case in `poseNormalization.test.ts`);
 *   2. every direct metric caller, including the trace-metrics builder and the
 *      baseline/scapular-delta helpers, or traces will mix corrected and
 *      uncorrected channels in one record;
 *   3. the source frame width/height into the persisted trace, which is not
 *      recorded today and without which past sessions cannot be reprocessed;
 *   4. the four `primary-coupled` scoring fits, which regress a compensation on
 *      a primary that the correction changes;
 *   5. this identifier.
 */
export const POSE_METRIC_ALGORITHM_VERSION =
  "pose_metrics_v2_frozen_neutral_tilt" as const;

