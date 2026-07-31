/**
 * Changes whenever the meaning of a persisted pose-derived metric changes.
 *
 * This is separate from registry thresholds: the v2 boundary records that
 * camera tilt is calibrated from a capture-ready neutral window and then held
 * fixed while an attempt is evaluated.
 */
export const POSE_METRIC_ALGORITHM_VERSION =
  "pose_metrics_v2_frozen_neutral_tilt" as const;

