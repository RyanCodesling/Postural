/**
 * registry.ts
 *
 * Per-exercise definitions that drive rep counting, metric display, and
 * compensation tracking. Keyed by exercise IDs that match the PostgreSQL
 * `exercises` seed data (six active definitions plus two deprecated entries).
 * Runtime prescriptions and history join to this fixed registry by id.
 *
 * ── WHY THIS IS CODE, NOT DATA ───────────────────────────────────────────────
 * Thresholds are part of the rep-counting algorithm. They warrant code review,
 * git history, and methodology citations in the writeup. Storing them in the
 * database would imply mutability that doesn't exist for this fixed,
 * proof-of-concept exercise set, and would let non-experts edit biomechanical
 * parameters through a web form.
 *
 * ── HOW THE STATE MACHINE READS THIS ─────────────────────────────────────────
 * For a `dynamic` exercise, the state machine reads `primaryMetric.thresholds`:
 *   - `startThreshold`         — angle above which ascent begins
 *   - `repCompleteThreshold`   — angle below which a rep is counted on descent
 *                                (must be < startThreshold; the gap is the
 *                                hysteresis band that prevents jitter-induced
 *                                double counts; ~10–20° works well)
 *   - `minimumPeakThreshold`   — DISCARD FLOOR. Peaks below this are silently
 *                                dropped as false starts — NO rep counted at all.
 *                                Peaks ≥ minimumPeakThreshold count as at least
 *                                "partial"; ≥ targetROM count as "complete."
 *                                (Fixed 2026-05-21 — earlier doc here said this
 *                                was the partial/complete boundary, which is
 *                                wrong; that boundary is `targetROM`. See
 *                                the classification comments in repCounter.ts and the
 *                                ex_001 inline comment for the authoritative
 *                                semantics.)
 *   - `targetROM`              — clinically prescribed full ROM. THIS is the
 *                                "complete" vs "partial" classification boundary:
 *                                peak ≥ targetROM             → "complete";
 *                                minimumPeakThreshold ≤ peak < targetROM → "partial";
 *                                peak < minimumPeakThreshold  → discarded silently.
 *
 * For an `isometric` exercise, the state machine is NOT used. Instead, the
 * camera loop accumulates time-in-target-band using `isometric.targetBand` —
 * per limb for per-limb isometrics (ex_006), or per sign-attributed side for
 * bidirectional-alternating isometrics (ex_004).
 *
 * ── COMPENSATION METRICS ─────────────────────────────────────────────────────
 * Listed metrics are displayed alongside the primary metric and logged per
 * frame, but do NOT drive rep counting. They flag movement-quality issues
 * (e.g., trunk lean during arm raises) that a therapist would want to see
 * but that shouldn't gate rep classification.
 *
 * ── BILATERAL ────────────────────────────────────────────────────────────────
 * When `bilateral: true`, the camera loop instantiates two independent state
 * machines — one per side — and surfaces left, right, and paired rep counts
 * separately. Asymmetry between left and right is itself clinically meaningful
 * (per project memory) and must not be averaged away.
 *
 * ── THRESHOLD CALIBRATION STATUS ─────────────────────────────────────────────
 * All thresholds in this file are defensible starting values grounded in
 * clinical ROM literature for healthy adults. They are NOT pilot-calibrated.
 * Pilot recordings during the testing phase (per the proposal calendar,
 * Aug–Nov 2026) should be used to refine these values. Each threshold is
 * marked with a citation or rationale comment.
 */

// ─────────────────────────────────────────────────────────────────────────────
// METRIC NAMES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Names of all metrics the system can compute. Some are implemented in
 * `poseMetrics.ts` today (neckTilt, shoulderSymmetry, trunkLean); others
 * are referenced by the registry but stubbed in `poseMetrics.ts` until
 * their math is written. The string union here is the contract — a new
 * metric must be added to this union, the registry, AND the metric
 * computation in `poseMetrics.ts` to be usable end-to-end.
 */
export type MetricName =
  | "shoulderAbduction"      // arm out to the side, used by ex_001 lateral arm raise + ex_008 wall angels
  | "shoulderFlexion"        // arm forward/overhead, used by ex_002 (DEPRECATED 2026-05-21, kept for back-compat)
  | "scapularElevation"      // shoulder-to-ear vertical distance, used by ex_003 (DEPRECATED 2026-05-21, kept for back-compat) + compensation on ex_001/ex_006 only; ex_007/ex_008 deferred pending compensation-baseline capture
  | "neckLateralFlexion"     // head tilting ear-to-shoulder, used by ex_004 neck lateral flexion
  | "trunkLateralFlexion"    // torso side-bending, used by ex_005 standing side bends
  | "shoulderHorizAbd"       // arm held at 90° abduction (T-pose), used by ex_006 isometric hold
  | "trunkLean"              // existing — used as compensation metric on ex_001/ex_004/ex_006/ex_007/ex_008 (NOT ex_005 — side bends score neckTilt + scapularElevation instead)
  | "shoulderSymmetry"       // existing — used as compensation metric on ex_001/ex_006 (and deprecated ex_003; removed from ex_004 2026-06-11 — sloped shoulders are prescribed technique in the assisted stretch)
  | "neckTilt"               // existing — used as compensation metric on ex_005
  | "elbowFlexion"           // NEW 2026-05-21 — compensation on ex_007 + ex_008 (interior-angle convention: 180° = straight, ~30° = fully bent)
  | "wristShoulderVertical"  // NEW 2026-05-21 — primary metric for ex_007 overhead shoulder press (trunk-normalized; negatives legal at rest)
  | "shoulderElbowDistance"; // NEW 2026-05-21 — retained for future Wall Angels variants; removed from active ex_008 v1 compensation after live testing showed 2D foreshortening was too noisy

// ─────────────────────────────────────────────────────────────────────────────
// REGISTRY TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type Side = "left" | "right";


/**
 * How a bilateral exercise distributes work between sides.
 *
 * "per-limb": Two limbs work in parallel and are tracked independently.
 *   Camera loop runs ONE state machine per side, each fed its own
 *   per-side signed angle. Examples: lateral arm raise, overhead arm
 *   raise, shoulder shrug, T-pose hold.
 *
 * "bidirectional-alternating": One bidirectional motion on a single signed
 *   scale (positive = patient's LEFT, negative = patient's RIGHT — the sign
 *   convention pinned by neckSideAgreement.test.ts / trunkSideAgreement.test.ts).
 *   Patient alternates sides. For a DYNAMIC exercise (ex_005) the camera loop
 *   runs ONE state machine fed the ABSOLUTE value of the signed angle, with
 *   the sign at peak time recorded separately so each rep can be tagged left
 *   or right. For an ISOMETRIC exercise (ex_004) no state machine runs; the
 *   camera loop accrues time-in-band PER SIDE from the sign of the angle —
 *   see the ex_004 entry for the band semantics.
 *
 * Unilateral exercises (bilateral: false) ignore this field.
 */
export type BilateralMode = "per-limb" | "bidirectional-alternating";

export type BidirectionalRepStrategy =
  | "magnitude-settle"
  | "velocity-zero-crossing";


/**
 * Thresholds for the dynamic rep-counting state machine.
 * All values are in the unit of the metric being measured (degrees for
 * angle metrics, normalized torso-lengths for displacement metrics like
 * scapularElevation).
 *
 * INVARIANTS (enforced by `validateRegistry()` below):
 *   repCompleteThreshold < startThreshold
 *   startThreshold       < minimumPeakThreshold
 *   minimumPeakThreshold ≤ targetROM
 */
export type RepThresholds = {
  startThreshold: number;
  repCompleteThreshold: number;
  minimumPeakThreshold: number;
  targetROM: number;
};

/**
 * The metric that drives rep counting (or, for isometrics, the metric whose
 * value is checked against the target band).
 *
 * For unilateral exercises, `side` selects which body side to read.
 * For bilateral exercises, `side` is omitted; the camera loop runs two
 * state machines and reads the metric for both sides independently.
 */
export type PrimaryMetricSpec = {
  name: MetricName;
  side?: Side;
  thresholds: RepThresholds;
  /**
   * Override for the rep counter's descent-confirmation epsilon. Used for
   * metrics whose dynamic range is much smaller than the default `0.5`
   * (e.g. `scapularElevation` in normalized torso-length units). Must be
   * < repCompleteThreshold — enforced in validateRegistry().
   */
  descentEpsilon?: number;
  /**
   * When true, the camera loop captures a per-side resting baseline at the
   * start of the exercise and feeds the rep counter `baseline - rawProjection`
   * instead of the raw metric. Required for `scapularElevation` whose raw
   * value is a positive absolute distance and decreases during a shrug —
   * the registry's thresholds expect a positive delta that increases.
   */
  requiresBaselineCapture?: boolean;
  /**
   * OneEuroFilter parameters for the per-side rep-counting stream of this
   * metric. Falls back to the global default `(minCutoff=1.0, beta=0.1)`
   * (tuned for degree-scale angles) when omitted. Override when the metric
   * lives on a much smaller numeric scale and needs heavier at-rest
   * smoothing — e.g. `scapularElevation` in normalized torso-length units.
   */
  smoothing?: {
    minCutoff: number;
    beta: number;
    dCutoff?: number;
  };
};

/**
 * How a compensation metric contributes to the 0–100 compensation score.
 *
 *  - "off":    warning-only. The metric still drives its UI warning via
 *              `warningThreshold`, but it never deducts from the score and
 *              never dilutes the weighting of scored metrics. Use for
 *              metrics whose deduction semantics aren't settled yet (e.g.
 *              `elbowFlexion`, which needs direction-aware deduction tuned
 *              from live data before it can score fairly).
 *  - "static": deduction from `|value|` against the metric's
 *              `COMPENSATION_BANDS` entry. The default and the long-standing
 *              behavior.
 *  - "primary-coupled": the expected value of this metric moves with the
 *              primary metric (e.g. the shoulder girdle necessarily elevates
 *              as the arm abducts toward 90°). The deduction runs on the
 *              RESIDUAL `|value − (intercept + slopePerPrimaryUnit·|primary|)|`
 *              against the same bands, so movement that is an intrinsic
 *              consequence of correct execution is not punished. Constants
 *              must be fitted from recorded clean repetitions or taken from
 *              published biomechanics — record which via `source`.
 *
 * When `scoring` is omitted on a `CompensationMetricSpec` it defaults to
 * `{ mode: "static" }` — see `getCompensationScoring()`.
 */
export type CompensationScoring =
  | { mode: "off" }
  | { mode: "static" }
  | {
      mode: "primary-coupled";
      /** Expected metric value when the primary metric reads 0 (≈ resting baseline). */
      intercept: number;
      /** Expected drift in this metric per unit of |primary| (same units as each metric). */
      slopePerPrimaryUnit: number;
      /** Where the constants came from — keeps every scoring constant traceable. */
      source: "pilot-fit" | "literature";
    };

/**
 * A metric displayed and logged but NOT used for rep counting.
 * `warningThreshold` is the value at which the UI flags the metric as
 * a likely compensation pattern. Same units as the underlying metric.
 *
 * `compareDirection` controls which side of `warningThreshold` triggers
 * the flag:
 *   - `"above"` (DEFAULT): flag when `Math.abs(value) >= warningThreshold`.
 *     Use when the metric's "good" reading is near zero and HIGHER values
 *     indicate worse compensation (the typical case: trunkLean, neckTilt,
 *     shoulderSymmetry, scapularElevation-as-compensation).
 *   - `"below"`: flag when `value < warningThreshold`. Use when the
 *     metric's "good" reading is HIGH and LOWER values indicate worse
 *     compensation. Examples added 2026-05-21: `elbowFlexion` (interior-
 *     angle convention, 180° = straight = good; warn when bent below
 *     `warningThreshold`) and `shoulderElbowDistance` (foreshortening
 *     signal, ~0.5 = on-wall = good; warn when ratio drops below
 *     `warningThreshold` = elbow rotating off the wall).
 *
 * Why this exists: prior to 2026-05-21 every compensation metric had
 * "higher = worse" semantics, so the UI's `Math.abs(value) >=
 * warningThreshold` check was sufficient. The EX_SWAP additions
 * introduced compensation metrics where LOWER is worse (anatomically
 * straight vs bent / on-wall vs off-wall), which the single-direction
 * logic could not express. Defaulting to "above" preserves existing
 * behavior for all pre-2026-05-21 compensation declarations.
 */
/**
 * The coaching cue for one compensation metric on one exercise.
 *
 * Only ONE cue is surfaced at a time — `web/src/lib/pose/coachingCue.ts` picks
 * it from the already-latched warnings. This declaration supplies the data that
 * arbitration needs; it holds no thresholds and does not decide whether a
 * compensation is present.
 *
 * `id` must be unique across the whole registry (enforced by
 * `validateRegistry()`), so a logged decision identifies its exercise and
 * metric without a join. Use `<exerciseId>.<metric-in-kebab-case>`.
 *
 * `priority` orders simultaneous cues, LOWEST NUMBER FIRST. The values in this
 * file restate the order the compensation metrics are already declared in,
 * which each exercise's comments reason about ("textbook compensation",
 * "second-most-common"). Ties fall to the larger threshold-normalized excess.
 *
 * `message` is patient-facing wording. It is carried through the selector and
 * the shadow log but is NOT rendered yet — the canvas overlay keeps its
 * existing labels until a clinician has reviewed these strings. Both the
 * wording and the priority ordering are ENGINEERING DEFAULTS pending that
 * review; neither is a clinical parameter.
 *
 * The timing fields override the selector's defaults for this cue alone. They
 * are display-behaviour values in milliseconds, not clinical durations:
 *   - `minActiveMs`  how long the warning must stay latched before the cue may
 *                    appear (on top of the latch's own debounce)
 *   - `minDisplayMs` how long the cue keeps the slot before a higher-priority
 *                    cue may replace it
 *   - `cooldownMs`   how long the cue stays out of the running after it clears
 */
export type CompensationCueSpec = {
  id: string;
  message: string;
  priority: number;
  minActiveMs?: number;
  minDisplayMs?: number;
  cooldownMs?: number;
};

export type CompensationMetricSpec = {
  name: MetricName;
  warningThreshold: number;
  compareDirection?: "above" | "below";
  /**
   * Coaching-cue declaration for this metric on this exercise. Optional: a
   * metric without one still warns, using a synthesized fallback cue at the
   * lowest priority (see `resolveCoachingCue`), so adding a compensation
   * metric can never silently remove its patient-visible warning.
   */
  cue?: CompensationCueSpec;
  /**
   * When true, this compensation is only meaningful at the PEAK of the
   * movement, so its warning must NOT surface during the rest of the rep.
   *
   * Why this exists: most compensation metrics measure a deviation from
   * neutral (trunkLean, scapularElevation, neckTilt, shoulderSymmetry) and
   * are "bad" at any phase, so the per-frame `warningThreshold` check is
   * always valid. But `elbowFlexion` on the overhead exercises is different:
   * bent elbows are the CORRECT posture at the bottom/ascent of an Overhead
   * Shoulder Press (ex_007) or the W-position of a Wall Angel (ex_008) — the
   * arms are only meant to be straight once they reach the top. Evaluating
   * the "Straighten arms" warning every frame fired it through the entire
   * lower portion of every rep, contradicting correct form.
   *
   * When `peakRelevant: true`, the warning surfacing (canvas overlay box +
   * clinical-card highlight) is suppressed unless the primary metric is near
   * its target ROM — see `isNearPeak` in `poseMetrics.ts`. The raw per-frame
   * value is still computed and logged unchanged (ML/analytics path is
   * untouched); only the user-facing warning is gated. Defaults to false,
   * preserving the always-on behaviour for every other compensation metric.
   */
  peakRelevant?: boolean;
  /**
   * When true, the camera loop captures a per-side resting baseline at the
   * start of the exercise and feeds `(baseline − raw)` as the metric value
   * instead of the raw absolute reading. Required for `scapularElevation`,
   * whose raw value is a positive absolute projection that is always above
   * the warningThreshold at rest (~0.18–0.22 trunk lengths >> 0.04 threshold).
   * After baseline capture the value is near zero at rest and increases only
   * when the patient actually shrugs.
   */
  requiresBaselineCapture?: boolean;
  /**
   * How this metric contributes to the compensation score. Omitted means
   * `{ mode: "static" }` — banded deduction on the absolute value. See
   * `CompensationScoring` for the modes.
   */
  scoring?: CompensationScoring;
  /**
   * Per-exercise override of the metric's global `COMPENSATION_BANDS` entry.
   * When present, the score deducts against THESE bands for this exercise
   * instead of the shared default. Use when the metric's clean-form noise
   * floor is genuinely different on one exercise (e.g. trunk sway is larger on
   * an unbraced lateral raise than on a wall-braced overhead press) and a
   * GLOBAL floor change would wrongly relax every other exercise that shares
   * the metric. Validated by `validateRegistry()` with the same invariants as
   * the global bands (start at 0 deduction, strictly increasing `max`,
   * continuous knots). Resolve via `getCompensationBands()`, never read
   * directly, so the override-vs-global precedence lives in one place.
   */
  bandsOverride?: Band[];
};

/**
 * Effective scoring mode for a compensation metric spec — `scoring` is
 * optional in the registry and defaults to static banded deduction. Every
 * consumer of the `scoring` field must go through this helper so the default
 * lives in exactly one place.
 */
export function getCompensationScoring(
  spec: CompensationMetricSpec
): CompensationScoring {
  return spec.scoring ?? { mode: "static" };
}

/**
 * Effective deduction bands for a compensation metric spec — a per-exercise
 * `bandsOverride` wins over the metric's shared `COMPENSATION_BANDS` entry.
 * Every consumer of the bands (the live score and the validator) must go
 * through this helper so the override-vs-global precedence lives in one place.
 * Returns undefined when the metric has neither (warning-only metrics).
 */
export function getCompensationBands(
  spec: CompensationMetricSpec
): Band[] | undefined {
  return spec.bandsOverride ?? COMPENSATION_BANDS[spec.name];
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPENSATION SCORE BANDS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One deduction band: values from the previous band's `max` (or 0) up to
 * `max` interpolate linearly from `deductionMin` to `deductionMax`.
 */
export type Band = { max: number; deductionMin: number; deductionMax: number };

/**
 * Per-metric deduction bands for the compensation score. Each band defines a
 * continuous interpolation range — entering a band scales linearly from
 * `deductionMin` to `deductionMax`, so there are no score cliffs at band
 * boundaries.
 *
 * Only metrics that actually deduct have an entry. A compensation metric
 * without one MUST declare `scoring: { mode: "off" }` (warning-only) —
 * enforced by `validateRegistry()`, so a scored metric can never silently
 * lack its bands.
 *
 * Units match the metric:
 *   - angle metrics (neck, shoulder symmetry, trunk lean):    degrees
 *   - displacement metrics (scapular elevation):              torso-length fraction
 *
 * Each metric's first band is its measurement noise floor (no deduction).
 * Band lists must start at zero deduction, be strictly increasing in `max`,
 * and be continuous across boundaries (each band's `deductionMin` equals the
 * previous band's `deductionMax`) — validated at module load. Continuity is
 * load-bearing: consumers that interpolate over the knot points (e.g. the
 * offline analytics pipeline reading the exported registry JSON) must compute
 * exactly the same function as the app's per-band interpolation.
 *
 * The deduction values assume each band's full deduction represents a
 * "saturated" metric. They get scaled by 1/N at score-computation time, where
 * N is the number of scored compensation metrics available in the frame.
 */
export const COMPENSATION_BANDS: Partial<Record<MetricName, Band[]>> = {
  // Neck tilt: 5° normal floor (matches the severity classifier)
  neckTilt: [
    { max: 5,  deductionMin: 0,   deductionMax: 0   },
    { max: 10, deductionMin: 0,   deductionMax: 35  },
    { max: 20, deductionMin: 35,  deductionMax: 75  },
    { max: 30, deductionMin: 75,  deductionMax: 100 },
  ],
  // Shoulder symmetry: 3° landmark noise floor
  shoulderSymmetry: [
    { max: 3,  deductionMin: 0,   deductionMax: 0   },
    { max: 7,  deductionMin: 0,   deductionMax: 35  },
    { max: 12, deductionMin: 35,  deductionMax: 75  },
    { max: 20, deductionMin: 75,  deductionMax: 100 },
  ],
  // Trunk lean: 2° standing-sway floor
  trunkLean: [
    { max: 2,  deductionMin: 0,   deductionMax: 0   },
    { max: 5,  deductionMin: 0,   deductionMax: 35  },
    { max: 10, deductionMin: 35,  deductionMax: 75  },
    { max: 20, deductionMin: 75,  deductionMax: 100 },
  ],
  // Scapular elevation as compensation: thresholds in normalized torso-length
  // CHANGE from baseline. Below 0.02 = within noise floor.
  scapularElevation: [
    { max: 0.02, deductionMin: 0,   deductionMax: 0   },
    { max: 0.04, deductionMin: 0,   deductionMax: 35  },
    { max: 0.06, deductionMin: 35,  deductionMax: 75  },
    { max: 0.10, deductionMin: 75,  deductionMax: 100 },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// PER-EXERCISE BAND OVERRIDES
// ─────────────────────────────────────────────────────────────────────────────
// The global COMPENSATION_BANDS above are each metric's default noise floor. A
// CompensationMetricSpec may point its `bandsOverride` at one of the lists
// below to shift the floor on a SPECIFIC exercise without relaxing every other
// exercise that shares the metric. All edges are single-subject pilot fits
// (clean-rep recording, sessions 168–174) and PT-reviewable; same continuity
// rules as the global bands (enforced by validateRegistry()).

// trunkLean, unbraced exercises (ex_001 lateral raise, ex_004 neck hold): the
// patient's clean standing sway measures ~3–5° (rest mean 1.97°, in-rep
// medians 2.9–4.8°), so the global 2° floor deducted on ~90% of deliberately
// clean frames (mean deduction ~21). Raising the floor to 6° puts honest sway
// in the no-deduction band while still flagging a real torso shift. The braced
// overhead exercises (ex_007/ex_008, clean trunk <2°) keep the global floor.
const TRUNK_LEAN_UNBRACED_BANDS: Band[] = [
  { max: 6,  deductionMin: 0,   deductionMax: 0   },
  { max: 10, deductionMin: 0,   deductionMax: 35  },
  { max: 15, deductionMin: 35,  deductionMax: 75  },
  { max: 25, deductionMin: 75,  deductionMax: 100 },
];

// shoulderSymmetry, exercises where the subject's resting shoulder-line
// asymmetry (~3.6°) sits right at the global 3° landmark-noise floor (ex_001
// lateral raise, ex_006 T-pose hold). Raising the floor to 7° keeps the
// resting asymmetry out of the deduction while still flagging a genuine uneven
// shoulder line. (Future: a per-side, baseline-relative shoulder check would
// replace this with a true zero-baseline; that needs per-exercise baseline
// capture — out of scope here.)
const SHOULDER_SYMMETRY_ASYMMETRIC_BANDS: Band[] = [
  { max: 7,  deductionMin: 0,   deductionMax: 0   },
  { max: 12, deductionMin: 0,   deductionMax: 35  },
  { max: 17, deductionMin: 35,  deductionMax: 75  },
  { max: 25, deductionMin: 75,  deductionMax: 100 },
];

/**
 * Configuration for an isometric (held-position) exercise.
 * No rep state machine runs; instead, the camera loop accumulates the
 * total time the metric stays inside [center − tolerance, center + tolerance].
 */
export type IsometricSpec = {
  metric: MetricName;
  side?: Side;
  targetBand: {
    center: number;
    tolerance: number;
  };
};

export type ExerciseDefinition =
  | {
      id: string;
      name: string;
      kind: "dynamic";
      bilateral: boolean;
      /**
       * Required when `bilateral: true`. Determines how the camera loop
       * routes angles into RepCounter instances. Ignored when `bilateral: false`.
       */
      bilateralMode?: BilateralMode;
      /**
       * Optional strategy override for signed bidirectional rep segmentation.
       * Defaults to the magnitude/neutral-settle wrapper. The velocity
       * strategy (velocityBidirectionalRepCounter.ts) suppresses passive
       * return-stroke overshoot from counting as an opposite-side rep while
       * loose-neutral deliberate alternation still counts. No active exercise
       * sets it since ex_004's conversion to an isometric hold (2026-06-11) —
       * ex_005 deliberately keeps the default — but the strategy remains
       * available for future bidirectional dynamic exercises.
       */
      bidirectionalRepStrategy?: BidirectionalRepStrategy;
      /**
       * When true, the exercise involves reaching above head height (e.g.,
       * overhead press, wall angels). The capture-readiness framing rule
       * shifts to allow the head LOWER in the frame so the patient can
       * stand further from the camera and keep wrists visible at peak
       * extension. See `captureReadiness.ts` HEAD_Y_MIN/HEAD_Y_MAX bounds
       * for the per-mode values. Defaults to false (treat as a
       * "ground-to-shoulder" exercise that doesn't need overhead clearance).
       *
       * Added 2026-05-21 (live-tuning iter #2): the default framing forces
       * head into the top quarter (y ∈ [0.05, 0.25]), which means the
       * patient stands close to the camera with no overhead room — wrists
       * leave the frame at the top of an overhead press and capture
       * readiness pauses metrics. Overhead-mode framing relocates the head
       * to the middle-upper zone so the patient can back up.
       */
      requiresOverheadRoom?: boolean;
      /**
       * When true, the exercise involves lateral motion that swings the head
       * sideways (and somewhat down) out of the default head-centering gate —
       * e.g. standing side bends. The capture-readiness framing rule switches to
       * "lateral" mode (wider head x-tolerance, lower head-y cap) so metrics
       * don't pause mid-rep, while the shoulders/hips/knees the metric needs stay
       * in frame. See `captureReadiness.ts` headXTol/headYBounds. Defaults false.
       * Mutually exclusive with `requiresOverheadRoom` in practice (overhead wins
       * if both were ever set — see the CameraClient framing-mode derivation).
       */
      requiresLateralRoom?: boolean;
      primaryMetric: PrimaryMetricSpec;
      compensationMetrics: CompensationMetricSpec[];
    }
  | {
      id: string;
      name: string;
      kind: "isometric";
      bilateral: boolean;
      bilateralMode?: BilateralMode;
      /** See dynamic variant — same flag, same semantics. */
      requiresOverheadRoom?: boolean;
      /** See dynamic variant — same flag, same semantics. */
      requiresLateralRoom?: boolean;
      isometric: IsometricSpec;
      compensationMetrics: CompensationMetricSpec[];
    };

// ─────────────────────────────────────────────────────────────────────────────
// REGISTRY
// ─────────────────────────────────────────────────────────────────────────────

export const EXERCISE_REGISTRY: Record<string, ExerciseDefinition> = {
  // ────────────────────────────────────────────────────────────────────────
  // ex_001 — Lateral Arm Raises (Shoulder Abduction)
  // Patient stands, arms at sides, raises both arms out to the sides until
  // roughly horizontal, then lowers. Bilateral by clinical convention.
  // ────────────────────────────────────────────────────────────────────────
  ex_001: {
    id: "ex_001",
    name: "Lateral Arm Raises",
    kind: "dynamic",
    bilateral: true,
    bilateralMode: "per-limb",
    primaryMetric: {
      name: "shoulderAbduction",
      thresholds: {
        // Resting arm-at-side gives ~5–10° apparent abduction from landmark
        // noise and slight standing posture variance. 20° is well above that
        // floor and below the angle of any deliberate movement.
        startThreshold: 20,
        // 10° gap below start gives a hysteresis band wide enough to absorb
        // post-smoothing residual jitter without missing real returns to rest.
        repCompleteThreshold: 10,
        // Minimum peak to count as a rep at all. Peaks below this are
        // silently discarded as false starts (NOT classified "partial" — that
        // boundary is `targetROM`; see `RepCounter` semantics in repCounter.ts).
        // 45° (lowered from 60° on 2026-05-21 for reduced-ROM leniency; user
        // decision via the global-floor approach, NOT classification tiers.
        // ex_001 is per-limb, so the bidirectional `abs()` phantom that
        // gated ex_004's reduced-ROM does not apply here. `targetROM` stays
        // 90°, so peaks in [45°, 90°) still classify as `partial` — the
        // weakness/asymmetry signal is preserved, the rep is no longer
        // silently dropped. Patients in early rehab often plateau around
        // 45–60° before regaining full ROM.
        minimumPeakThreshold: 45,
        // Clinical full ROM for shoulder abduction in the frontal plane is
        // ~180° anatomically, but home-exercise prescription typically targets
        // 90° (arm horizontal) for upper-body rehab. Source: standard PT
        // shoulder protocol, Kisner & Colby, Therapeutic Exercise.
        targetROM: 90,
      },
    },
    compensationMetrics: [
      // Trunk lean during lateral raise is the textbook compensation —
      // patients shift their torso away from the working arm to assist
      // the lift. Trunk lean ≥ 5° during the rep should flag. Unbraced-floor
      // band override (6° vs the global 2°): clean standing sway here is 3–5°.
      { name: "trunkLean",
        cue: {
          id: "ex_001.trunk-lean",
          message: "Keep your torso upright.",
          priority: 10,
        },
        warningThreshold: 5, bandsOverride: TRUNK_LEAN_UNBRACED_BANDS },
      // Shoulder shrug (scapular elevation) is the second-most-common
      // compensation — patients hike the trapezius to substitute for
      // weak deltoid. Surfaced as a warning when shrug exceeds the
      // shrug exercise's own start threshold. Scored as `primary-coupled`:
      // the scapula necessarily elevates as the arm abducts (scapulohumeral
      // rhythm), so the deduction runs on the residual from the expected
      // elevation at the current abduction, not the raw value. Fit: expected
      // ≈ -0.0077 + 0.00124·|abduction°| (clean-rep recording, n≈930).
      { name: "scapularElevation",
        cue: {
          id: "ex_001.scapular-elevation",
          message: "Relax your shoulders down.",
          priority: 20,
        },
        warningThreshold: 0.04, requiresBaselineCapture: true,
        scoring: { mode: "primary-coupled", intercept: -0.0077, slopePerPrimaryUnit: 0.00124, source: "pilot-fit" } },
      // Uneven shoulder line during the raise — one whole shoulder rides
      // higher than the other (distinct from a symmetric shrug). Drives the
      // per-shoulder overlay boxes + "LOWER" arrow. Starting threshold 5°
      // (above the 3° landmark noise floor); tune live. Band override raises
      // the score floor to 7° (resting asymmetry here is ~3.6°).
      { name: "shoulderSymmetry",
        cue: {
          id: "ex_001.shoulder-symmetry",
          message: "Level your shoulders.",
          priority: 30,
        },
        warningThreshold: 5, bandsOverride: SHOULDER_SYMMETRY_ASYMMETRIC_BANDS },
    ],
  },

  // ────────────────────────────────────────────────────────────────────────
  // ex_002 — Overhead Arm Raises (Shoulder Flexion)
  // Patient raises arms forward and up overhead. Sagittal-plane motion;
  // foreshortened on a front-facing camera (acknowledged limitation,
  // proposal page 10, depth ambiguity).
  // ────────────────────────────────────────────────────────────────────────
  /**
   * @deprecated 2026-05-21 — superseded by ex_007 (Overhead Shoulder Press)
   * because front-facing-camera projection makes shoulder flexion measurement
   * unreliable (depth ambiguity + unavoidable foreshortening).
   * Kept in the registry for audit/historical reference;
   * filtered out of the staff DEBUG_IDS list in `CameraClient.tsx`, not
   * assigned to patients. `computeShoulderFlexion` stays live (delegates to
   * `computeShoulderAbduction`; no harm in keeping the path).
   */
  ex_002: {
    id: "ex_002",
    name: "Overhead Arm Raises",
    kind: "dynamic",
    bilateral: true,
    bilateralMode: "per-limb",
    primaryMetric: {
      name: "shoulderFlexion",
      thresholds: {
        // Same noise-floor logic as abduction.
        startThreshold: 20,
        repCompleteThreshold: 10,
        // Forward elevation above 90° engages full deltoid + serratus
        // recruitment; below this counts as partial.
        minimumPeakThreshold: 90,
        // Clinical full ROM for shoulder flexion is ~180°. For front-camera
        // 2D estimation, foreshortening means the apparent measured angle
        // saturates around 150–160° for true 180° elevation. We target the
        // apparent angle at full ROM, not the anatomical angle. This is
        // the "known limitation" your proposal already discloses and will
        // be re-validated during pilot recordings.
        targetROM: 150,
      },
    },
    compensationMetrics: [
      // Trunk extension (leaning back) is the dominant compensation for
      // weak shoulder flexion. We don't have a sagittal-plane trunk angle
      // metric yet; trunkLean (lateral) catches asymmetric leans only.
      // TODO: add `trunkExtension` metric for sagittal compensation.
      { name: "trunkLean",
        cue: {
          id: "ex_002.trunk-lean",
          message: "Keep your torso upright.",
          priority: 10,
        },
        warningThreshold: 5 },
      { name: "scapularElevation",
        cue: {
          id: "ex_002.scapular-elevation",
          message: "Relax your shoulders down.",
          priority: 20,
        },
        warningThreshold: 0.04 },
    ],
  },

  // ────────────────────────────────────────────────────────────────────────
  // ex_003 — Shoulder Shrugs (Scapular Elevation)
  // Patient lifts both shoulders toward ears, holds briefly, releases.
  // Metric is normalized vertical shoulder-to-ear distance — small absolute
  // displacement, so thresholds are normalized to torso length for scale
  // invariance across patients of different sizes.
  // ────────────────────────────────────────────────────────────────────────
  /**
   * @deprecated 2026-05-21 — superseded by ex_008 (Wall Angels)
   * because scapular elevation amplitude (~0.04 trunk-length range) sits at
   * MediaPipe Full's ~3° landmark noise floor — the SNR is too low for
   * reliable rep counting under real-home conditions. Wall Angels uses
   * shoulderAbduction (a much larger-amplitude signal) as primary and keeps
   * only the v1 compensation signals that survived live testing (`trunkLean`
   * and `elbowFlexion`). Kept in the registry for audit and because
   * `scapularElevation` is still used as a COMPENSATION metric on ex_001 /
   * ex_006. It was removed from ex_007 / ex_008 until compensation-metric
   * baseline capture exists. Filtered out of staff DEBUG_IDS in
   * `CameraClient.tsx`; not assigned to patients. `computeScapularElevation`
   * stays live. Baseline-capture wiring in CameraClient remains in place for
   * the moment (dead code once DEBUG_IDS is updated) — preserved for the
   * possibility of future revival without redo.
   *
   * IMPORTANT for tests: `scapularElevation.test.ts` references this entry
   * structurally (assertions on `EXERCISE_REGISTRY.ex_003.kind === "dynamic"`
   * and `primaryMetric.requiresBaselineCapture`). The entry MUST stay
   * unchanged in shape and field values — only this deprecation JSDoc was
   * added. Do not "tidy up" the entry below.
   */
  ex_003: {
    id: "ex_003",
    name: "Shoulder Shrugs",
    kind: "dynamic",
    bilateral: true,
    bilateralMode: "per-limb",
    primaryMetric: {
      name: "scapularElevation",
      thresholds: {
        // Units: fraction of torso length (shoulder-midpoint to hip-midpoint
        // distance). Resting shoulder-to-ear gap is ~0.18–0.22 torso lengths;
        // we measure CHANGE from resting baseline, so all thresholds below
        // are deltas, not absolutes.
        //
        // 0.025 = ~2.5% torso-length change above resting. The original
        // 0.02 estimate (2× the assumed 0.01 landmark-noise floor) turned
        // out to be too tight in practice — landmark jitter plus subtle
        // body sway crossed it during stillness, producing phantom reps.
        startThreshold: 0.025,
        repCompleteThreshold: 0.01,
        // 0.05 = ~5% torso change. Bumped from the original 0.04 for the
        // same reason as startThreshold — noise occasionally reached 0.04
        // even when the patient was holding still.
        minimumPeakThreshold: 0.05,
        // 0.06 = ~6% torso change. Full shrug at end-range trapezius
        // contraction. Pilot data should refine this.
        targetROM: 0.06,
      },
      // Default 0.5 would be 10× the entire signal range; descent could
      // never fire. 0.005 = half of repCompleteThreshold, well within the
      // hysteresis band, an order of magnitude above expected post-smoothing
      // jitter at this scale.
      descentEpsilon: 0.005,
      // Raw scapularElevation is a positive absolute projection that
      // DECREASES during a shrug. Camera loop must capture a resting
      // baseline and feed (baseline − raw) so the thresholds above see a
      // positive delta that increases.
      requiresBaselineCapture: true,
      // Heavier at-rest smoothing than the global degree-scale default.
      // Shrug signal range (~0.05) is ~3000× smaller than angle range (~150°),
      // so global (1.0, 0.1) is much too light — landmark jitter crosses
      // startThreshold and accumulates phantom reps while the patient is
      // still. At shrug scale, beta is nearly a no-op since |dxHat| stays
      // small; minCutoff is the dominant knob.
      smoothing: { minCutoff: 0.3, beta: 0.01 },
    },
    compensationMetrics: [
      // Asymmetric shrug (one trap dominates) is the main quality issue.
      // shoulderSymmetry > 5° during the held position flags this.
      { name: "shoulderSymmetry",
        cue: {
          id: "ex_003.shoulder-symmetry",
          message: "Level your shoulders.",
          priority: 10,
        },
        warningThreshold: 5 },
    ],
  },

  // ────────────────────────────────────────────────────────────────────────
  // ex_004 — Neck Lateral Flexion (Cervical Side Bending, Isometric Hold)
  // Patient tilts head ear-toward-shoulder, HOLDS at the target angle, then
  // alternates to the other side. CONVERTED 2026-06-11 from a dynamic
  // (rep-counted) exercise to an isometric hold: the slow, small-range
  // alternating motion segments poorly as reps near MediaPipe's ear-line
  // noise, while a held tilt maps cleanly onto the same time-in-band
  // scoring ex_006 uses. The dynamic config (velocity-zero-crossing
  // segmentation, 5/2/12/30 thresholds) lives in git history if needed.
  //
  // SCORING MODEL: one signed bidirectional signal (neckLateralFlexion;
  // positive = patient's LEFT — pinned by neckSideAgreement.test.ts). The
  // camera loop accrues hold time PER SIDE from the sign of the angle:
  // left accrues while the signed angle is inside [center−tol, center+tol],
  // right while inside [−center−tol, −center+tol]. The two sides are
  // surfaced separately (never merged) and a set completes only when BOTH
  // sides reach the prescribed hold — the slower side gates, preserving
  // the asymmetry signal. No rep state machine runs (isometric).
  // ────────────────────────────────────────────────────────────────────────
  ex_004: {
    id: "ex_004",
    name: "Neck Lateral Flexion",
    kind: "isometric",
    bilateral: true,
    bilateralMode: "bidirectional-alternating",
    isometric: {
      metric: "neckLateralFlexion",
      targetBand: {
        // PLACEHOLDER values — the clinical hold angle and tolerance are
        // still pending a clinician decision; revise before validation.
        // This exercise is the ASSISTED stretch (decided 2026-06-11): one
        // hand applies gentle overpressure on the head, so the held angle
        // sits at end-range, not at a sub-maximal target. The band is
        // therefore one-sided in practice — "at least 12° toward that
        // side": [12°, 88°] = center 50 ± 38.
        center: 50,
        // ±38° puts the lower band edge at 12°: strictly positive — required
        // for sign-based side attribution (enforced in validateRegistry) —
        // and at the noise-validated 12° floor, so landmark jitter near
        // neutral cannot accrue hold time for either side. The upper edge
        // (88°) sits above anything observable: a recorded clean assisted
        // session measured holds at 44–63° (p95 55°, max 63°) — an earlier
        // 48° ceiling based on anatomical neck range turned out wrong for
        // this ear-line measurement (shoulder drop and head translation
        // push it past anatomical cervical ROM) and was silently discarding
        // 45% of legitimate hold time at the deepest stretch.
        // Hold-quality note: for a stretch, drifting DEEPER during the hold
        // is expected tissue creep, not failure — read drift/droop stats for
        // this exercise with the opposite sign convention from the ex_006
        // strength hold.
        tolerance: 38,
      },
    },
    compensationMetrics: [
      // Trunk lean during neck flexion = patient is bending the whole spine
      // instead of isolating the neck. Strong quality indicator. Unbraced-floor
      // band override (6° vs global 2°): clean assisted holds sway 1.8–3.4° and
      // the global floor deducted on ~54% of clean-hold frames. The warning
      // threshold stays the tighter 3° (warning ≠ score deduction here).
      { name: "trunkLean",
        cue: {
          id: "ex_004.trunk-lean",
          message: "Keep your torso upright — tilt only your head.",
          priority: 10,
        },
        warningThreshold: 3, bandsOverride: TRUNK_LEAN_UNBRACED_BANDS },
      // NOTE 2026-06-11: `shoulderSymmetry` was REMOVED from this
      // compensation list. The exercise is the assisted stretch, where a
      // sloped shoulder line is PRESCRIBED technique (the opposite shoulder
      // is deliberately depressed while the hand pulls the head over) — a
      // symmetric line-angle metric cannot distinguish that from the genuine
      // cheat (hiking the bend-side shoulder up to meet the ear). Restoring
      // shoulder-cheat detection needs a per-side, baseline-relative
      // scapular check (direction-aware), which requires baseline capture
      // on this exercise — future work. The raw shoulder line is still
      // recorded every frame by the tuning trace, so the signal is measured
      // even though it is not scored or warned on.
    ],
  },

  // ────────────────────────────────────────────────────────────────────────
  // ex_005 — Standing Side Bends (Trunk Lateral Flexion)
  // Patient stands upright, bends torso to one side, returns to neutral,
  // and alternates. Unlike isometric ex_004, this exercise uses the dynamic
  // bidirectional counter and attributes each completed motion from its sign.
  // ────────────────────────────────────────────────────────────────────────
  ex_005: {
    id: "ex_005",
    name: "Standing Side Bends",
    kind: "dynamic",
    bilateral: true,
    bilateralMode: "bidirectional-alternating",
    // Lateral motion — a side bend swings the head sideways (and down) well past
    // the default head-centering gate, which would pause metrics mid-rep. The
    // "lateral" framing mode widens the head x-tolerance and lowers the head-y
    // cap; the shoulders/hips/knees the metric needs stay in frame. (Added
    // 2026-05-24 after live testing — see captureReadiness.ts headXTol/headYBounds.)
    requiresLateralRoom: true,
    primaryMetric: {
      // trunkLateralFlexion = HEAD lateral lean: the angle of the hip-midpoint →
      // ear-midpoint line from vertical (camera-roll corrected). Re-based twice
      // after live testing (2026-05-25): the trunk-midpoint lean fired on a pure
      // sideways shift, and the shoulder-vs-hip tilt fired on a shoulder-girdle
      // tilt with no real bend. The head only swings laterally when the trunk
      // truly leans. Thresholds below are degrees of head lean — STARTING values
      // carried over; they NEED a live re-tuning pass on this signal (the head's
      // long lever arm above the hips shifts the scale vs the earlier metrics).
      name: "trunkLateralFlexion",
      // Live testing showed per-frame hip-line camera correction can move with
      // the side bend and cancel the head-lean signal. The camera loop captures
      // a neutral hip-to-head baseline and counts side-bend delta from that
      // stable neutral reference.
      requiresBaselineCapture: true,
      thresholds: {
        // Small neutral band: the head sits ~above the hips at rest, so a few
        // degrees of lean is noise.
        startThreshold: 5,
        repCompleteThreshold: 2,
        // 15° of head lean is a meaningful side bend; below this counts as
        // partial. STARTING value — re-tune live.
        minimumPeakThreshold: 15,
        // Healthy adult lumbar lateral flexion ROM is 20–30°; the head's lean
        // angle at full bend lands in a similar range. Target the conservative
        // end for home prescription. STARTING value — re-tune live.
        targetROM: 25,
      },
    },
    compensationMetrics: [
      // Neck tilt during a trunk side bend usually means the patient is
      // tilting their head INSTEAD of bending the trunk — common on the
      // side where trunk mobility is restricted. Scored as `primary-coupled`:
      // the head rides with the trunk through a clean side bend, so the
      // deduction runs on the residual from the expected neck tilt at the
      // current trunk flexion. Fit: expected ≈ 11.71 + 1.505·|trunkFlexion°|
      // (clean-rep recording, n≈1299; the intercept is an in-rep envelope
      // extrapolation, not an anatomical resting claim).
      { name: "neckTilt",
        cue: {
          id: "ex_005.neck-tilt",
          message: "Bend from your waist, not your neck.",
          priority: 10,
        },
        warningThreshold: 5,
        scoring: { mode: "primary-coupled", intercept: 11.7093, slopePerPrimaryUnit: 1.50466, source: "pilot-fit" } },
      // Shoulder shrug during side bend = bracing through the shoulder
      // girdle instead of moving from the spine. Also `primary-coupled`: the
      // shoulder line necessarily rises on the lengthening side of a clean
      // bend. Fit: expected ≈ -0.0230 + 0.01306·|trunkFlexion°|.
      { name: "scapularElevation",
        cue: {
          id: "ex_005.scapular-elevation",
          message: "Relax your shoulders down.",
          priority: 20,
        },
        warningThreshold: 0.04, requiresBaselineCapture: true,
        scoring: { mode: "primary-coupled", intercept: -0.0230, slopePerPrimaryUnit: 0.01306, source: "pilot-fit" } },
    ],
  },

  // ────────────────────────────────────────────────────────────────────────
  // ex_006 — Arm Abduction at 90° (Isometric T-Pose Hold)
  // Patient holds both arms straight out to the sides at shoulder height
  // for a prescribed duration. NOT a counted-rep exercise — runs as a
  // time-in-target-band metric per project memory.
  // ────────────────────────────────────────────────────────────────────────
  ex_006: {
    id: "ex_006",
    name: "Arm Abduction at 90°",
    kind: "isometric",
    bilateral: true,
    bilateralMode: "per-limb",
    isometric: {
      // For a bilateral isometric, the camera loop runs the band check
      // for both sides independently and surfaces per-side time-in-band.
      metric: "shoulderHorizAbd",
      targetBand: {
        // Patient holds arms at 90° abduction (T-pose).
        center: 90,
        // ±10° is the standard clinical hold tolerance — tight enough to
        // require active engagement, loose enough to accommodate fatigue
        // tremor and landmark noise without fragmenting the hold.
        tolerance: 10,
      },
    },
    compensationMetrics: [
      // Shoulder shrug while holding T-pose = trapezius substituting for
      // deltoid endurance. Common after the first 15–20 seconds of hold.
      // Scored as `primary-coupled`: holding the arms at 90° already carries a
      // baseline scapular elevation, so the deduction runs on the residual
      // from the expected elevation at the current abduction. Fit: expected
      // ≈ -0.0142 + 0.00093·|abduction°| (clean-hold recording, n≈3348).
      { name: "scapularElevation",
        cue: {
          id: "ex_006.scapular-elevation",
          message: "Relax your shoulders down.",
          priority: 10,
        },
        warningThreshold: 0.04, requiresBaselineCapture: true,
        scoring: { mode: "primary-coupled", intercept: -0.0142, slopePerPrimaryUnit: 0.00093, source: "pilot-fit" } },
      // Trunk lean during T-pose hold = unbalanced load between arms. Keeps the
      // global floor — clean T-pose trunk lean is ~1° (mean deduction ~2.8).
      { name: "trunkLean",
        cue: {
          id: "ex_006.trunk-lean",
          message: "Keep your torso upright.",
          priority: 20,
        },
        warningThreshold: 5 },
      // Uneven shoulder line during the hold — one shoulder rides higher than
      // the other. Drives the per-shoulder overlay boxes + "LOWER" arrow.
      // Starting threshold 5° (above the 3° landmark noise floor); tune live.
      // Band override raises the score floor to 7° (resting asymmetry ~3.6°).
      { name: "shoulderSymmetry",
        cue: {
          id: "ex_006.shoulder-symmetry",
          message: "Level your shoulders.",
          priority: 30,
        },
        warningThreshold: 5, bandsOverride: SHOULDER_SYMMETRY_ASYMMETRIC_BANDS },
    ],
  },

  // ────────────────────────────────────────────────────────────────────────
  // ex_007 — Overhead Shoulder Press (NEW 2026-05-21 — replaces deprecated ex_002)
  // Patient stands, presses both arms straight up overhead from shoulder
  // height. Bilateral, per-limb tracked. Frontal-plane (front-camera-clean,
  // unlike the deprecated ex_002 which had unavoidable depth/foreshortening).
  // Selected as the front-camera-safe replacement for deprecated ex_002.
  //
  // PRIMARY METRIC: wristShoulderVertical = (shoulder.y − wrist.y) / trunk_length.
  //   negative at rest (wrist below shoulder), positive overhead. The metric
  //   LETS NEGATIVES FLOW — see poseMetrics.ts SIGN DISCIPLINE block.
  //
  // THRESHOLD STATUS (2026-06-11): tuned from one researcher recording.
  //   These are single-subject pilot engineering values, not clinically
  //   validated thresholds; a broader validation set is still required.
  // ────────────────────────────────────────────────────────────────────────
  ex_007: {
    id: "ex_007",
    name: "Overhead Shoulder Press",
    kind: "dynamic",
    bilateral: true,
    bilateralMode: "per-limb",
    // Overhead reach — relax the framing rule so the patient can stand
    // further from the camera and keep wrists visible at peak extension.
    requiresOverheadRoom: true,
    primaryMetric: {
      name: "wristShoulderVertical",
      thresholds: {
        // Units: trunk-length-normalized fraction. Wrist at rest is well
        // below shoulder (negative value, typically ~-0.5 trunk-lengths).
        // startThreshold 0.1 requires the wrist to actually rise above
        // shoulder before ascent is detected — filters out arm-swing
        // wobble at rest.
        startThreshold: 0.1,
        // 0.05 gap below start for hysteresis.
        repCompleteThreshold: 0.05,
        // DISCARD FLOOR (NOT the partial/complete boundary — that is
        // `targetROM`; see repCounter.ts REP CLASSIFICATION). Peaks below
        // this are silently dropped as false starts (no rep counted).
        // Live wrist-height calibration (2026-06-04) separated low lifts
        // just above shoulder height (smoothed peak <= 0.18) from intended
        // medium partial presses (smoothed peak >= 0.24). 0.21 sits in that
        // observed gap: lower motions remain false starts, while deliberate
        // partial presses can be recorded. Peaks in [0.21, 0.85) classify as
        // `partial`; >= 0.85 (targetROM) classify as `complete`.
        minimumPeakThreshold: 0.21,
        // Tuned 2026-06-11 from a recorded clean session: full overhead
        // presses peaked at 0.89–0.95 trunk lengths (p25 0.89, p50 0.92),
        // so the earlier 0.6 starting value classified every rep complete
        // and discriminated nothing. 0.85 keeps clean full extension
        // "complete" while genuine partial presses classify as partial.
        // Single-subject pilot value. NOTE: the near-peak warning gate is
        // a fraction of targetROM, so peak-gated cues (elbow flexion) now
        // surface near true full extension (~0.765) instead of mid-press.
        targetROM: 0.85,
      },
      // Default 0.5 would be ~5× the entire signal range; descent could
      // never fire. 0.025 = half of repCompleteThreshold, well within
      // hysteresis band, an order of magnitude above expected post-smoothing
      // jitter at this small numeric scale.
      descentEpsilon: 0.025,
      // Smoothing override REMOVED 2026-05-21 (live-tuning iteration #1):
      // an earlier attempt used `{ minCutoff: 0.3, beta: 0.01 }` modeled on
      // ex_003's tiny ~0.05 signal range. That was wrong: wristShoulderVertical
      // spans ~−0.5 to +1.5 trunk-lengths (≈30× larger than ex_003), and
      // minCutoff=0.3 Hz gives a ~3.3 s step-response time at 20 fps — for
      // a 2–3 s press the smoothed peak never reached `minimumPeakThreshold:
      // 0.4` even when raw signal did, so no reps emitted. Falling back to
      // the global `(1.0, 0.1)` default which tracks the press motion in
      // ~1 s. If at-rest jitter at the hip-level wrist position turns out
      // to phantom-fire reps, the right knob is a slightly higher minCutoff
      // (1.5–2.0), NOT a return to the ex_003 setting.
    },
    compensationMetrics: [
      // Trunk lean (esp. backward lean) is the classic shoulder press cheat.
      { name: "trunkLean",
        cue: {
          id: "ex_007.trunk-lean",
          // Deliberately direction-neutral, matching every other trunkLean cue.
          // The comment above describes the compensation this metric is meant to
          // CATCH, but `computeTrunkLateralLean` measures image-plane left/right
          // lean only — it cannot see sagittal backward lean. Earlier wording said
          // "don't lean back", which named an axis the metric does not detect.
          message: "Keep your torso upright.",
          priority: 10,
        },
        warningThreshold: 5 },
      // NOTE 2026-05-22: `scapularElevation` (shrug) was REMOVED from this
      // compensation list. The metric returns a raw signed projection that
      // is ~0.30 positive at rest (ear naturally sits above shoulder along
      // the trunk-up axis). The warningThreshold of 0.04 was designed for
      // a baseline-subtracted delta, not the raw absolute, so the card
      // would have been permanently flagged red. Restoring a meaningful
      // shrug compensation here requires per-session baseline-capture
      // for compensation metrics, deferred for v1. Trapezius
      // substitution is still partially caught by `trunkLean` (compensatory
      // backward lean) and `elbowFlexion` (incomplete overhead extension).
      // Elbow flexion < 150° at peak = incomplete overhead extension.
      // Interior-angle convention: 180° = arms fully straight overhead.
      // `compareDirection: "below"` because LOWER value = MORE bent = worse.
      // `peakRelevant` because bent elbows are CORRECT at the bottom/ascent of
      // the press — the warning must only surface near full overhead extension
      // (gated by isNearPeak in poseMetrics.ts), never through the lower rep.
      // Threshold lowered 160→150 (2026-06-05) alongside the 0.8→0.9 peak gate
      // so only a clearly-bent elbow at near-full ROM flags, not one still
      // finishing extension.
      // Warning-only (`scoring: off`): deducting elbow bend fairly needs
      // direction-aware ("below") banded deduction tuned from live data —
      // until that exists this metric must not score, and must not dilute
      // the weight of the metrics that do.
      { name: "elbowFlexion",
        cue: {
          id: "ex_007.elbow-flexion",
          message: "Straighten your arms at the top.",
          priority: 20,
          // Shorter windows than the defaults: this cue only surfaces inside
          // the brief near-peak gate, so the standard 600 ms promote / 3 s
          // cooldown would skip most repetitions entirely.
          minActiveMs: 250,
          cooldownMs: 1200,
        },
        warningThreshold: 150, compareDirection: "below", peakRelevant: true, scoring: { mode: "off" } },
    ],
  },

  // ────────────────────────────────────────────────────────────────────────
  // ex_008 — Wall Angels (NEW 2026-05-21 — replaces deprecated ex_003)
  // Patient stands with back/shoulders/arms against a wall, slides arms
  // from W-position (elbows at shoulder height, bent ~90°) up to Y-position
  // (arms extended overhead), keeping contact with the wall throughout.
  // Bilateral, per-limb tracked. Frontal-plane, MediaPipe-clean.
  // Selected as the front-camera-safe replacement for deprecated ex_003.
  //
  // PRIMARY METRIC: shoulderAbduction (reused from ex_001 — same math, same
  //   cross-body null contract). targetROM raised to overhead range.
  //
  // COMPENSATION STATUS: v1 keeps only trunkLean + elbowFlexion. The earlier
  //   shoulderElbowDistance foreshortening signal was removed after live
  //   testing because front-camera 2D projection could not separate normal
  //   overhead motion from elbow-off-wall drift without a real wall or a
  //   per-patient baseline. The function/test remain for future restoration.
  //
  // THRESHOLD STATUS (2026-06-11): tuned from one researcher recording.
  //   The tuned hysteresis counted all 15 recorded cycles on each side.
  //   These remain single-subject pilot values, not clinical validation.
  // ────────────────────────────────────────────────────────────────────────
  ex_008: {
    id: "ex_008",
    name: "Wall Angels",
    kind: "dynamic",
    bilateral: true,
    bilateralMode: "per-limb",
    // Overhead reach (arms slide up the wall toward Y-position) — relax
    // the framing rule for the same reason as ex_007.
    requiresOverheadRoom: true,
    primaryMetric: {
      name: "shoulderAbduction",
      thresholds: {
        // Tuned 2026-06-11 from a recorded clean session. Wall Angels rest
        // at the W-POSITION between reps, not with arms at the sides: the
        // recorded W rest level measured ~14–50° of abduction (p75 ≈ 50°),
        // so the earlier lateral-raise-style 20/10 values only completed a
        // rep when the arms dropped fully — the counter saw 7 of 15 clean
        // reps on one side and 5 of 15 on the other. Start/complete must
        // sit ABOVE the W so the counter re-arms on the return to W:
        // start 85 (above the W band with margin, well below the Y-peaks
        // at ~146–167°), complete 70 (15° hysteresis below start, above
        // the W p75 of 50°). With these values every one of the recorded
        // session's 15 clean cycles per side counts. Single-subject pilot
        // values.
        startThreshold: 85,
        repCompleteThreshold: 70,
        // 110° = clearly past horizontal into the W→Y slide. The recorded
        // clean Y-peaks ran 146–167°, so 110 keeps deliberate partial
        // slides countable while arm settles near the W (≤ ~50°) stay
        // discarded.
        minimumPeakThreshold: 110,
        // 150° ≈ arms-overhead position at full extension along the wall.
        // Foreshortening at full overhead is an accepted thesis limitation
        // (known foreshortening limitation in computeShoulderAbduction).
        // Confirmed plausible by the 2026-06-11 recorded clean session:
        // Y-peaks ran 146–167° (p50 ≈ 147), so clean full extension
        // straddles 150 the same way ex_001's clean peaks straddle its 90°
        // target.
        targetROM: 150,
      },
      // No descentEpsilon override (degree-scale, global 0.5 is fine).
      // No smoothing override (global degree-scale default fine).
    },
    compensationMetrics: [
      // Trunk lean = patient is using torso shift to slide arms up the wall
      // instead of recruiting shoulder muscles.
      { name: "trunkLean",
        cue: {
          id: "ex_008.trunk-lean",
          message: "Keep your torso upright.",
          priority: 10,
        },
        warningThreshold: 5 },
      // NOTE 2026-05-22: `scapularElevation` (shrug) was REMOVED from this
      // compensation list for the same reason as ex_007 — see that comment
      // for full rationale. Trapezius-hiking is partially caught by
      // `trunkLean` and `elbowFlexion` in the meantime. Restore once
      // compensation-metric baseline-capture lands as a follow-up.
      // Elbow flexion < 150° = patient bending the elbow to cheat the
      // motion (forearm pulls away from wall instead of arms sliding
      // straight). Interior-angle convention: 180° = arms straight.
      // `compareDirection: "below"` because LOWER value = MORE bent = worse.
      // `peakRelevant` because Wall Angels are bent-by-design at the W-position
      // (elbows ~90°) and only straighten near the Y-position at the top — the
      // warning must only surface near peak ROM, never through the W→Y slide.
      // Threshold lowered 160→150 (2026-06-05) alongside the 0.8→0.9 peak gate.
      // Warning-only (`scoring: off`): deducting elbow bend fairly needs
      // direction-aware ("below") banded deduction tuned from live data —
      // until that exists this metric must not score, and must not dilute
      // the weight of the metrics that do.
      { name: "elbowFlexion",
        cue: {
          id: "ex_008.elbow-flexion",
          message: "Straighten your arms at the top.",
          priority: 20,
          // Shorter windows than the defaults: this cue only surfaces inside
          // the brief near-peak gate, so the standard 600 ms promote / 3 s
          // cooldown would skip most repetitions entirely.
          minActiveMs: 250,
          cooldownMs: 1200,
        },
        warningThreshold: 150, compareDirection: "below", peakRelevant: true, scoring: { mode: "off" } },
      // NOTE 2026-05-22: `shoulderElbowDistance` (foreshortening signal /
      // elbow-off-wall detection) was REMOVED from this compensation list
      // after live-tuning iter #4. The metric was designed to flag an elbow
      // rotating forward off the wall (which foreshortens the projected
      // upper-arm length). Two issues made it noise rather than signal in
      // practice: (1) the test setup didn't use an actual wall, so natural
      // arm trajectory during the motion involves forward elbow drift that
      // permanently triggered the flag; (2) the 2D projection can't cleanly
      // distinguish "elbow drifted forward (compensation)" from "elbow moved
      // overhead (the actual exercise)" — both shorten the apparent
      // shoulder-elbow distance, so the threshold has no margin between
      // good form and bad form. Properly using this metric requires either
      // (a) a real wall in the patient's setup giving the elbow a physical
      // constraint and a stable on-wall baseline, or (b) a 3D pose backend
      // / per-patient anatomical baseline-capture. Neither is v1 scope.
      // The `computeShoulderElbowDistance` function + tests remain in the
      // codebase for future restoration. Elbow-bend compensation is still
      // partially caught by `elbowFlexion`.
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// LOOKUP HELPER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the registry entry for an exercise id, or null if the id is not
 * registered. Use this rather than indexing EXERCISE_REGISTRY directly,
 * because exercise ids may come from user data (assignments) and aren't
 * guaranteed to match a registry entry. A null return means the camera
 * loop should display a "not implemented" message rather than crash.
 */
export function getExerciseDefinition(id: string): ExerciseDefinition | null {
  return EXERCISE_REGISTRY[id] ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates one deduction-band list: non-empty, starts at zero deduction,
 * strictly increasing `max`, deductions within 0–100, and continuous across
 * boundaries (band[i+1].deductionMin === band[i].deductionMax). Shared by the
 * global `COMPENSATION_BANDS` check and the per-exercise `bandsOverride` check
 * so both enforce identical shape. Continuity matters beyond aesthetics:
 * consumers that linearly interpolate over the knot points (e.g. the offline
 * analytics pipeline reading the exported registry JSON) only compute the same
 * function as the app's per-band interpolation when the bands form one
 * continuous piecewise-linear curve. `label` names the source in errors.
 */
function validateBandList(bands: Band[] | undefined, label: string): void {
  if (!bands || bands.length === 0) {
    throw new Error(
      `Registry invariant violated: ${label} must not be empty — delete the ` +
      `entry/override entirely if the metric never deducts.`
    );
  }
  let prevMax = 0;
  let prevDeduction = 0;
  for (const b of bands) {
    if (!(b.max > prevMax)) {
      throw new Error(
        `Registry invariant violated: ${label} band maxes must be strictly ` +
        `increasing (got ${b.max} after ${prevMax}).`
      );
    }
    if (b.deductionMin !== prevDeduction) {
      throw new Error(
        `Registry invariant violated: ${label} is discontinuous at ` +
        `max=${b.max}: deductionMin (${b.deductionMin}) must equal the ` +
        `previous band's deductionMax (${prevDeduction}).`
      );
    }
    if (b.deductionMin < 0 || b.deductionMax > 100 || b.deductionMax < b.deductionMin) {
      throw new Error(
        `Registry invariant violated: ${label} band at max=${b.max} must ` +
        `satisfy 0 ≤ deductionMin ≤ deductionMax ≤ 100.`
      );
    }
    prevMax = b.max;
    prevDeduction = b.deductionMax;
  }
}

/**
 * Validates the registry's threshold invariants at module load time.
 * Catches typos in threshold values that would otherwise silently break
 * rep counting (e.g., repCompleteThreshold accidentally set higher than
 * startThreshold). Throws on the first violation so the build fails loudly.
 *
 * Called once at the bottom of this file. Has no runtime cost in production
 * once the registry is verified — the JIT eliminates the dead checks.
 */
function validateRegistry(): void {
  // Global band-table shape (see validateBandList for the invariants).
  for (const [metric, bands] of Object.entries(COMPENSATION_BANDS)) {
    validateBandList(bands, `COMPENSATION_BANDS["${metric}"]`);
  }

  // Coaching cue ids must be unique across the WHOLE registry, not just within
  // one exercise. The single-cue selector keys its per-cue timing state by id,
  // and a shadow-log decision is read back by id alone — a reused id would
  // silently share cooldown state between two exercises and make a logged
  // decision ambiguous about which exercise produced it.
  const seenCueIds = new Map<string, string>();
  for (const def of Object.values(EXERCISE_REGISTRY)) {
    for (const comp of def.compensationMetrics) {
      if (!comp.cue) continue;
      const owner = `${def.id} compensation metric "${comp.name}"`;
      const previousOwner = seenCueIds.get(comp.cue.id);
      if (previousOwner !== undefined) {
        throw new Error(
          `Registry invariant violated: coaching cue id "${comp.cue.id}" is ` +
          `declared by both ${previousOwner} and ${owner}. Cue ids must be ` +
          `unique across the registry — use "<exerciseId>.<metric-in-kebab-case>".`
        );
      }
      if (comp.cue.id.trim() === "") {
        throw new Error(
          `Registry invariant violated for ${owner}: coaching cue id must not be empty.`
        );
      }
      if (comp.cue.message.trim() === "") {
        throw new Error(
          `Registry invariant violated for ${owner}: coaching cue "${comp.cue.id}" ` +
          `must declare a non-empty message.`
        );
      }
      if (!Number.isFinite(comp.cue.priority)) {
        throw new Error(
          `Registry invariant violated for ${owner}: coaching cue ` +
          `"${comp.cue.id}" priority (${comp.cue.priority}) must be a finite ` +
          `number. Lower numbers are surfaced first.`
        );
      }
      for (const [field, value] of [
        ["minActiveMs", comp.cue.minActiveMs],
        ["minDisplayMs", comp.cue.minDisplayMs],
        ["cooldownMs", comp.cue.cooldownMs],
      ] as const) {
        if (value !== undefined && !(Number.isFinite(value) && value >= 0)) {
          throw new Error(
            `Registry invariant violated for ${owner}: coaching cue ` +
            `"${comp.cue.id}" ${field} (${value}) must be a non-negative ` +
            `finite number of milliseconds.`
          );
        }
      }
      seenCueIds.set(comp.cue.id, owner);
    }
  }

  for (const def of Object.values(EXERCISE_REGISTRY)) {
    // Every scored compensation metric must have real deduction bands —
    // either the global entry or a per-exercise `bandsOverride`. Warning-only
    // metrics must say so explicitly (`scoring: { mode: "off" }`) instead of
    // relying on a missing/zero band entry — a silent gap here once diluted
    // the score weighting on Wall Angels.
    for (const comp of def.compensationMetrics) {
      // Per-exercise overrides obey the same shape rules as the global bands.
      if (comp.bandsOverride !== undefined) {
        validateBandList(
          comp.bandsOverride,
          `${def.id} compensation metric "${comp.name}" bandsOverride`,
        );
      }
      if (getCompensationScoring(comp).mode === "off") continue;
      const bands = getCompensationBands(comp);
      if (!bands || !bands.some((b) => b.deductionMax > 0)) {
        throw new Error(
          `Registry invariant violated for ${def.id}: compensation metric ` +
          `"${comp.name}" is scored but has no deduction bands with a ` +
          `positive deduction (global or override). Either add deduction ` +
          `bands or declare scoring: { mode: "off" } to make it warning-only.`
        );
      }
    }
    if (def.bilateral && !def.bilateralMode) {
      throw new Error(
        `Registry invariant violated for ${def.id}: ` +
        `bilateral exercises must declare bilateralMode ` +
        `("per-limb" or "bidirectional-alternating").`
      );
    }
    if (
      def.kind === "dynamic" &&
      def.bidirectionalRepStrategy &&
      (!def.bilateral || def.bilateralMode !== "bidirectional-alternating")
    ) {
      throw new Error(
        `Registry invariant violated for ${def.id}: ` +
        `bidirectionalRepStrategy can only be set on ` +
        `bidirectional-alternating dynamic exercises.`
      );
    }
    if (def.kind === "dynamic") {
      const t = def.primaryMetric.thresholds;
      if (!(t.repCompleteThreshold < t.startThreshold)) {
        throw new Error(
          `Registry invariant violated for ${def.id}: ` +
          `repCompleteThreshold (${t.repCompleteThreshold}) must be ` +
          `< startThreshold (${t.startThreshold}). The hysteresis band ` +
          `prevents jitter-induced double counts and requires this ordering.`
        );
      }
      if (!(t.startThreshold < t.minimumPeakThreshold)) {
        throw new Error(
          `Registry invariant violated for ${def.id}: ` +
          `startThreshold (${t.startThreshold}) must be ` +
          `< minimumPeakThreshold (${t.minimumPeakThreshold}). A rep that ` +
          `never reaches the start threshold cannot have a meaningful peak.`
        );
      }
      if (!(t.minimumPeakThreshold <= t.targetROM)) {
        throw new Error(
          `Registry invariant violated for ${def.id}: ` +
          `minimumPeakThreshold (${t.minimumPeakThreshold}) must be ` +
          `≤ targetROM (${t.targetROM}). Otherwise no rep can ever be ` +
          `classified as "complete".`
        );
      }
      const eps = def.primaryMetric.descentEpsilon;
      if (eps !== undefined && !(eps < t.repCompleteThreshold)) {
        throw new Error(
          `Registry invariant violated for ${def.id}: ` +
          `descentEpsilon (${eps}) must be < repCompleteThreshold ` +
          `(${t.repCompleteThreshold}). Otherwise descent can only be ` +
          `confirmed after the value has already crossed the rep-complete ` +
          `threshold, defeating the hysteresis design.`
        );
      }
      const s = def.primaryMetric.smoothing;
      if (s !== undefined) {
        if (!(s.minCutoff > 0)) {
          throw new Error(
            `Registry invariant violated for ${def.id}: ` +
            `smoothing.minCutoff (${s.minCutoff}) must be > 0. ` +
            `OneEuroFilter divides by 2π·minCutoff in the alpha calc.`
          );
        }
        if (!(s.beta >= 0)) {
          throw new Error(
            `Registry invariant violated for ${def.id}: ` +
            `smoothing.beta (${s.beta}) must be ≥ 0. Negative beta would ` +
            `make the filter more aggressive during motion, the opposite ` +
            `of what the adaptive cutoff is meant to do.`
          );
        }
        if (s.dCutoff !== undefined && !(s.dCutoff > 0)) {
          throw new Error(
            `Registry invariant violated for ${def.id}: ` +
            `smoothing.dCutoff (${s.dCutoff}) must be > 0. ` +
            `OneEuroFilter uses it to smooth derivative estimates.`
          );
        }
      }
    }
    if (def.kind === "isometric") {
      const band = def.isometric.targetBand;
      if (band.tolerance <= 0) {
        throw new Error(
          `Registry invariant violated for ${def.id}: ` +
          `isometric tolerance must be positive.`
        );
      }
      if (
        def.bilateral &&
        def.bilateralMode === "bidirectional-alternating" &&
        !(band.center - band.tolerance > 0)
      ) {
        throw new Error(
          `Registry invariant violated for ${def.id}: ` +
          `a bidirectional-alternating isometric attributes sides from the ` +
          `SIGN of one signed metric, so targetBand.center (${band.center}) − ` +
          `tolerance (${band.tolerance}) must be > 0. A band that reaches 0 ` +
          `would put BOTH sides "in band" at neutral and accrue hold time ` +
          `without any tilt.`
        );
      }
    }
  }
}

validateRegistry();
