export const NEUTRAL_CALIBRATION_DURATION_MS = 3_000;
export const NEUTRAL_CALIBRATION_MIN_SAMPLES = 15;
export const NEUTRAL_CALIBRATION_MAX_TICK_MS = 250;

export type NeutralCalibrationClock = {
  validElapsedMs: number;
  sampleCount: number;
  lastValidAtMs: number | null;
};

export function newNeutralCalibrationClock(): NeutralCalibrationClock {
  return {
    validElapsedMs: 0,
    sampleCount: 0,
    lastValidAtMs: null,
  };
}

/**
 * Credit one capture-ready frame. Wall-clock gaps are capped so a stalled
 * frame or a brief readiness transition cannot complete calibration at once.
 */
export function advanceNeutralCalibrationClock(
  previous: NeutralCalibrationClock,
  nowMs: number,
): NeutralCalibrationClock {
  if (!Number.isFinite(nowMs)) return previous;
  const elapsed =
    previous.lastValidAtMs === null
      ? 0
      : Math.max(
          0,
          Math.min(
            NEUTRAL_CALIBRATION_MAX_TICK_MS,
            nowMs - previous.lastValidAtMs,
          ),
        );
  return {
    validElapsedMs: Math.min(
      NEUTRAL_CALIBRATION_DURATION_MS,
      previous.validElapsedMs + elapsed,
    ),
    sampleCount: previous.sampleCount + 1,
    lastValidAtMs: nowMs,
  };
}

/** Pause without crediting the capture-readiness gap on the next valid frame. */
export function pauseNeutralCalibrationClock(
  previous: NeutralCalibrationClock,
): NeutralCalibrationClock {
  return previous.lastValidAtMs === null
    ? previous
    : { ...previous, lastValidAtMs: null };
}

export function neutralCalibrationReady(
  clock: NeutralCalibrationClock,
): boolean {
  return (
    clock.validElapsedMs >= NEUTRAL_CALIBRATION_DURATION_MS &&
    clock.sampleCount >= NEUTRAL_CALIBRATION_MIN_SAMPLES
  );
}

export function neutralCalibrationProgressPct(
  clock: NeutralCalibrationClock,
): number {
  const timeProgress =
    clock.validElapsedMs / NEUTRAL_CALIBRATION_DURATION_MS;
  const sampleProgress =
    clock.sampleCount / NEUTRAL_CALIBRATION_MIN_SAMPLES;
  return Math.round(
    Math.max(0, Math.min(1, timeProgress, sampleProgress)) * 100,
  );
}

export function medianFinite(values: readonly number[]): number | null {
  const sorted = values
    .filter((value) => Number.isFinite(value))
    .slice()
    .sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

/**
 * Preserve current confidence/provenance metadata while applying the neutral
 * calibration's fixed correction angle to every derived metric.
 */
export function frozenNeutralTiltReference(
  observed: TiltReference,
  frozenCameraTiltDeg: number,
): TiltReference {
  return {
    ...observed,
    cameraTiltDeg: frozenCameraTiltDeg,
  };
}
import type { TiltReference } from "./poseMetrics";
