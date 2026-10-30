import {
  getCompensationScoring,
  type CompensationMetricSpec,
  type MetricName,
} from "@/lib/exercises/registry";

export const COMPENSATION_WARNING_DEBOUNCE_MS = 300;

export type CompensationWarningLatch = {
  active: boolean;
  pendingActive: boolean | null;
  pendingSinceMs: number | null;
};

type CompareDirection = NonNullable<CompensationMetricSpec["compareDirection"]>;

const INACTIVE_WARNING: CompensationWarningLatch = {
  active: false,
  pendingActive: null,
  pendingSinceMs: null,
};

/**
 * Display-only warning hysteresis. Degree-scale metrics get a deadband of half
 * their line, or 2.5 for the large interior-angle lines (the elbow checks), while
 * normalized trunk-length metrics get a small unit-scaled band.
 *
 * Until 2026-10-21 degree metrics got min(2.5, half the line). The lines were
 * then re-derived for the aspect-corrected readings (D-48), and half of each
 * re-derived small line keeps its switch-off level where it was: trunk lean's
 * 5 (off at 2.5) became 8.8 (off at 4.4, the corrected 2.5). A 2.5 cap would
 * have moved it. The elbow lines (130-150) keep the fixed 2.5.
 */
export function compensationWarningMargin(
  metricName: MetricName,
  threshold: number,
): number {
  if (threshold < 1 || metricName === "scapularElevation" || metricName === "shoulderElbowDistance") {
    return Math.max(0.005, Math.min(0.03, threshold * 0.2));
  }
  return threshold >= 45 ? 2.5 : threshold * 0.5;
}

/**
 * A `primary-coupled` warning value is a SIGNED residual: the measured value
 * minus the value the pilot fit expects at the current primary. Only an excess
 * over that expectation is the compensation (more shoulder rise or more neck
 * tilt than the movement itself produces). A deficit means the body part moved
 * LESS than the fit predicts. That is not the compensation the cue names, and
 * because the fits come from one pilot subject, an absolute test turned it into
 * a cue on correct form. Static metrics keep their two-sided |value| test.
 *
 * Display-only: the compensation score still deducts on |residual|, so scores,
 * thresholds and stored measurements are unchanged.
 */
export function compensationWarningIsOneSided(spec: CompensationMetricSpec): boolean {
  return (
    (spec.compareDirection ?? "above") === "above" &&
    getCompensationScoring(spec).mode === "primary-coupled"
  );
}

/**
 * The level at which a cue switches on: the cue's own `trigger.on` when the
 * registry gives one (it then switches off at `trigger.off`), else the
 * metric's `warningThreshold`. A cue trigger exists where the warning line sits
 * inside the range of correct form. Display only: the measurement threshold,
 * the stored time over it and the score are unchanged.
 */
export function cueTriggerLevel(spec: CompensationMetricSpec): number {
  return spec.cue?.trigger?.on ?? spec.warningThreshold;
}

/**
 * The level at or below which a shown cue's warning switches off: the cue's own
 * `trigger.off` when the registry gives one, else the warning threshold less
 * the metric's margin, as the latch computes it. Upper-bound metrics only. The
 * LOWER arrow uses it to tell when the other shoulder has clearly become the
 * higher one.
 */
export function cueClearLevel(spec: CompensationMetricSpec): number {
  const trigger = spec.cue?.trigger;
  if (trigger) return trigger.off;
  return Math.max(0, spec.warningThreshold - compensationWarningMargin(spec.name, spec.warningThreshold));
}

function crossesTrigger(
  value: number,
  threshold: number,
  direction: CompareDirection,
  oneSided: boolean,
): boolean {
  if (direction === "below") return value < threshold;
  return oneSided ? value >= threshold : Math.abs(value) >= threshold;
}

function crossesClear(
  value: number,
  threshold: number,
  direction: CompareDirection,
  margin: number,
  oneSided: boolean,
): boolean {
  if (direction === "below") return value >= threshold + margin;
  const clearLevel = Math.max(0, threshold - margin);
  return oneSided ? value <= clearLevel : Math.abs(value) <= clearLevel;
}

/** The latch's deadband: the cue trigger's on-off gap when it has one, else the metric's margin. */
function latchMargin(spec: CompensationMetricSpec): number {
  const trigger = spec.cue?.trigger;
  return trigger ? Math.abs(trigger.on - trigger.off) : compensationWarningMargin(spec.name, spec.warningThreshold);
}

/**
 * Whether a warning's value is already back past its switch-off level: the latch's own test for starting to switch
 * off, before its debounce has run. The cue selector uses it so that a warning whose correction has already been made
 * does not replace the displayed cue during that wait (coachingCue.ts). No reading is not a recovery.
 */
export function warningValueCleared(spec: CompensationMetricSpec, value: number | null | undefined): boolean {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  return crossesClear(
    value,
    cueTriggerLevel(spec),
    spec.compareDirection ?? "above",
    latchMargin(spec),
    compensationWarningIsOneSided(spec),
  );
}

/**
 * Whether a warning's value is short of its switch-on level: the latch's own switch-on test would not pass on it. A
 * latched warning's value can sit anywhere short of its switch-off level, so the cue selector uses this to keep a
 * latched warning off an empty screen until its value is back at the level that switched it on (coachingCue.ts). No
 * reading is not short of it.
 */
export function warningValueShortOfTrigger(spec: CompensationMetricSpec, value: number | null | undefined): boolean {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  return !crossesTrigger(
    value,
    cueTriggerLevel(spec),
    spec.compareDirection ?? "above",
    compensationWarningIsOneSided(spec),
  );
}

function settleToward(
  latch: CompensationWarningLatch,
  targetActive: boolean,
  nowMs: number,
  debounceMs: number,
): CompensationWarningLatch {
  if (targetActive === latch.active) {
    return {
      active: latch.active,
      pendingActive: null,
      pendingSinceMs: null,
    };
  }

  const pendingSinceMs =
    latch.pendingActive === targetActive && latch.pendingSinceMs !== null
      ? latch.pendingSinceMs
      : nowMs;

  if (nowMs - pendingSinceMs >= debounceMs) {
    return {
      active: targetActive,
      pendingActive: null,
      pendingSinceMs: null,
    };
  }

  return {
    active: latch.active,
    pendingActive: targetActive,
    pendingSinceMs,
  };
}

export function updateCompensationWarningLatch(
  previous: CompensationWarningLatch | undefined,
  spec: CompensationMetricSpec,
  value: number | null,
  nowMs: number,
  options: {
    debounceMs?: number;
    margin?: number;
    suppressed?: boolean;
  } = {},
): CompensationWarningLatch {
  if (options.suppressed || typeof value !== "number") {
    return INACTIVE_WARNING;
  }

  const latch = previous ?? INACTIVE_WARNING;
  const direction = spec.compareDirection ?? "above";
  const oneSided = compensationWarningIsOneSided(spec);
  const threshold = cueTriggerLevel(spec);
  const margin = options.margin ?? latchMargin(spec);

  if (latch.active) {
    return settleToward(
      latch,
      crossesClear(value, threshold, direction, margin, oneSided) ? false : true,
      nowMs,
      options.debounceMs ?? COMPENSATION_WARNING_DEBOUNCE_MS,
    );
  }

  return settleToward(
    latch,
    crossesTrigger(value, threshold, direction, oneSided),
    nowMs,
    options.debounceMs ?? COMPENSATION_WARNING_DEBOUNCE_MS,
  );
}

export function updateCompensationWarningMap(
  latches: Map<MetricName, CompensationWarningLatch>,
  specs: readonly CompensationMetricSpec[],
  values: Partial<Record<MetricName, number | null>>,
  nowMs: number,
  suppressedNames: ReadonlySet<MetricName> = new Set(),
): Set<MetricName> {
  const currentNames = new Set(specs.map((spec) => spec.name));
  for (const name of latches.keys()) {
    if (!currentNames.has(name)) {
      latches.delete(name);
    }
  }

  const activeNames = new Set<MetricName>();
  for (const spec of specs) {
    const next = updateCompensationWarningLatch(
      latches.get(spec.name),
      spec,
      values[spec.name] ?? null,
      nowMs,
      { suppressed: suppressedNames.has(spec.name) },
    );

    if (next.active || next.pendingActive !== null) {
      latches.set(spec.name, next);
    } else {
      latches.delete(spec.name);
    }

    if (next.active) {
      activeNames.add(spec.name);
    }
  }

  return activeNames;
}
