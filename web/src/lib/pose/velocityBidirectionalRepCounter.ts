import {
  type BidirectionalRepCounterDebugSnapshot,
  type BidirectionalRepEvent,
  type BidirectionalSide,
} from "./bidirectionalRepCounter";
import {
  type RepCounterOptions,
  type RepCounterThresholds,
  type RepEvent,
} from "./repCounter";

type VelocitySign = -1 | 0 | 1;
type StrokePhase = "WAITING_FOR_LAUNCH" | "ASCENDING" | "RETURNING";

export type VelocityBidirectionalRepCounterOptions = RepCounterOptions & {
  activeVelocityDegPerSec?: number;
  restVelocityDegPerSec?: number;
  restAngleThreshold?: number;
  minStrokePeakDeg?: number;
  minStrokeExcursionDeg?: number;
  minStrokeDurationMs?: number;
};

const DEFAULT_ACTIVE_VELOCITY_DEG_PER_SEC = 15;
const DEFAULT_REST_VELOCITY_DEG_PER_SEC = 15;
const DEFAULT_MIN_STROKE_DURATION_MS = 66;
const DEFAULT_REST_ANGLE_DEG = 8;
const DEFAULT_MIN_STROKE_EXCURSION_DEG = 8;
const REST_ANGLE_EPSILON = 0.001;

/**
 * Signed bidirectional rep detector for small-range motions such as ex_004
 * neck lateral flexion. Unlike BidirectionalRepCounter, this class does not
 * separate alternating reps by exact neutral dwell. A new stroke must first be
 * armed by a low-angle, low-velocity transition, then launched by directed
 * velocity away from neutral. Passive return-stroke overshoot crosses neutral
 * with sustained velocity, so it never arms a new opposite-side stroke.
 */
export class VelocityBidirectionalRepCounter {
  private readonly thresholds: RepCounterThresholds;
  private readonly activeVelocityDegPerSec: number;
  private readonly restVelocityDegPerSec: number;
  private readonly restAngleThreshold: number;
  private readonly minStrokePeakDeg: number;
  private readonly minStrokeExcursionDeg: number;
  private readonly minStrokeDurationMs: number;

  private phase: StrokePhase = "WAITING_FOR_LAUNCH";
  private armedForStroke = false;
  private armedRestAbs: number | null = null;
  private repIndex = 0;

  private strokeSign: VelocitySign = 0;
  private repStartTimeMs = 0;
  private peakAbs = 0;
  private peakSign: VelocitySign = 0;
  private peakTimeMs = 0;
  private descentStartTimeMs = 0;

  private lastSignedValue: number | null = null;
  private lastUpdateTimeMs: number | null = null;
  private lastVelocityDegPerSec: number | null = null;
  private lastVelocitySign: VelocitySign = 0;

  constructor(
    thresholds: RepCounterThresholds,
    options: VelocityBidirectionalRepCounterOptions = {},
  ) {
    if (thresholds.repCompleteThreshold >= thresholds.startThreshold) {
      throw new Error(
        `VelocityBidirectionalRepCounter: repCompleteThreshold ` +
        `(${thresholds.repCompleteThreshold}) must be < startThreshold ` +
        `(${thresholds.startThreshold}).`,
      );
    }
    if (thresholds.startThreshold >= thresholds.minimumPeakThreshold) {
      throw new Error(
        `VelocityBidirectionalRepCounter: startThreshold ` +
        `(${thresholds.startThreshold}) must be < minimumPeakThreshold ` +
        `(${thresholds.minimumPeakThreshold}).`,
      );
    }
    if (thresholds.minimumPeakThreshold > thresholds.targetROM) {
      throw new Error(
        `VelocityBidirectionalRepCounter: minimumPeakThreshold ` +
        `(${thresholds.minimumPeakThreshold}) must be <= targetROM ` +
        `(${thresholds.targetROM}).`,
      );
    }

    const restAngleThreshold =
      options.restAngleThreshold ??
      Math.max(
        thresholds.startThreshold,
        Math.min(
          DEFAULT_REST_ANGLE_DEG,
          thresholds.minimumPeakThreshold - REST_ANGLE_EPSILON,
        ),
      );
    if (restAngleThreshold < thresholds.repCompleteThreshold) {
      throw new Error(
        `VelocityBidirectionalRepCounter: restAngleThreshold ` +
        `(${restAngleThreshold}) must be >= repCompleteThreshold ` +
        `(${thresholds.repCompleteThreshold}).`,
      );
    }
    if (restAngleThreshold >= thresholds.minimumPeakThreshold) {
      throw new Error(
        `VelocityBidirectionalRepCounter: restAngleThreshold ` +
        `(${restAngleThreshold}) must be < minimumPeakThreshold ` +
        `(${thresholds.minimumPeakThreshold}).`,
      );
    }

    this.thresholds = thresholds;
    this.activeVelocityDegPerSec =
      options.activeVelocityDegPerSec ?? DEFAULT_ACTIVE_VELOCITY_DEG_PER_SEC;
    this.restVelocityDegPerSec =
      options.restVelocityDegPerSec ?? DEFAULT_REST_VELOCITY_DEG_PER_SEC;
    this.restAngleThreshold = restAngleThreshold;
    this.minStrokePeakDeg = Math.max(
      thresholds.minimumPeakThreshold,
      options.minStrokePeakDeg ?? thresholds.minimumPeakThreshold,
    );
    this.minStrokeExcursionDeg =
      options.minStrokeExcursionDeg ?? DEFAULT_MIN_STROKE_EXCURSION_DEG;
    this.minStrokeDurationMs =
      options.minStrokeDurationMs ?? DEFAULT_MIN_STROKE_DURATION_MS;

    if (this.activeVelocityDegPerSec <= 0) {
      throw new Error(
        `VelocityBidirectionalRepCounter: activeVelocityDegPerSec ` +
        `(${this.activeVelocityDegPerSec}) must be > 0.`,
      );
    }
    if (this.restVelocityDegPerSec <= 0) {
      throw new Error(
        `VelocityBidirectionalRepCounter: restVelocityDegPerSec ` +
        `(${this.restVelocityDegPerSec}) must be > 0.`,
      );
    }
    if (this.minStrokeDurationMs < 0) {
      throw new Error(
        `VelocityBidirectionalRepCounter: minStrokeDurationMs ` +
        `(${this.minStrokeDurationMs}) must be >= 0.`,
      );
    }
    if (this.minStrokePeakDeg > thresholds.targetROM) {
      throw new Error(
        `VelocityBidirectionalRepCounter: minStrokePeakDeg ` +
        `(${this.minStrokePeakDeg}) must be <= targetROM ` +
        `(${thresholds.targetROM}).`,
      );
    }
    if (this.minStrokeExcursionDeg < 0) {
      throw new Error(
        `VelocityBidirectionalRepCounter: minStrokeExcursionDeg ` +
        `(${this.minStrokeExcursionDeg}) must be >= 0.`,
      );
    }
  }

  update(
    signedValue: number,
    tMs: number,
    velocityDegPerSec?: number,
  ): BidirectionalRepEvent | null {
    const velocity = this.resolveVelocity(signedValue, tMs, velocityDegPerSec);
    const velocitySign = this.toVelocitySign(velocity);
    const absValue = Math.abs(signedValue);

    let event: BidirectionalRepEvent | null = null;
    switch (this.phase) {
      case "WAITING_FOR_LAUNCH":
        event = this.handleWaiting(signedValue, absValue, velocity, velocitySign, tMs);
        break;
      case "ASCENDING":
        event = this.handleAscending(signedValue, absValue, velocity, velocitySign, tMs);
        break;
      case "RETURNING":
        event = this.handleReturning(signedValue, absValue, velocity, velocitySign, tMs);
        break;
    }

    this.lastSignedValue = signedValue;
    this.lastUpdateTimeMs = tMs;
    this.lastVelocityDegPerSec = velocity;
    this.lastVelocitySign = velocitySign;
    return event;
  }

  reset(): void {
    this.phase = "WAITING_FOR_LAUNCH";
    this.armedForStroke = false;
    this.armedRestAbs = null;
    this.clearStrokeTracking();
    this.lastSignedValue = null;
    this.lastUpdateTimeMs = null;
    this.lastVelocityDegPerSec = null;
    this.lastVelocitySign = 0;
  }

  getRepCount(): number {
    return this.repIndex;
  }

  getDebugSnapshot(
    tMs?: number,
    signedValue?: number,
  ): BidirectionalRepCounterDebugSnapshot {
    const absValue =
      typeof signedValue === "number" ? Math.abs(signedValue) : null;
    return {
      signedValue: signedValue ?? null,
      absValue,
      isInSettleBand:
        absValue !== null ? absValue <= this.restAngleThreshold : null,
      awaitingRestSettle: false,
      restSettledSinceMs: this.armedForStroke ? this.lastUpdateTimeMs : null,
      restSettleElapsedMs:
        typeof tMs === "number" &&
        this.armedForStroke &&
        this.lastUpdateTimeMs !== null
          ? Math.max(0, tMs - this.lastUpdateTimeMs)
          : null,
      postRepGateStartedAtMs: null,
      postRepGateElapsedMs: null,
      requiresCompletePeakForNextRep: !this.armedForStroke,
      restSettleMs: 0,
      restSettleBand: this.restAngleThreshold,
      peakAbs: this.peakAbs,
      peakSign: this.peakSign,
      underlyingState: this.phase,
      underlyingRepCount: this.repIndex,
      emittedRepCount: this.repIndex,
      thresholds: this.thresholds,
      internalRepCompleteThreshold: this.thresholds.repCompleteThreshold,
      strategy: "velocity-zero-crossing",
      velocityDegPerSec: this.lastVelocityDegPerSec,
      velocitySign: this.lastVelocitySign,
      armedForStroke: this.armedForStroke,
      strokePhase: this.phase,
      activeVelocityDegPerSec: this.activeVelocityDegPerSec,
      restVelocityDegPerSec: this.restVelocityDegPerSec,
      restAngleThreshold: this.restAngleThreshold,
      minStrokePeakDeg: this.minStrokePeakDeg,
      minStrokeExcursionDeg: this.minStrokeExcursionDeg,
      armedRestAbs: this.armedRestAbs,
    };
  }

  private handleWaiting(
    signedValue: number,
    absValue: number,
    velocity: number,
    velocitySign: VelocitySign,
    tMs: number,
  ): null {
    if (this.canArmAt(absValue, velocity)) {
      this.armAt(absValue);
    }

    if (!this.armedForStroke) return null;

    const direction = this.directedLaunchSign(signedValue, absValue, velocitySign);
    if (direction === 0) return null;

    this.phase = "ASCENDING";
    this.armedForStroke = false;
    this.strokeSign = direction;
    this.repStartTimeMs = tMs;
    this.peakAbs = absValue;
    this.peakSign = signedValue >= 0 ? 1 : -1;
    this.peakTimeMs = tMs;
    this.descentStartTimeMs = 0;
    return null;
  }

  private handleAscending(
    signedValue: number,
    absValue: number,
    velocity: number,
    velocitySign: VelocitySign,
    tMs: number,
  ): BidirectionalRepEvent | null {
    this.trackPeak(signedValue, absValue, tMs);

    if (this.canArmAt(absValue, velocity) && !this.hasMinimumStrokeExcursion()) {
      this.discardStroke();
      this.armAt(absValue);
      return null;
    }

    if (
      absValue < this.thresholds.startThreshold &&
      this.peakAbs < this.minStrokePeakDeg
    ) {
      this.discardStroke();
      return null;
    }

    const strokeDurationMs = tMs - this.repStartTimeMs;
    if (
      this.peakAbs >= this.minStrokePeakDeg &&
      this.hasMinimumStrokeExcursion() &&
      strokeDurationMs >= this.minStrokeDurationMs &&
      velocitySign === -this.strokeSign
    ) {
      this.phase = "RETURNING";
      this.descentStartTimeMs = tMs;
    }

    return null;
  }

  private handleReturning(
    signedValue: number,
    absValue: number,
    velocity: number,
    velocitySign: VelocitySign,
    tMs: number,
  ): BidirectionalRepEvent | null {
    if (velocitySign === this.strokeSign && absValue > this.peakAbs) {
      this.phase = "ASCENDING";
      this.trackPeak(signedValue, absValue, tMs);
      this.descentStartTimeMs = 0;
      return null;
    }

    if (
      absValue <= this.thresholds.repCompleteThreshold ||
      this.canArmAt(absValue, velocity)
    ) {
      return this.emitEvent(absValue, velocity, tMs);
    }

    return null;
  }

  private emitEvent(
    absValue: number,
    velocity: number,
    tMs: number,
  ): BidirectionalRepEvent {
    this.repIndex += 1;
    const descentStartTimeMs =
      this.descentStartTimeMs > 0 ? this.descentStartTimeMs : this.peakTimeMs;
    const classification: RepEvent["classification"] =
      this.peakAbs >= this.thresholds.targetROM ? "complete" : "partial";
    const side: BidirectionalSide = this.peakSign > 0 ? "left" : "right";
    const event: RepEvent = {
      index: this.repIndex,
      startTimeMs: this.repStartTimeMs,
      peakTimeMs: this.peakTimeMs,
      endTimeMs: tMs,
      peakValue: this.peakAbs,
      ascentDurationMs: this.peakTimeMs - this.repStartTimeMs,
      holdDurationMs: descentStartTimeMs - this.peakTimeMs,
      descentDurationMs: tMs - descentStartTimeMs,
      totalDurationMs: tMs - this.repStartTimeMs,
      classification,
    };

    this.phase = "WAITING_FOR_LAUNCH";
    this.clearStrokeTracking();
    this.armedRestAbs = null;
    if (this.canArmAt(absValue, velocity)) {
      this.armAt(absValue);
    } else {
      this.armedForStroke = false;
      this.armedRestAbs = null;
    }
    return { side, event };
  }

  private discardStroke(): void {
    this.phase = "WAITING_FOR_LAUNCH";
    this.clearStrokeTracking();
    this.armedForStroke = false;
    this.armedRestAbs = null;
  }

  private clearStrokeTracking(): void {
    this.strokeSign = 0;
    this.repStartTimeMs = 0;
    this.peakAbs = 0;
    this.peakSign = 0;
    this.peakTimeMs = 0;
    this.descentStartTimeMs = 0;
  }

  private armAt(absValue: number): void {
    this.armedForStroke = true;
    this.armedRestAbs =
      this.armedRestAbs === null ? absValue : Math.min(this.armedRestAbs, absValue);
  }

  private hasMinimumStrokeExcursion(): boolean {
    const restAbs = this.armedRestAbs ?? 0;
    return this.peakAbs - restAbs >= this.minStrokeExcursionDeg;
  }

  private trackPeak(signedValue: number, absValue: number, tMs: number): void {
    if (absValue > this.peakAbs) {
      this.peakAbs = absValue;
      this.peakSign = signedValue >= 0 ? 1 : -1;
      this.peakTimeMs = tMs;
    }
  }

  private canArmAt(absValue: number, velocity: number): boolean {
    return (
      absValue <= this.restAngleThreshold &&
      Math.abs(velocity) <= this.restVelocityDegPerSec
    );
  }

  private directedLaunchSign(
    signedValue: number,
    absValue: number,
    velocitySign: VelocitySign,
  ): VelocitySign {
    if (absValue < this.thresholds.startThreshold) return 0;
    if (velocitySign === 0) return 0;

    const positionSign: VelocitySign = signedValue >= 0 ? 1 : -1;
    return positionSign === velocitySign ? positionSign : 0;
  }

  private resolveVelocity(
    signedValue: number,
    tMs: number,
    velocityDegPerSec?: number,
  ): number {
    if (
      typeof velocityDegPerSec === "number" &&
      Number.isFinite(velocityDegPerSec)
    ) {
      return velocityDegPerSec;
    }
    if (this.lastSignedValue === null || this.lastUpdateTimeMs === null) {
      return 0;
    }
    const dtSec = Math.max((tMs - this.lastUpdateTimeMs) / 1000, 1e-6);
    return (signedValue - this.lastSignedValue) / dtSec;
  }

  private toVelocitySign(velocity: number): VelocitySign {
    if (velocity > this.activeVelocityDegPerSec) return 1;
    if (velocity < -this.activeVelocityDegPerSec) return -1;
    return 0;
  }
}
