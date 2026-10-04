import type {
  CompensationMetricSpec,
  MetricName,
} from "@/lib/exercises/registry";
import type { RepEvent } from "./repCounter";
import { POSE_METRIC_ALGORITHM_VERSION } from "./metricVersion";

/**
 * Versioned dynamic-repetition quality payload persisted in
 * `rep_events.compensations`.
 *
 * The three branches deliberately keep their sources explicit:
 *  - `liveRule` summarizes the smoothed score shown during coaching.
 *  - `rawRule` and `rawFeatures` are computed only from raw/unsmoothed metrics
 *    inside the smoothed RepCounter boundaries. `rawRule` is the authoritative
 *    persisted deduction aggregate used by analytics.
 */
export type DynamicRepQualityV1 = {
  version: 1;
  liveRule: {
    meanScore: number;
    minScore: number;
    scoredDurationMs: number;
    coveragePct: number;
  } | null;
  rawRule: {
    meanScore: number;
    minScore: number;
    scoredDurationMs: number;
    coveragePct: number;
  } | null;
  rawFeatures: {
    source: "raw-unsmoothed";
    boundarySource: "smoothed-rep-counter";
    featureDefinition: "ml.features.extract.rep-v1";
    resampledHz: 30;
    sampleCount: number;
    resampledSampleCount: number;
    coveragePct: number;
    scoredCompensationNames: MetricName[];
    mlEligible: boolean;
    tempoRatio: number | null;
    negLogDimensionlessJerk: number;
    submovementCount: number;
    shapeP25: number;
    shapeP50: number;
    shapeP75: number;
    compensations: Partial<
      Record<
        MetricName,
        {
          meanAbs: number;
          peakAbs: number;
          overThresholdFrac: number;
          coveragePct: number;
        }
      >
    >;
  } | null;
};

/**
 * V2 keeps the rep aggregation/feature contract intact while recording the
 * changed pose-metric semantics that produced its raw channels.
 */
export type DynamicRepQualityV2 = Omit<DynamicRepQualityV1, "version"> & {
  version: 2;
  metricAlgorithmVersion: typeof POSE_METRIC_ALGORITHM_VERSION;
};

export type RawRepFeaturesV2 = Omit<NonNullable<DynamicRepQualityV1["rawFeatures"]>,
  "featureDefinition" | "negLogDimensionlessJerk" | "submovementCount" |
  "shapeP25" | "shapeP50" | "shapeP75"> & {
  featureDefinition: "ml.features.extract.rep-v2";
  targetSampleCount: number;
  temporalStatus: "complete" | "gapped" | "insufficient-motion";
  negLogDimensionlessJerk: number | null;
  submovementCount: number | null;
  shapeP25: number | null;
  shapeP50: number | null;
  shapeP75: number | null;
};

/** Corrected time/amplitude normalization; gaps never become adjacent samples. */
export type DynamicRepQualityV3 = Omit<DynamicRepQualityV2, "version" | "rawFeatures"> & {
  version: 3;
  rawFeatures: RawRepFeaturesV2 | null;
};

export type DynamicRepQuality =
  | DynamicRepQualityV1
  | DynamicRepQualityV2
  | DynamicRepQualityV3;

export type RepQualityChannel = "left" | "right" | "single";

export type DynamicRepQualitySample = {
  tMs: number;
  /** Raw/unsmoothed primary value in the same domain fed to this rep mode. */
  rawPrimary: number;
  /** Smoothed live coaching score for this rep side, when available. */
  liveScore: number | null;
  /** Score recomputed from raw/unsmoothed metrics for persisted analytics. */
  rawRuleScore: number | null;
  /** Raw/unsmoothed, baseline-adjusted compensation values. */
  rawCompensations: Partial<Record<MetricName, number | null>>;
};

const RESAMPLE_HZ = 30 as const;
const RESAMPLE_STEP_MS = 1000 / RESAMPLE_HZ;
const MAX_INTERPOLATION_GAP_MS = 200;
const MAX_SCORE_INTERVAL_MS = 200;
const SAMPLE_RETENTION_MS = 60_000;
const MIN_ML_COVERAGE_PCT = 80;
const MAX_PERSISTED_JSON_CHARS = 32_768;

const roundTo = (value: number, places: number): number => {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
};

const clampPct = (value: number): number =>
  Math.max(0, Math.min(100, value));

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

function diff(values: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < values.length; i += 1) {
    out.push(values[i] - values[i - 1]);
  }
  return out;
}

/** Matches `_moving_average(..., w=5)` in `ml/features/extract.py`. */
function movingAverageSame(values: number[], width = 5): number[] {
  if (values.length < width || width <= 1) return [...values];
  const half = Math.floor(width / 2);
  return values.map((_, index) => {
    let sum = 0;
    for (let offset = -half; offset <= half; offset += 1) {
      const sourceIndex = index + offset;
      if (sourceIndex >= 0 && sourceIndex < values.length) {
        sum += values[sourceIndex];
      }
    }
    return sum / width;
  });
}

/**
 * Local maxima with a SciPy-compatible prominence test for the speed profile.
 * Plateaus emit their midpoint, matching `find_peaks`' plateau convention.
 */
function countProminentPeaks(values: number[], minProminence: number): number {
  if (values.length < 3) return 0;
  const candidates: number[] = [];
  let i = 1;
  while (i < values.length - 1) {
    if (values[i] <= values[i - 1]) {
      i += 1;
      continue;
    }
    let plateauEnd = i;
    while (
      plateauEnd + 1 < values.length &&
      values[plateauEnd + 1] === values[i]
    ) {
      plateauEnd += 1;
    }
    if (
      plateauEnd < values.length - 1 &&
      values[plateauEnd] > values[plateauEnd + 1]
    ) {
      candidates.push(Math.floor((i + plateauEnd) / 2));
    }
    i = plateauEnd + 1;
  }

  let count = 0;
  for (const peakIndex of candidates) {
    const peakHeight = values[peakIndex];
    let leftMin = peakHeight;
    for (let j = peakIndex - 1; j >= 0; j -= 1) {
      if (values[j] > peakHeight) break;
      leftMin = Math.min(leftMin, values[j]);
    }
    let rightMin = peakHeight;
    for (let j = peakIndex + 1; j < values.length; j += 1) {
      if (values[j] > peakHeight) break;
      rightMin = Math.min(rightMin, values[j]);
    }
    const prominence = peakHeight - Math.max(leftMin, rightMin);
    if (prominence >= minProminence) count += 1;
  }
  return count;
}

function smoothness(primary: number[]): {
  negLogDimensionlessJerk: number;
  submovementCount: number;
} {
  const n = primary.length;
  const durationSec = (n - 1) / RESAMPLE_HZ;
  const amplitude = Math.max(...primary) - Math.min(...primary);

  let jerk = diff(diff(diff(primary)));
  if (jerk.length === 0) jerk = [0];
  const jerkScale = RESAMPLE_HZ ** 3;
  const integralJerkSq =
    jerk.reduce((sum, value) => sum + (value * jerkScale) ** 2, 0) /
    RESAMPLE_HZ;
  const dimensionlessJerk =
    (durationSec ** 5 / amplitude ** 2) * integralJerkSq + 1e-9;
  const negLogDimensionlessJerk = -Math.log(dimensionlessJerk);

  const speed = diff(movingAverageSame(primary, 5)).map(
    (value) => Math.abs(value) * RESAMPLE_HZ,
  );
  const maxSpeed = speed.length > 0 ? Math.max(...speed) : 0;
  const minProminence = Math.max(0.05 * maxSpeed, 1e-6);

  return {
    negLogDimensionlessJerk,
    submovementCount: countProminentPeaks(speed, minProminence),
  };
}

type ResampledValues = {
  values: number[];
  targetCount: number;
};

function resample(
  samples: DynamicRepQualitySample[],
  startMs: number,
  endMs: number,
  select: (sample: DynamicRepQualitySample) => number | null | undefined,
): ResampledValues {
  const durationMs = Math.max(0, endMs - startMs);
  const targetCount = Math.max(1, Math.floor(durationMs / RESAMPLE_STEP_MS + 1e-9) + 1);
  const targets = Array.from(
    { length: targetCount },
    (_, index) => startMs + index * RESAMPLE_STEP_MS,
  );
  const values: number[] = [];
  let rightIndex = 0;

  for (const target of targets) {
    while (
      rightIndex < samples.length &&
      samples[rightIndex].tMs < target - 1e-6
    ) {
      rightIndex += 1;
    }

    const right = samples[rightIndex];
    const left = samples[rightIndex - 1];
    if (right && Math.abs(right.tMs - target) < 1e-6) {
      const exact = select(right);
      if (isFiniteNumber(exact)) values.push(exact);
      continue;
    }
    if (!left || !right) continue;
    const leftValue = select(left);
    const rightValue = select(right);
    const gapMs = right.tMs - left.tMs;
    if (
      !isFiniteNumber(leftValue) ||
      !isFiniteNumber(rightValue) ||
      gapMs <= 0 ||
      gapMs > MAX_INTERPOLATION_GAP_MS
    ) {
      continue;
    }
    const fraction = (target - left.tMs) / gapMs;
    values.push(leftValue + fraction * (rightValue - leftValue));
  }

  return { values, targetCount };
}

function summarizeRuleScore(
  samples: DynamicRepQualitySample[],
  durationMs: number,
  select: (sample: DynamicRepQualitySample) => number | null,
): DynamicRepQualityV1["liveRule"] {
  let weightedScore = 0;
  let scoredDurationMs = 0;
  let minScore: number | null = null;
  for (let i = 1; i < samples.length; i += 1) {
    const score = select(samples[i]);
    const intervalMs = Math.min(
      Math.max(0, samples[i].tMs - samples[i - 1].tMs),
      MAX_SCORE_INTERVAL_MS,
    );
    if (!isFiniteNumber(score) || intervalMs <= 0) continue;
    weightedScore += score * intervalMs;
    scoredDurationMs += intervalMs;
    minScore = minScore === null ? score : Math.min(minScore, score);
  }
  if (scoredDurationMs <= 0 || minScore === null) return null;
  return {
    meanScore: roundTo(weightedScore / scoredDurationMs, 2),
    minScore: roundTo(minScore, 2),
    scoredDurationMs: Math.round(scoredDurationMs),
    coveragePct: roundTo(
      clampPct((scoredDurationMs / Math.max(durationMs, 1)) * 100),
      1,
    ),
  };
}

function summarizeRawFeatures(
  samples: DynamicRepQualitySample[],
  event: RepEvent,
  scoredCompensations: CompensationMetricSpec[],
): DynamicRepQualityV3["rawFeatures"] {
  const primaryResampled = resample(
    samples,
    event.startTimeMs,
    event.endTimeMs,
    (sample) => sample.rawPrimary,
  );
  const primary = primaryResampled.values;
  if (primary.length === 0) return null;
  const temporalStatus: RawRepFeaturesV2["temporalStatus"] =
    primary.length !== primaryResampled.targetCount ? "gapped" :
    primary.length < 4 || Math.max(...primary) - Math.min(...primary) <= 1e-9
      ? "insufficient-motion" : "complete";
  const temporalValid = temporalStatus === "complete";

  const coveragePct = roundTo(
    clampPct((primary.length / primaryResampled.targetCount) * 100),
    1,
  );
  const peakValue = Math.max(...primary);
  const peakIndex = primary.indexOf(peakValue);
  const totalMs = (primary.length / RESAMPLE_HZ) * 1000;
  const ascentMs = (peakIndex / RESAMPLE_HZ) * 1000;
  const holdFrames = primary.filter(
    (value) => value >= 0.95 * peakValue,
  ).length;
  const holdMs = (holdFrames / RESAMPLE_HZ) * 1000;
  const descentMs = Math.max(totalMs - ascentMs - holdMs, 0);
  const tempoRatio = descentMs > 1e-6 ? ascentMs / descentMs : null;
  const shapeIndex = (fraction: number): number =>
    Math.floor(fraction * (primary.length - 1));
  const shapeValue = (fraction: number): number =>
    peakValue === 0 ? 0 : primary[shapeIndex(fraction)] / peakValue;
  const smooth = temporalValid ? smoothness(primary) : null;

  const compensations: NonNullable<
    DynamicRepQualityV1["rawFeatures"]
  >["compensations"] = {};
  for (const spec of scoredCompensations) {
    const channel = resample(
      samples,
      event.startTimeMs,
      event.endTimeMs,
      (sample) => sample.rawCompensations[spec.name],
    );
    const absoluteValues = channel.values.map((value) => Math.abs(value));
    if (absoluteValues.length === 0) continue;
    compensations[spec.name] = {
      meanAbs: roundTo(
        absoluteValues.reduce((sum, value) => sum + value, 0) /
          absoluteValues.length,
        6,
      ),
      peakAbs: roundTo(Math.max(...absoluteValues), 6),
      overThresholdFrac: roundTo(
        absoluteValues.filter((value) => value >= spec.warningThreshold).length /
          absoluteValues.length,
        6,
      ),
      coveragePct: roundTo(
        clampPct((absoluteValues.length / channel.targetCount) * 100),
        1,
      ),
    };
  }

  return {
    source: "raw-unsmoothed",
    boundarySource: "smoothed-rep-counter",
    featureDefinition: "ml.features.extract.rep-v2",
    targetSampleCount: primaryResampled.targetCount,
    temporalStatus,
    resampledHz: RESAMPLE_HZ,
    sampleCount: samples.length,
    resampledSampleCount: primary.length,
    coveragePct,
    scoredCompensationNames: scoredCompensations.map((spec) => spec.name),
    mlEligible:
      temporalValid && coveragePct >= MIN_ML_COVERAGE_PCT &&
      primary.length >= 4 &&
      scoredCompensations.every(
        (spec) =>
          compensations[spec.name] !== undefined &&
          compensations[spec.name]!.coveragePct >= MIN_ML_COVERAGE_PCT,
      ),
    tempoRatio: !temporalValid || tempoRatio === null ? null : roundTo(tempoRatio, 6),
    negLogDimensionlessJerk: smooth === null ? null : roundTo(smooth.negLogDimensionlessJerk, 6),
    submovementCount: smooth?.submovementCount ?? null,
    shapeP25: temporalValid ? roundTo(shapeValue(0.25), 6) : null,
    shapeP50: temporalValid ? roundTo(shapeValue(0.5), 6) : null,
    shapeP75: temporalValid ? roundTo(shapeValue(0.75), 6) : null,
    compensations,
  };
}

/**
 * Bounded in-memory raw-sample buffer. It keeps independent channels so
 * simultaneous left/right repetitions cannot contaminate one another.
 */
export class DynamicRepQualityBuffer {
  private readonly byChannel: Record<
    RepQualityChannel,
    DynamicRepQualitySample[]
  > = { left: [], right: [], single: [] };

  add(channel: RepQualityChannel, sample: DynamicRepQualitySample): void {
    if (!isFiniteNumber(sample.tMs) || !isFiniteNumber(sample.rawPrimary)) {
      return;
    }
    const samples = this.byChannel[channel];
    samples.push({
      ...sample,
      liveScore: isFiniteNumber(sample.liveScore) ? sample.liveScore : null,
      rawRuleScore: isFiniteNumber(sample.rawRuleScore)
        ? sample.rawRuleScore
        : null,
      rawCompensations: { ...sample.rawCompensations },
    });
    const cutoff = sample.tMs - SAMPLE_RETENTION_MS;
    let firstKept = 0;
    while (firstKept < samples.length && samples[firstKept].tMs < cutoff) {
      firstKept += 1;
    }
    if (firstKept > 0) samples.splice(0, firstKept);
  }

  finalize(
    channel: RepQualityChannel,
    event: RepEvent,
    scoredCompensations: CompensationMetricSpec[],
  ): DynamicRepQualityV3 {
    const channelSamples = this.byChannel[channel];
    const samples = channelSamples.filter(
      (sample) =>
        sample.tMs >= event.startTimeMs && sample.tMs <= event.endTimeMs,
    );
    this.byChannel[channel] = channelSamples.filter(
      (sample) => sample.tMs > event.endTimeMs,
    );
    return {
      version: 3,
      metricAlgorithmVersion: POSE_METRIC_ALGORITHM_VERSION,
      liveRule: summarizeRuleScore(
        samples,
        event.totalDurationMs,
        (sample) => sample.liveScore,
      ),
      rawRule: summarizeRuleScore(
        samples,
        event.totalDurationMs,
        (sample) => sample.rawRuleScore,
      ),
      rawFeatures: summarizeRawFeatures(samples, event, scoredCompensations),
    };
  }

  reset(channel?: RepQualityChannel): void {
    if (channel) {
      this.byChannel[channel] = [];
      return;
    }
    this.byChannel.left = [];
    this.byChannel.right = [];
    this.byChannel.single = [];
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const inRange = (value: unknown, min: number, max: number): value is number =>
  isFiniteNumber(value) && value >= min && value <= max;

/** Shared strict API-boundary validation for both version envelopes. */
function isDynamicRepQualityBody(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  try {
    if (JSON.stringify(value).length > MAX_PERSISTED_JSON_CHARS) return false;
  } catch {
    return false;
  }

  if (value.liveRule !== null) {
    if (!isRecord(value.liveRule)) return false;
    if (
      !inRange(value.liveRule.meanScore, 0, 100) ||
      !inRange(value.liveRule.minScore, 0, 100) ||
      !inRange(value.liveRule.scoredDurationMs, 0, Number.MAX_SAFE_INTEGER) ||
      !inRange(value.liveRule.coveragePct, 0, 100) ||
      value.liveRule.minScore > value.liveRule.meanScore
    ) {
      return false;
    }
  }

  if (value.rawRule !== null) {
    if (!isRecord(value.rawRule)) return false;
    if (
      !inRange(value.rawRule.meanScore, 0, 100) ||
      !inRange(value.rawRule.minScore, 0, 100) ||
      !inRange(value.rawRule.scoredDurationMs, 0, Number.MAX_SAFE_INTEGER) ||
      !inRange(value.rawRule.coveragePct, 0, 100) ||
      value.rawRule.minScore > value.rawRule.meanScore
    ) {
      return false;
    }
  }

  if (value.rawFeatures === null) return true;
  const raw = value.rawFeatures;
  if (!isRecord(raw)) return false;
  const v3 = value.version === 3;
  const temporalMissing = v3 && raw.temporalStatus !== "complete";
  if (
    raw.source !== "raw-unsmoothed" ||
    raw.boundarySource !== "smoothed-rep-counter" ||
    raw.featureDefinition !== (v3 ? "ml.features.extract.rep-v2" : "ml.features.extract.rep-v1") ||
    raw.resampledHz !== RESAMPLE_HZ ||
    !Number.isInteger(raw.sampleCount) ||
    !inRange(raw.sampleCount, 0, Number.MAX_SAFE_INTEGER) ||
    !Number.isInteger(raw.resampledSampleCount) ||
    !inRange(raw.resampledSampleCount, 0, Number.MAX_SAFE_INTEGER) ||
    !inRange(raw.coveragePct, 0, 100) ||
    !Array.isArray(raw.scoredCompensationNames) ||
    typeof raw.mlEligible !== "boolean" ||
    !(raw.tempoRatio === null || isFiniteNumber(raw.tempoRatio)) ||
    (temporalMissing ? raw.negLogDimensionlessJerk !== null : !isFiniteNumber(raw.negLogDimensionlessJerk)) ||
    (temporalMissing ? raw.submovementCount !== null :
      !Number.isInteger(raw.submovementCount) || !inRange(raw.submovementCount, 0, Number.MAX_SAFE_INTEGER)) ||
    [raw.shapeP25, raw.shapeP50, raw.shapeP75].some(v => temporalMissing ? v !== null : !isFiniteNumber(v)) ||
    !isRecord(raw.compensations)
  ) {
    return false;
  }
  if (v3) {
    if (!Number.isInteger(raw.targetSampleCount) || !inRange(raw.targetSampleCount, 1, Number.MAX_SAFE_INTEGER) ||
      raw.resampledSampleCount > raw.targetSampleCount ||
      !["complete", "gapped", "insufficient-motion"].includes(String(raw.temporalStatus)) ||
      (raw.temporalStatus === "gapped") !== (raw.resampledSampleCount < raw.targetSampleCount) ||
      (raw.temporalStatus === "complete" && raw.resampledSampleCount < 4) ||
      (temporalMissing && raw.tempoRatio !== null) ||
      raw.coveragePct !== roundTo(100 * raw.resampledSampleCount / raw.targetSampleCount, 1)) return false;
  }
  const compensationRecord = raw.compensations as Record<string, unknown>;
  if (raw.scoredCompensationNames.length > 32) return false;
  const expectedNames = new Set<string>();
  for (const name of raw.scoredCompensationNames) {
    if (
      typeof name !== "string" ||
      !/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(name) ||
      expectedNames.has(name)
    ) {
      return false;
    }
    expectedNames.add(name);
  }

  const expectedChannelsReady = raw.scoredCompensationNames.every((name) => {
    const summary = compensationRecord[name];
    return isRecord(summary) && inRange(summary.coveragePct, MIN_ML_COVERAGE_PCT, 100);
  });
  if (
    raw.mlEligible !==
    (!temporalMissing && raw.coveragePct >= MIN_ML_COVERAGE_PCT &&
      raw.resampledSampleCount >= 4 &&
      expectedChannelsReady)
  ) {
    return false;
  }

  const entries = Object.entries(compensationRecord);
  if (entries.length > 32) return false;
  for (const [name, summary] of entries) {
    if (
      !/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(name) ||
      !expectedNames.has(name) ||
      !isRecord(summary)
    ) {
      return false;
    }
    if (
      !inRange(summary.meanAbs, 0, Number.MAX_SAFE_INTEGER) ||
      !inRange(summary.peakAbs, 0, Number.MAX_SAFE_INTEGER) ||
      !inRange(summary.overThresholdFrac, 0, 1) ||
      !inRange(summary.coveragePct, 0, 100) ||
      summary.meanAbs > summary.peakAbs
    ) {
      return false;
    }
  }
  return true;
}

export function isDynamicRepQualityV1(
  value: unknown,
): value is DynamicRepQualityV1 {
  return isRecord(value) && value.version === 1 && isDynamicRepQualityBody(value);
}

export function isDynamicRepQualityV2(
  value: unknown,
): value is DynamicRepQualityV2 {
  return (
    isRecord(value) &&
    value.version === 2 &&
    value.metricAlgorithmVersion === POSE_METRIC_ALGORITHM_VERSION &&
    isDynamicRepQualityBody(value)
  );
}

export function isDynamicRepQuality(
  value: unknown,
): value is DynamicRepQuality {
  return isDynamicRepQualityV1(value) || isDynamicRepQualityV2(value) || isDynamicRepQualityV3(value);
}

export function isDynamicRepQualityV3(value: unknown): value is DynamicRepQualityV3 {
  return isRecord(value) && value.version === 3 &&
    value.metricAlgorithmVersion === POSE_METRIC_ALGORITHM_VERSION && isDynamicRepQualityBody(value);
}
