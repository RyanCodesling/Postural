import type { CompensationMetricSpec, MetricName } from "@/lib/exercises/registry";

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
 * Display-only warning hysteresis. Degree-scale metrics get a few degrees of
 * deadband, while normalized trunk-length metrics get a small unit-scaled band.
 */
export function compensationWarningMargin(
  metricName: MetricName,
  threshold: number,
): number {
  if (threshold < 1 || metricName === "scapularElevation" || metricName === "shoulderElbowDistance") {
    return Math.max(0.005, Math.min(0.03, threshold * 0.2));
  }
  return Math.min(2.5, threshold * 0.5);
}

function crossesTrigger(
  value: number,
  threshold: number,
  direction: CompareDirection,
): boolean {
  return direction === "below"
    ? value < threshold
    : Math.abs(value) >= threshold;
}

function crossesClear(
  value: number,
  threshold: number,
  direction: CompareDirection,
  margin: number,
): boolean {
  return direction === "below"
    ? value >= threshold + margin
    : Math.abs(value) <= Math.max(0, threshold - margin);
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
  const margin = options.margin ?? compensationWarningMargin(spec.name, spec.warningThreshold);

  if (latch.active) {
    return settleToward(
      latch,
      crossesClear(value, spec.warningThreshold, direction, margin) ? false : true,
      nowMs,
      options.debounceMs ?? COMPENSATION_WARNING_DEBOUNCE_MS,
    );
  }

  return settleToward(
    latch,
    crossesTrigger(value, spec.warningThreshold, direction),
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
