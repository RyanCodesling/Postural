/**
 * repCounter.ts
 *
 * A pull-based state machine that detects exercise repetitions from a stream
 * of signed angle measurements. One instance counts reps for one direction
 * of motion (e.g. "right shoulder abduction"). Bilateral exercises run two
 * instances independently — see the camera loop for that wiring.
 *
 * ── DESIGN — see project memory for full rationale ───────────────────────────
 *
 * Three states:
 *   WAITING_FOR_REP_START — idle, watching for ascent above startThreshold
 *   ASCENDING             — angle rising; tracking the running peak
 *   DESCENDING            — angle has begun decreasing from its peak
 *
 * Transitions (all triggered by `update(angle, t)`):
 *
 *   WAITING_FOR_REP_START → ASCENDING
 *     when angle >= startThreshold
 *     records: rep start time, resets running peak to current angle
 *
 *   ASCENDING → DESCENDING
 *     when angle has begun decreasing AND running peak >= minimumPeakThreshold
 *     records: peak time and value
 *
 *   ASCENDING → WAITING_FOR_REP_START   (false start)
 *     when angle drops back below startThreshold without ever reaching
 *     minimumPeakThreshold
 *     records: nothing — the attempt is discarded silently
 *
 *   DESCENDING → WAITING_FOR_REP_START   (rep counted)
 *     when angle <= repCompleteThreshold
 *     emits: a RepEvent with full timing, peak, and classification
 *
 * ── HYSTERESIS ───────────────────────────────────────────────────────────────
 * `repCompleteThreshold` is intentionally lower than `startThreshold`. The
 * gap is the hysteresis band — it absorbs jitter at the threshold boundary
 * so a single rep can't be counted twice. The registry enforces
 * repCompleteThreshold < startThreshold.
 *
 * ── DESCENT DETECTION ────────────────────────────────────────────────────────
 * "Angle has begun decreasing" is implemented as: current angle is strictly
 * less than the running peak by at least `descentEpsilon`. Without an epsilon,
 * frame-to-frame noise at the actual peak would flip the state machine into
 * DESCENDING after the very first sample past the true peak, and the recorded
 * peak would be artificially low. With a small epsilon (default 0.5 in metric
 * units), we wait until the descent is real before transitioning.
 *
 * ── REP CLASSIFICATION ───────────────────────────────────────────────────────
 * On rep completion, classification is determined by peak vs. targetROM:
 *   peak >= targetROM             →  "complete"
 *   minimumPeakThreshold ≤ peak < targetROM  →  "partial"
 * The state machine never emits a rep with peak < minimumPeakThreshold —
 * those count as false starts and are discarded.
 *
 * ── PULL API ─────────────────────────────────────────────────────────────────
 * `update(angle, tMs)` is called once per frame. It returns:
 *   - A RepEvent on the frame a rep completes
 *   - null on every other frame
 * The caller is responsible for skipping frames where the angle is null
 * (e.g. landmarks not visible). Don't pass null in here.
 *
 * ── INTENTIONALLY OUT OF SCOPE ───────────────────────────────────────────────
 * - Bilateral coordination: handled by running two RepCounter instances.
 * - Smoothing: angle should already be smoothed by the caller (OneEuroFilter).
 * - Visibility gating: caller decides whether to call update at all.
 * - Sign convention: the state machine assumes the metric increases during
 *   ascent and decreases during descent. For bidirectional exercises like
 *   neck flexion (left tilts negative, right tilts positive), use two
 *   counters fed with the absolute value of one side's range each.
 */

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type RepCounterThresholds = {
  startThreshold: number;
  repCompleteThreshold: number;
  minimumPeakThreshold: number;
  targetROM: number;
};

export type RepClassification = "complete" | "partial";

export type RepEvent = {
  /** Sequential rep index for this counter instance, starting at 1. */
  index: number;
  /** Timestamp when the rep started ascending (ms, performance.now origin). */
  startTimeMs: number;
  /** Timestamp when the rep reached its peak. */
  peakTimeMs: number;
  /** Timestamp when the rep was counted as complete. */
  endTimeMs: number;
  /** Highest angle reached during the rep, in metric units. */
  peakValue: number;
  /** Time from start to peak. */
  ascentDurationMs: number;
  /**
   * Time spent at or near the peak before descent began.
   * Currently approximated as 0 because we transition out of ASCENDING the
   * moment a real descent is detected. A future enhancement could buffer
   * "near-peak" samples and report a hold duration; for now this is a
   * placeholder so the schema is stable.
   */
  holdDurationMs: number;
  /** Time from peak to end of rep. */
  descentDurationMs: number;
  /** Total rep duration (start to end). */
  totalDurationMs: number;
  /** "complete" if peak ≥ targetROM, "partial" otherwise. */
  classification: RepClassification;
};

export type RepCounterOptions = {
  /**
   * Minimum decrease from the running peak before we declare a descent.
   * Defaults to 0.5 — small enough to be barely above landmark noise after
   * smoothing, large enough to avoid spurious peaks during jitter near
   * the true maximum. Tune per metric if needed.
   */
  descentEpsilon?: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// STATE MACHINE
// ─────────────────────────────────────────────────────────────────────────────

type State = "WAITING_FOR_REP_START" | "ASCENDING" | "DESCENDING";

export class RepCounter {
  private state: State = "WAITING_FOR_REP_START";

  private readonly thresholds: RepCounterThresholds;
  private readonly descentEpsilon: number;

  // Per-rep tracking; reset on each transition out of WAITING_FOR_REP_START.
  private repStartTimeMs = 0;
  private peakValue = -Infinity;
  private peakTimeMs = 0;

  // Cumulative count of reps completed by this instance.
  private repIndex = 0;

  // ── CONTINUITY GATE ────────────────────────────────────────────────────
  // Tracks whether the arm has been observed at rest recently. Required for
  // the WAITING → ASCENDING transition to fire. Cleared when a long gap
  // between update() calls indicates we lost track of the arm (the caller
  // skips update() when the metric returns null, so cross-body excursions
  // and visibility dropouts both produce gaps).
  private lastUpdateTimeMs = 0;
  private armAtRest = false;
  private static readonly REST_GAP_THRESHOLD_MS = 300;

  constructor(thresholds: RepCounterThresholds, options: RepCounterOptions = {}) {
    // Defensive validation — the registry validates this too, but instances
    // can be constructed directly for tests, so check here as well.
    if (thresholds.repCompleteThreshold >= thresholds.startThreshold) {
      throw new Error(
        `RepCounter: repCompleteThreshold (${thresholds.repCompleteThreshold}) ` +
        `must be < startThreshold (${thresholds.startThreshold}).`
      );
    }
    if (thresholds.startThreshold >= thresholds.minimumPeakThreshold) {
      throw new Error(
        `RepCounter: startThreshold (${thresholds.startThreshold}) ` +
        `must be < minimumPeakThreshold (${thresholds.minimumPeakThreshold}).`
      );
    }
    if (thresholds.minimumPeakThreshold > thresholds.targetROM) {
      throw new Error(
        `RepCounter: minimumPeakThreshold (${thresholds.minimumPeakThreshold}) ` +
        `must be ≤ targetROM (${thresholds.targetROM}).`
      );
    }

    this.thresholds = thresholds;
    this.descentEpsilon = options.descentEpsilon ?? 0.5;
  }

  /**
   * Feed one frame's angle measurement. Returns a RepEvent on the frame a
   * rep completes, or null otherwise. Do not call with null/NaN angles.
   */
  update(angle: number, tMs: number): RepEvent | null {
    // Continuity check. A long gap since the last update means the caller
    // stopped feeding us — either the metric returned null (cross-body region,
    // landmark below visibility threshold) or the camera loop hiccuped. In
    // either case, we no longer know the arm's position, so any prior "at rest"
    // observation is stale.
    if (
      this.lastUpdateTimeMs !== 0 &&
      tMs - this.lastUpdateTimeMs > RepCounter.REST_GAP_THRESHOLD_MS
    ) {
      this.armAtRest = false;
    }
    this.lastUpdateTimeMs = tMs;

    // Refresh the "arm at rest" flag whenever we see a low value. This is the
    // gate condition for starting a new rep — see handleWaiting.
    if (angle < this.thresholds.startThreshold) {
      this.armAtRest = true;
    }

    switch (this.state) {
      case "WAITING_FOR_REP_START":
        return this.handleWaiting(angle, tMs);
      case "ASCENDING":
        return this.handleAscending(angle, tMs);
      case "DESCENDING":
        return this.handleDescending(angle, tMs);
    }
  }

  /**
   * Force the state machine back to WAITING_FOR_REP_START, discarding any
   * in-progress rep. Use this when capture readiness drops or the patient
   * switches exercise. Does NOT reset repIndex — that's lifetime-of-instance.
   */
  reset(): void {
    this.state = "WAITING_FOR_REP_START";
    this.peakValue = -Infinity;
    this.peakTimeMs = 0;
    this.repStartTimeMs = 0;
    // Continuity state — after a reset (capture drop, exercise switch), we
    // don't know the arm's position. The next rep can only start once we've
    // seen fresh rest evidence.
    this.lastUpdateTimeMs = 0;
    this.armAtRest = false;
  }

  /** Total reps emitted by this instance (complete + partial). */
  getRepCount(): number {
    return this.repIndex;
  }

  /** Current internal state — useful for debugging and tests. */
  getState(): State {
    return this.state;
  }

  // ── Per-state handlers ──────────────────────────────────────────────────

  private handleWaiting(angle: number, tMs: number): RepEvent | null {
    if (angle >= this.thresholds.startThreshold) {
      // Continuity gate. Refuse to start a rep unless the arm has been observed
      // at rest within the recent past. This blocks the bogus trajectory where
      // the arm sweeps cross-body → overhead → back to rest via the lateral
      // side: the metric returns null during cross-body, producing a gap that
      // clears armAtRest. When the metric resumes at a high lateral value, the
      // state machine refuses the would-be ascent.
      if (!this.armAtRest) {
        return null;
      }
      // Begin a new rep attempt.
      this.state = "ASCENDING";
      this.repStartTimeMs = tMs;
      this.peakValue = angle;
      this.peakTimeMs = tMs;
      this.armAtRest = false; // must return to rest before counting another rep
    }
    return null;
  }

  private handleAscending(angle: number, tMs: number): RepEvent | null {
    // Track the running peak. The largest value seen so far is the peak,
    // regardless of whether we've started descending — we only commit to
    // DESCENDING when the descent is real (see below).
    if (angle > this.peakValue) {
      this.peakValue = angle;
      this.peakTimeMs = tMs;
    }

    // False-start exit: if angle drops back below the start threshold and
    // we never reached minimumPeakThreshold, discard the attempt entirely.
    if (
      angle < this.thresholds.startThreshold &&
      this.peakValue < this.thresholds.minimumPeakThreshold
    ) {
      this.reset();
      return null;
    }

    // Descent detection: angle is strictly below the running peak by more
    // than descentEpsilon, AND the peak is real (≥ minimumPeakThreshold).
    // Both conditions must hold.
    if (
      this.peakValue >= this.thresholds.minimumPeakThreshold &&
      angle < this.peakValue - this.descentEpsilon
    ) {
      this.state = "DESCENDING";
    }

    return null;
  }

  private handleDescending(angle: number, tMs: number): RepEvent | null {
    if (angle <= this.thresholds.repCompleteThreshold) {
      // Rep complete. Build the event before resetting state.
      this.repIndex += 1;

      const ascentDurationMs = this.peakTimeMs - this.repStartTimeMs;
      const descentDurationMs = tMs - this.peakTimeMs;
      const totalDurationMs = tMs - this.repStartTimeMs;

      const classification: RepClassification =
        this.peakValue >= this.thresholds.targetROM ? "complete" : "partial";

      const event: RepEvent = {
        index: this.repIndex,
        startTimeMs: this.repStartTimeMs,
        peakTimeMs: this.peakTimeMs,
        endTimeMs: tMs,
        peakValue: this.peakValue,
        ascentDurationMs,
        holdDurationMs: 0, // see schema note in RepEvent docstring
        descentDurationMs,
        totalDurationMs,
        classification,
      };

      // Return to idle. We don't call this.reset() here because reset() also
      // wipes peakValue/peakTimeMs which we might want to inspect later for
      // debugging — but since they get re-initialized on the next ASCENDING
      // entry anyway, calling reset() is fine. Done explicitly for clarity:
      this.state = "WAITING_FOR_REP_START";
      this.peakValue = -Infinity;
      this.peakTimeMs = 0;
      this.repStartTimeMs = 0;

      return event;
    }
    return null;
  }
}