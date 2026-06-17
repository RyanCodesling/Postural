import {
  RepCounter,
  type RepCounterOptions,
  type RepCounterThresholds,
  type RepEvent,
} from "./repCounter";

export type BidirectionalSide = "left" | "right";

export type BidirectionalRepEvent = {
  side: BidirectionalSide;
  event: RepEvent;
};

export type BidirectionalRepCounterDebugSnapshot = {
  signedValue: number | null;
  absValue: number | null;
  isInSettleBand: boolean | null;
  awaitingRestSettle: boolean;
  restSettledSinceMs: number | null;
  restSettleElapsedMs: number | null;
  postRepGateStartedAtMs: number | null;
  postRepGateElapsedMs: number | null;
  requiresCompletePeakForNextRep: boolean;
  restSettleMs: number;
  restSettleBand: number;
  peakAbs: number;
  peakSign: 0 | 1 | -1;
  underlyingState: string;
  underlyingRepCount: number;
  emittedRepCount: number;
  thresholds: RepCounterThresholds;
  internalRepCompleteThreshold: number;
  strategy?: "magnitude-settle" | "velocity-zero-crossing";
  velocityDegPerSec?: number | null;
  velocitySign?: 0 | 1 | -1;
  armedForStroke?: boolean;
  strokePhase?: string;
  activeVelocityDegPerSec?: number;
  restVelocityDegPerSec?: number;
  restAngleThreshold?: number;
  minStrokePeakDeg?: number;
  minStrokeExcursionDeg?: number;
  armedRestAbs?: number | null;
};

export type BidirectionalRepCounterOptions = RepCounterOptions & {
  /**
   * Short post-rep refractory window. During this window, immediate
   * return-stroke overshoot is ignored; after it elapses, a deliberate next
   * alternating rep can enter the underlying RepCounter even if the patient
   * did not dwell at exact neutral.
   */
  restSettleMs?: number;
  /**
   * Absolute angle band considered "neutral enough" between alternating
   * bidirectional reps. This is intentionally separate from
   * repCompleteThreshold: completion can stay strict while between-rep
   * neutral accepts realistic residual offset.
   */
  restSettleBand?: number;
};

const DEFAULT_REST_SETTLE_MS = 150;
const INTERNAL_COMPLETE_EPSILON = 0.001;

/**
 * Wraps RepCounter for signed bidirectional metrics such as neck lateral
 * flexion. The wrapped counter still receives |angle|, but side attribution
 * comes from the sign at peak and a short post-rep gate prevents immediate
 * return-stroke overshoot from minting an opposite-side phantom rep.
 */
export class BidirectionalRepCounter {
  private readonly counter: RepCounter;
  private readonly thresholds: RepCounterThresholds;
  private readonly counterThresholds: RepCounterThresholds;
  private readonly restSettleMs: number;
  private readonly restSettleBand: number;

  private peakAbs = 0;
  private peakSign: 0 | 1 | -1 = 0;

  private awaitingRestSettle = false;
  private restSettledSinceMs: number | null = null;
  private postRepGateStartedAtMs: number | null = null;
  private requiresCompletePeakForNextRep = false;
  private emittedRepCount = 0;
  private lastSignedValue: number | null = null;

  constructor(
    thresholds: RepCounterThresholds,
    options: BidirectionalRepCounterOptions = {},
  ) {
    const { restSettleMs, restSettleBand, ...repCounterOptions } = options;
    const resolvedRestSettleBand = restSettleBand ?? thresholds.startThreshold;
    if (resolvedRestSettleBand < thresholds.repCompleteThreshold) {
      throw new Error(
        `BidirectionalRepCounter: restSettleBand (${resolvedRestSettleBand}) ` +
        `must be >= repCompleteThreshold (${thresholds.repCompleteThreshold}).`
      );
    }
    if (resolvedRestSettleBand >= thresholds.minimumPeakThreshold) {
      throw new Error(
        `BidirectionalRepCounter: restSettleBand (${resolvedRestSettleBand}) ` +
        `must be < minimumPeakThreshold (${thresholds.minimumPeakThreshold}).`
      );
    }

    const internalRepCompleteThreshold = Math.min(
      thresholds.startThreshold - INTERNAL_COMPLETE_EPSILON,
      Math.max(thresholds.repCompleteThreshold, resolvedRestSettleBand),
    );
    const counterThresholds = {
      ...thresholds,
      repCompleteThreshold: internalRepCompleteThreshold,
    };

    this.counter = new RepCounter(counterThresholds, repCounterOptions);
    this.thresholds = thresholds;
    this.counterThresholds = counterThresholds;
    this.restSettleMs = restSettleMs ?? DEFAULT_REST_SETTLE_MS;
    this.restSettleBand = resolvedRestSettleBand;
  }

  update(
    signedValue: number,
    tMs: number,
    _velocityDegPerSec?: number,
  ): BidirectionalRepEvent | null {
    void _velocityDegPerSec;
    const absValue = Math.abs(signedValue);

    if (this.awaitingRestSettle && !this.hasSettledAtRest(absValue, tMs)) {
      this.clearPeakTracking();
      this.lastSignedValue = signedValue;
      return null;
    }

    const stateBefore = this.counter.getState();
    const crossedSides =
      this.lastSignedValue !== null &&
      this.lastSignedValue * signedValue < 0;
    const crossedNearNeutral =
      crossedSides &&
      this.lastSignedValue !== null &&
      Math.min(Math.abs(this.lastSignedValue), absValue) <=
        this.thresholds.minimumPeakThreshold;
    if (
      crossedNearNeutral &&
      stateBefore === "DESCENDING" &&
      this.peakAbs >= this.thresholds.minimumPeakThreshold
    ) {
      const event = this.counter.update(0, tMs);
      this.lastSignedValue = signedValue;
      if (event) {
        return this.emitEvent(event, signedValue, tMs, 0);
      }
    }

    const event = this.counter.update(absValue, tMs);
    const stateAfter = this.counter.getState();
    this.lastSignedValue = signedValue;

    if (!event) {
      if (stateAfter === "ASCENDING") {
        this.trackPeak(absValue, signedValue);
      } else if (stateAfter === "WAITING_FOR_REP_START" && stateBefore !== "DESCENDING") {
        this.clearPeakTracking();
      }
      return null;
    }

    return this.emitEvent(event, signedValue, tMs, absValue);
  }

  private emitEvent(
    event: RepEvent,
    signedValue: number,
    tMs: number,
    absValue: number,
  ): BidirectionalRepEvent {
    // Matches computeLateralNeckTilt / neckSideAgreement.test.ts:
    // positive signed angle -> patient's left, negative -> patient's right.
    const eventSign = this.peakSign !== 0 ? this.peakSign : signedValue >= 0 ? 1 : -1;
    const side: BidirectionalSide = eventSign > 0 ? "left" : "right";
    this.clearPeakTracking();

    this.requiresCompletePeakForNextRep = false;
    this.emittedRepCount += 1;
    this.awaitingRestSettle = true;
    this.postRepGateStartedAtMs = tMs;
    this.restSettledSinceMs =
      absValue <= this.restSettleBand ? tMs : null;

    return {
      side,
      event: {
        ...event,
        index: this.emittedRepCount,
      },
    };
  }

  reset(): void {
    this.counter.reset();
    this.clearPeakTracking();
    this.awaitingRestSettle = false;
    this.restSettledSinceMs = null;
    this.postRepGateStartedAtMs = null;
    this.requiresCompletePeakForNextRep = false;
    this.lastSignedValue = null;
  }

  getRepCount(): number {
    return this.counter.getRepCount();
  }

  getDebugSnapshot(
    tMs?: number,
    signedValue?: number,
  ): BidirectionalRepCounterDebugSnapshot {
    const absValue =
      typeof signedValue === "number" ? Math.abs(signedValue) : null;
    const restSettleElapsedMs =
      typeof tMs === "number" && this.restSettledSinceMs !== null
        ? Math.max(0, tMs - this.restSettledSinceMs)
        : null;
    const postRepGateElapsedMs =
      typeof tMs === "number" && this.postRepGateStartedAtMs !== null
        ? Math.max(0, tMs - this.postRepGateStartedAtMs)
        : null;

    return {
      signedValue: signedValue ?? null,
      absValue,
      isInSettleBand: absValue !== null ? absValue <= this.restSettleBand : null,
      awaitingRestSettle: this.awaitingRestSettle,
      restSettledSinceMs: this.restSettledSinceMs,
      restSettleElapsedMs,
      postRepGateStartedAtMs: this.postRepGateStartedAtMs,
      postRepGateElapsedMs,
      requiresCompletePeakForNextRep: this.requiresCompletePeakForNextRep,
      restSettleMs: this.restSettleMs,
      restSettleBand: this.restSettleBand,
      peakAbs: this.peakAbs,
      peakSign: this.peakSign,
      underlyingState: this.counter.getState(),
      underlyingRepCount: this.counter.getRepCount(),
      emittedRepCount: this.emittedRepCount,
      thresholds: this.thresholds,
      internalRepCompleteThreshold: this.counterThresholds.repCompleteThreshold,
      strategy: "magnitude-settle",
    };
  }

  private hasSettledAtRest(absValue: number, tMs: number): boolean {
    if (absValue > this.restSettleBand) {
      this.restSettledSinceMs = null;
      if (
        this.postRepGateStartedAtMs !== null &&
        tMs - this.postRepGateStartedAtMs >= this.restSettleMs
      ) {
        this.awaitingRestSettle = false;
        this.postRepGateStartedAtMs = null;
        this.requiresCompletePeakForNextRep = true;
        this.clearPeakTracking();
        return true;
      }
      return false;
    }

    if (this.restSettledSinceMs === null) {
      this.restSettledSinceMs = tMs;
      return false;
    }

    if (tMs - this.restSettledSinceMs < this.restSettleMs) {
      return false;
    }

    this.awaitingRestSettle = false;
    this.postRepGateStartedAtMs = null;
    this.requiresCompletePeakForNextRep = false;
    this.clearPeakTracking();
    return true;
  }

  private clearPeakTracking(): void {
    this.peakAbs = 0;
    this.peakSign = 0;
  }

  private trackPeak(absValue: number, signedValue: number): void {
    if (absValue > this.peakAbs) {
      this.peakAbs = absValue;
      this.peakSign = signedValue >= 0 ? 1 : -1;
    }
  }
}
