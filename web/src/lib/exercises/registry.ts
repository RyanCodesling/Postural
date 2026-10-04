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
 * bidirectional-alternating isometrics (the side-split path; no current
 * exercise uses it).
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
  | "shoulderSymmetry"       // existing — used as compensation metric on ex_001/ex_004/ex_006 (and deprecated ex_003; restored on ex_004 2026-09-24 with the active version — the shoulders should stay level, unlike the former assisted stretch's prescribed slope)
  | "neckTilt"               // existing — used as compensation metric on ex_005
  | "elbowFlexion"           // NEW 2026-05-21 — compensation on ex_007 + ex_008 (interior-angle convention: 180° = straight, ~30° = fully bent)
  | "wristShoulderVertical"  // NEW 2026-05-21 — primary metric for ex_007 overhead shoulder press (trunk-normalized; negatives legal at rest)
  | "shoulderElbowDistance"  // NEW 2026-05-21 — retained for future Wall Angels variants; removed from active ex_008 v1 compensation after live testing showed 2D foreshortening was too noisy
  | "hipShift"               // NEW 2026-10-02 — display-only coaching check on ex_005 (hips pushed sideways, in hip widths), computed in hipShiftWarning.ts rather than poseMetrics.ts; never scored or stored (see CoachingCheckSpec)
  | "elbowBend";             // NEW 2026-10-04 — display-only coaching check on ex_001/ex_006 (elbow interior angle with the arm raised, 180 = straight), computed in elbowBendWarning.ts; never scored or stored (see CoachingCheckSpec)

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
 *   raise, shoulder shrug, T-pose hold. A metric measured as ONE signed
 *   angle (ex_004 neck flexion) is split by sign instead: the left side
 *   sees the positive part, the right side the negative part's magnitude
 *   (`splitSignedBySide` in poseMetrics.ts).
 *
 * "bidirectional-alternating": One bidirectional motion on a single signed
 *   scale (positive = patient's LEFT, negative = patient's RIGHT — the sign
 *   convention pinned by neckSideAgreement.test.ts / trunkSideAgreement.test.ts).
 *   Patient alternates sides. For a DYNAMIC exercise (ex_005) the camera loop
 *   runs ONE state machine fed the ABSOLUTE value of the signed angle, with
 *   the sign at peak time recorded separately so each rep can be tagged left
 *   or right. For an ISOMETRIC exercise no state machine runs; the camera
 *   loop accrues time-in-band PER SIDE from the sign of the angle (the
 *   side-split path, which ex_004 used as an assisted stretch until
 *   2026-09-24 and which is kept intact).
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
 *   - `minVisibleMs` how long a shown cue stays on screen even if its warning
 *                    clears sooner, so a brief cue is still readable
 *
 * `trigger` gives the cue its own switch-on and switch-off levels, in the
 * metric's units, when the metric's `warningThreshold` sits inside the range of
 * correct form. It changes only when the cue appears and disappears: the
 * measurement threshold, the stored time over it and the score are unchanged.
 * For an upper-bound metric `on` must exceed `off`.
 *
 * `evaluation: { mode: "rep-ascent", upTo, persistMs }` judges the warning once
 * per repetition instead of continuously (`repWindowWarning.ts`): per limb,
 * while the movement rises from the repetition start up to `upTo` (primary
 * units; the arm in an arm raise, the head's tilt in a neck side bend),
 * a deviation that stays at or above the switch-on level for `persistMs` flags
 * the repetition, and the flag holds until the repetition ends. Per-limb
 * dynamic exercises only.
 *
 * `hidden` marks a cue that failed the pilot replay check (it was drawn on
 * correct form, or never on the fault it names), or that a review found
 * unsupported or confounded; its reason says which. The warning is still evaluated,
 * latched and logged in the coaching audit, but the selector never gives it the
 * cue slot, so the patient never sees it. Like every cue field, it is coaching
 * configuration only and never enters the measurement version.
 */
export type CompensationCueSpec = {
  id: string;
  message: string;
  priority: number;
  minActiveMs?: number;
  minDisplayMs?: number;
  cooldownMs?: number;
  minVisibleMs?: number;
  trigger?: { on: number; off: number };
  evaluation?: { mode: "rep-ascent"; upTo: number; persistMs: number };
  hidden?: { reason: string; since: string };
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

/**
 * A display-only coaching check: a cue driven by a signal that is NOT a
 * compensation measurement.
 *
 * It goes through the same warning latch, single-cue selector, overlay and
 * coaching audit as a compensation metric's cue. It is never scored, never
 * written to set or repetition measurements, and is removed from the
 * measurement version (`exerciseVersionPayload`), so adding or changing one
 * cannot split a patient's trend. Its threshold and settings
 * are part of the coaching configuration fingerprint instead.
 *
 * `check.mode`:
 *   - "hip-shift-from-stance" (`hipShiftWarning.ts`): the hips' sideways
 *     movement away from the bend side, in hip widths, against the stance just
 *     before each bend (the median of the upright frames in the last
 *     `stanceMs`). Judged from a head lean of `from` (primary units); a shift
 *     that stays at or above the switch-on level for `persistMs` flags the
 *     bend. Bidirectional-alternating dynamic exercises only.
 *   - "elbow-bend" (`elbowBendWarning.ts`): each arm's elbow angle on the
 *     image (180 = straight), warned BELOW the line. An arm is judged while
 *     its own primary is at least `from`. With `hold: "repetition"` an angle
 *     below the line for `persistMs` flags the arm until it is back below the
 *     repetition start; with `hold: "live"` (holds; `persistMs` 0) the live
 *     angle passes through. Per-limb bilateral exercises only.
 */
export type CoachingCheckSpec =
  | {
      name: "hipShift";
      warningThreshold: number;
      cue: CompensationCueSpec;
      check: { mode: "hip-shift-from-stance"; stanceMs: number; from: number; persistMs: number };
    }
  | {
      name: "elbowBend";
      warningThreshold: number;
      compareDirection: "below";
      cue: CompensationCueSpec;
      check: { mode: "elbow-bend"; from: number; persistMs: number; hold: "repetition" | "live" };
    };

/**
 * Every spec whose warning can raise a coaching cue: the compensation metrics,
 * then the display-only coaching checks. The warning latch, cue selector,
 * overlay and coaching configuration read this; scoring and storage read
 * `compensationMetrics` alone.
 */
export function coachingWarningSpecs(definition: ExerciseDefinition): CompensationMetricSpec[] {
  return [...definition.compensationMetrics, ...(definition.coachingChecks ?? [])];
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
      /** Display-only coaching checks; see `CoachingCheckSpec`. */
      coachingChecks?: CoachingCheckSpec[];
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
      /** Display-only coaching checks; see `CoachingCheckSpec`. */
      coachingChecks?: CoachingCheckSpec[];
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
      // Sources (cue review, 2026-10-03; "textbook" above had none): the trunk
      // takes part in arm elevation, a few degrees in healthy people and more
      // when the shoulder is restricted, though mainly as extension and
      // twisting, which this side-lean metric does not measure (Fayad et al.
      // 2008, Brain Res, doi:10.1016/j.brainres.2007.11.046). Trunk tilt is a
      // compensation class in a webcam rehabilitation coach (Cóias et al. 2022,
      // J NeuroEng Rehabil, doi:10.1186/s12984-022-01053-z), and a browser-webcam
      // study agreed with clinicians on trunk lean (Pavlikov et al. 2026,
      // Sensors, doi:10.3390/s26165054). These support the cue in general for
      // arm-raising exercises, not this exercise specifically.
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
      // Added 2026-09-06, matching the caveat ex_005 already carries: the
      // intercept is an IN-REP ENVELOPE EXTRAPOLATION back to zero abduction,
      // not an anatomical resting claim — no frames near 0° informed it.
      // Single-subject pilot fit; not clinician-reviewed.
      // ── `warningThreshold: 0.04` — provenance, recorded 2026-09-06 ──────────
      // An ENGINEERING DEFAULT from a single-subject observation, not a
      // published value. Basis: the raw trunk-up projection sits at ~0.30 at
      // rest, and a deliberate shrug was observed to change it by only
      // ~0.03–0.05 (observed during live tuning, 2026-05-21). 0.04 is the
      // midpoint of that observed delta. It is therefore a "smallest shrug
      // worth flagging" figure for ONE subject on one setup, and carries no
      // normative claim about scapular elevation in any population.
      // The same 0.04 appears on ex_002/ex_005/ex_006; this is the origin note
      // for all of them. No published source has been found for it.
      // Cue evaluation (display only, 2026-10-02): judged once per repetition
      // while the arm rises from the start to 60°, where a shrug used to lift the
      // arm is observed clinically and where the pilot recordings showed it.
      // Continuously, the coupled expectation masked it at the top and it never
      // held for the latch debounce. One smoothed reading at or above the line
      // inside the window flags the repetition (the arm crosses 20-60° in about
      // 0.3 s, two to three frames at the pilot trace rate), and the flag holds
      // to the end of the repetition, so the cue may appear at once. No
      // cooldown: a held per-repetition flag cannot flicker, and each shrugging
      // repetition should get its own cue.
      { name: "scapularElevation",
        cue: {
          id: "ex_001.scapular-elevation",
          message: "Relax your shoulders down.",
          priority: 20,
          minActiveMs: 0,
          cooldownMs: 0,
          evaluation: { mode: "rep-ascent", upTo: 60, persistMs: 0 },
        },
        warningThreshold: 0.04, requiresBaselineCapture: true,
        scoring: { mode: "primary-coupled", intercept: -0.0077, slopePerPrimaryUnit: 0.00124, source: "pilot-fit" } },
      // Uneven shoulder line during the raise — one whole shoulder rides
      // higher than the other (distinct from a symmetric shrug). Drives the
      // per-shoulder overlay boxes + "LOWER" arrow. Starting threshold 5°
      // (above the 3° landmark noise floor); tune live. Band override raises
      // the score floor to 7° (resting asymmetry here is ~3.6°).
      // Cue trigger (display only, 2026-10-01): on at 7, off at 5. Correct
      // posture read 3 to 4.9 with blips to 5.9 in the pilot replay, so the
      // 5 warning line switched the cue on during correct form and its 2.5
      // off level sat below correct posture. 7 is this exercise's own
      // no-deduction floor (SHOULDER_SYMMETRY_ASYMMETRIC_BANDS).
      // HIDDEN 2026-10-03 (cue review; logged, never drawn). Hitching one
      // shoulder to lift the arm is a recognised compensation (Jia et al. 2008,
      // Clin Orthop Relat Res, doi:10.1007/s11999-008-0331-3; Kibler et al.
      // 2013, Br J Sports Med, doi:10.1136/bjsports-2013-092425). In this two-arm
      // raise, though, the shoulder of the higher arm rises with it, so an
      // uneven shoulder line cannot tell a hitch from an uneven raise. The
      // per-arm shrug check above judges each shoulder against its own arm.
      { name: "shoulderSymmetry",
        cue: {
          id: "ex_001.shoulder-symmetry",
          message: "Level your shoulders.",
          priority: 30,
          trigger: { on: 7, off: 5 },
          hidden: {
            reason: "Cue review: in a two-arm raise the higher arm's shoulder rises with it, so the shoulder line cannot tell a hitch from an uneven raise; the per-arm shrug check covers one-sided shrugging.",
            since: "2026-10-03",
          },
        },
        warningThreshold: 5, bandsOverride: SHOULDER_SYMMETRY_ASYMMETRIC_BANDS },
    ],
    // Display-only coaching check, added 2026-10-04 by user decision. A
    // clinical exercise library raises the arm to the side "with your elbow
    // straight" (Physitrack, How to perform the Arm Abduction,
    // https://www.physitrack.com/exercise-library/how-to-perform-the-arm-abduction-exercise).
    // The reading is the elbow's interior angle on the image, 180 when
    // straight. A straight arm reads close to 180 from any camera angle; a bend
    // toward the camera reads smaller than it is, so the check can miss a bend
    // rather than cue a straight arm. One image-based comparison also reported
    // poor elbow-flexion accuracy (Moreira et al. 2024, Sensors, PMID
    // 39771719), which is why only a clear bend is cued.
    // `warningThreshold: 130`, below which the elbow is clearly bent: with the
    // arm raised to 75 or more, the pilot subject's correct raises read 144 at
    // the lowest and slouched raises 136 (one subject; tuning data); no frame
    // read below 135. An engineering line, not a clinical cut-off. Detection
    // is untested, since no pilot recording contains the fault; the
    // groupmates' recordings test it with this value fixed beforehand. `from:
    // 75` matches that analysis. `persistMs: 100` (two trace frames, about
    // three live) keeps one noisy frame from flagging a repetition, and the
    // flag is held until the arm is back at rest. No wait and no cooldown, so
    // each repetition can show its own cue. Last in priority, after the
    // compensation cues above.
    coachingChecks: [
      {
        name: "elbowBend",
        warningThreshold: 130,
        compareDirection: "below",
        check: { mode: "elbow-bend", from: 75, persistMs: 100, hold: "repetition" },
        cue: {
          id: "ex_001.elbow-bend",
          message: "Keep your elbows straight as you raise your arms.",
          priority: 40,
          minActiveMs: 0,
          cooldownMs: 0,
        },
      },
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
        // Forward elevation above 90° was taken as the partial/complete
        // boundary; below this counts as partial.
        // NOTE 2026-09-06: the original comment here asserted that this angle
        // "engages full deltoid + serratus recruitment". That is a
        // physiological claim with NO cited source, so it is WITHDRAWN rather
        // than sourced — this exercise is deprecated and no re-derivation is
        // planned. Treat 90 as an unvalidated engineering default.
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
      // `warningThreshold: 5`: the shared shoulderSymmetry warning boundary.
      // Engineering default set above the documented ~3° landmark noise floor;
      // published CONTEXT, not grounding: inter-rater minimal detectable change
      // for clinical goniometry on human shoulders is 5–11° (Kiatkulanusorn et
      // al., Sci Rep 2023, PMID 38017058), so 5° sits at the lower edge of what
      // the reference method can resolve.
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
  // ex_004 — Neck Lateral Flexion (Active Alternating, Rep-Counted)
  // Patient tilts the head ear-toward-shoulder without assistance, returns to
  // centre, then tilts to the other side. RESTORED 2026-09-24 as an active
  // repetition exercise, replacing the assisted isometric stretch used from
  // 2026-06-11. Repetitions quantify what a hold cannot: active range per side
  // per repetition (the per-side peak trend), count, tempo, left/right
  // symmetry, trunk lean and a shoulder hike, with no hold angle or duration
  // to prescribe and no overpressure on the head. The assisted-stretch
  // definition is in git history and the camera loop's side-split isometric
  // path is kept intact, so it can return unchanged if multi-person
  // recordings show this counting is unreliable.
  //
  // COUNTING MODEL: one signed signal (neckLateralFlexion; positive = patient's
  // LEFT — pinned by neckSideAgreement.test.ts) is split by sign into per-side
  // magnitudes (`splitSignedBySide` in poseMetrics.ts), and each side runs its
  // own RepCounter, as the per-limb arm exercises do. Both designs tried in
  // June 2026 failed live: one counter on |angle| could not tell a return
  // stroke passing neutral from a small deliberate repetition, and a
  // velocity/zero-crossing segmenter ghost-counted small posture adjustments.
  // With the split, a return stroke past neutral lands on the OTHER side's
  // counter, which discards it unless it reaches that side's minimum peak.
  // ────────────────────────────────────────────────────────────────────────
  ex_004: {
    id: "ex_004",
    name: "Neck Lateral Flexion",
    kind: "dynamic",
    bilateral: true,
    bilateralMode: "per-limb",
    primaryMetric: {
      name: "neckLateralFlexion",
      thresholds: {
        // Pipeline units: the ear line is near-horizontal, so on a 16:9 frame
        // a reading is larger than the true tilt. Engineering starting points,
        // to be checked against multi-person recordings; not clinician-approved.
        // At rest the unsmoothed ear-line angle measured ~2.3° SD and ~11°
        // peak-to-peak, the noisiest metric in the registry, and the June 2026
        // thresholds (5° start, 12° minimum peak) sat inside that noise. 12° is
        // the floor already validated for the former hold band's lower edge.
        startThreshold: 12,
        // Half of start: a repetition completes once the head is back near
        // centre, and always when it crosses into the other side (this side's
        // magnitude then reads 0).
        repCompleteThreshold: 6,
        // Peaks below this are discarded as false starts, so a passive
        // overshoot past neutral or a posture adjustment that briefly crosses
        // the start threshold does not count. 18° ≈ 10° of true tilt on 16:9.
        minimumPeakThreshold: 18,
        // "complete" vs "partial" boundary. 30° (the June 2026 starting value)
        // ≈ 18° of true tilt on 16:9: a modest active range, so reduced
        // mobility records partial repetitions instead of losing them.
        targetROM: 30,
      },
    },
    compensationMetrics: [
      // Trunk lean during neck flexion = the whole spine bending instead of
      // the neck. Unbraced-floor band override (6° vs global 2°), measured on
      // the former assisted holds (clean sway 1.8–3.4°); re-check it on active
      // repetitions. The warning threshold stays the tighter 3°.
      // Cue trigger (display only, 2026-10-01): on at 6, off at 5. The 3 warning
      // line sits inside the clean sway above (up to 3.4), so the cue would
      // fire on correct form; 6 is this exercise's no-deduction floor. Not yet
      // checked on a recording of the active exercise.
      // Sources (cue review, 2026-10-03): neck side-bend measurement stabilises
      // the shoulder girdle so the spine below does not add to the bend
      // (University of West Alabama, Cervical Spine Goniometry, a teaching page,
      // not peer reviewed). The neck reading is the head's tilt against the
      // room, so a trunk tilt also adds to it.
      // Cue evaluation (display only, 2026-10-03): judged once per bend, as the
      // arm-raise shrug is. A bend lasts about 1 s, and a continuous cue needs
      // about 0.9 s past its line (0.3 s to switch on, then 0.6 s before it is
      // shown), so a lean inside one bend could not show. One smoothed reading
      // at or above the switch-on level while the head tilts out flags the
      // bend, and the flag holds until the bend is complete. upTo 90 covers the
      // whole rise: no neck reading approaches it.
      { name: "trunkLean",
        cue: {
          id: "ex_004.trunk-lean",
          message: "Keep your torso upright — tilt only your head.",
          priority: 10,
          minActiveMs: 0,
          cooldownMs: 0,
          trigger: { on: 6, off: 5 },
          evaluation: { mode: "rep-ascent", upTo: 90, persistMs: 0 },
        },
        warningThreshold: 3, bandsOverride: TRUNK_LEAN_UNBRACED_BANDS },
      // Uneven shoulder line = hiking a shoulder toward the ear instead of
      // tilting the head. Valid again for the active exercise, where both
      // shoulders stay level (the assisted stretch depressed the opposite
      // shoulder on purpose, so the metric was removed then). Same threshold
      // and resting-asymmetry band override as ex_001. scapularElevation stays
      // excluded: its ear-to-shoulder proxy shrinks by design as the head
      // tilts toward the shoulder.
      // Cue trigger (display only, 2026-10-01): on at 7, off at 5, as on ex_001.
      // Sources (cue review, 2026-10-03), replacing the shoulder-hike reason
      // above: neck side-bend measurement holds the shoulder girdle still
      // (University of West Alabama, Cervical Spine Goniometry), and a published
      // neck stretch anchors the shoulder on the side the head moves away from,
      // to reduce its elevation (ClinicalTrials.gov NCT06635759). In a pilot
      // recording the shoulder line turned with the head (far shoulder up, near
      // shoulder down) instead of one shoulder rising toward the ear. This cue
      // catches either, and because the neck reading is the head's tilt against
      // the room, that turn adds to it.
      // Cue evaluation (display only, 2026-10-03): judged once per bend, as for
      // trunk lean above. The switch-on level 7 is this exercise's own
      // no-deduction floor (SHOULDER_SYMMETRY_ASYMMETRIC_BANDS). It is an
      // engineering default: it has not been checked on correct bends with
      // still shoulders.
      { name: "shoulderSymmetry",
        cue: {
          id: "ex_004.shoulder-symmetry",
          message: "Level your shoulders.",
          priority: 20,
          minActiveMs: 0,
          cooldownMs: 0,
          trigger: { on: 7, off: 5 },
          evaluation: { mode: "rep-ascent", upTo: 90, persistMs: 0 },
        },
        warningThreshold: 5, bandsOverride: SHOULDER_SYMMETRY_ASYMMETRIC_BANDS },
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
        // 15 of head lean is a meaningful side bend; a bend peaking below it is
        // not counted at all. Kept on 2026-10-02 by user decision: 12 would have
        // counted only 2 more of the pilot subject's traced bends.
        minimumPeakThreshold: 15,
        // Set to 17 on 2026-10-02 by user decision, down from 25. The reading
        // is a head-lean angle in pipeline units with no aspect correction, and
        // on a 16:9 frame that squeezes this near-vertical line. The pilot
        // subject's ordinary bends, all full range by the subject's account,
        // read 15.2-26.4 (median 21.2), while the same line leans about 37
        // degrees in the image. 25 had been set as if the reading were degrees
        // and was reached by 3 of 126; at 17, 111 of 126 count as complete. A
        // single-subject engineering value from pilot tuning data, not a
        // clinical target; the groupmates' recordings test it.
        targetROM: 17,
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
      // HIDDEN 2026-10-01 (logged, never drawn): in the pilot replay this cue was
      // drawn on correct side bends and did not separate the deliberate
      // head-tilt fault. The primary here is itself a head-lean angle, so a
      // head tilt raises the primary as well and the coupled residual cannot
      // isolate it. Needs a head-relative-to-trunk metric before it is shown.
      { name: "neckTilt",
        cue: {
          id: "ex_005.neck-tilt",
          message: "Bend from your waist, not your neck.",
          priority: 10,
          hidden: {
            reason: "Pilot replay: drawn on correct side bends and not separated from the head-tilt fault; the head-lean primary moves with a head tilt, so the coupled residual cannot isolate it.",
            since: "2026-10-01",
          },
        },
        warningThreshold: 5,
        scoring: { mode: "primary-coupled", intercept: 11.7093, slopePerPrimaryUnit: 1.50466, source: "pilot-fit" } },
      // Shoulder shrug during side bend = bracing through the shoulder
      // girdle instead of moving from the spine. Also `primary-coupled`: the
      // shoulder line necessarily rises on the lengthening side of a clean
      // bend. Fit: expected ≈ -0.0230 + 0.01306·|trunkFlexion°|.
      // `warningThreshold: 0.04`: engineering default, single-subject origin —
      // see the provenance note on ex_001's scapularElevation entry.
      // HIDDEN 2026-10-02 (logged, never drawn): no clinical source found names
      // shoulder elevation as a compensation in a standing trunk side bend, and
      // the ear-to-shoulder reading changes as the head follows the bend. With
      // the coupled cues off at rest it never appeared in the pilot replay.
      { name: "scapularElevation",
        cue: {
          id: "ex_005.scapular-elevation",
          message: "Relax your shoulders down.",
          priority: 20,
          hidden: {
            reason: "No clinical source found for shoulder elevation as a side-bend compensation; the ear-to-shoulder reading follows the head during the bend.",
            since: "2026-10-02",
          },
        },
        warningThreshold: 0.04, requiresBaselineCapture: true,
        scoring: { mode: "primary-coupled", intercept: -0.0230, slopePerPrimaryUnit: 0.01306, source: "pilot-fit" } },
    ],
    // Display-only coaching check, added 2026-10-02 by user decision. Both
    // compensation cues above are hidden, and exercise and
    // range-of-motion sources name the hips or pelvis shifting as a side-bend
    // compensation. Hips pushed away from the bend side also inflate the
    // head-lean primary, which runs from the hip midpoint to the ears.
    // `warningThreshold: 0.45` hip widths: on 118 ordinary pilot repetitions
    // (one subject; tuning data) the largest single-frame push was 0.42;
    // 0.40 was crossed by 2 repetitions and 0.35 by 5.
    // An engineering line, not a clinical cut-off. Detection is untested, since
    // no pilot recording contains the fault; the groupmates' recordings test it
    // with this value fixed beforehand. `stanceMs` and `from` match that
    // analysis; `persistMs: 100` (two trace frames, about three live) keeps one
    // noisy frame from flagging a bend. No wait and no cooldown, so each bend
    // can show its own cue.
    coachingChecks: [
      {
        name: "hipShift",
        warningThreshold: 0.45,
        check: { mode: "hip-shift-from-stance", stanceMs: 1500, from: 10, persistMs: 100 },
        cue: {
          id: "ex_005.hip-shift",
          message: "Keep your hips over your feet as you bend.",
          priority: 30,
          minActiveMs: 0,
          cooldownMs: 0,
        },
      },
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
      // Added 2026-09-06, matching the caveat ex_005 already carries: the
      // intercept is an IN-REP ENVELOPE EXTRAPOLATION back to zero abduction,
      // not an anatomical resting claim — an isometric hold supplies almost no
      // frames away from the target band. Single-subject pilot fit.
      // `warningThreshold: 0.04`: engineering default, single-subject origin —
      // see the provenance note on ex_001's scapularElevation entry.
      // HIDDEN 2026-10-01 (logged, never drawn): in the pilot replay this cue was
      // drawn on 100% of correct holds. The coupled expectation at 90° comes from
      // one earlier session and did not transfer: a later session's correct
      // holds sat about 0.08 above it, against a 0.04 threshold.
      { name: "scapularElevation",
        cue: {
          id: "ex_006.scapular-elevation",
          message: "Relax your shoulders down.",
          priority: 10,
          hidden: {
            reason: "Pilot replay: drawn on 100% of correct holds; the pilot-fit expectation at 90° did not transfer between sessions (correct-hold residual about 0.08 against a 0.04 threshold).",
            since: "2026-10-01",
          },
        },
        warningThreshold: 0.04, requiresBaselineCapture: true,
        scoring: { mode: "primary-coupled", intercept: -0.0142, slopePerPrimaryUnit: 0.00093, source: "pilot-fit" } },
      // Trunk lean during T-pose hold = unbalanced load between arms. Keeps the
      // global floor — clean T-pose trunk lean is ~1° (mean deduction ~2.8).
      // Sources (cue review, 2026-10-03): as for ex_001's trunk lean (Fayad et
      // al. 2008; Cóias et al. 2022; Pavlikov et al. 2026). The pilot replay drew
      // it on a recorded lean and never on correct holds.
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
      // Cue trigger (display only, 2026-10-01): on at 7, off at 5. With the old
      // 5 on / 2.5 off levels a brief spike as the arms came up latched the cue
      // and correct holds (about 3 to 4.9) never cleared it, so it stayed on
      // through whole correct holds and was hidden for one round.
      // Sources (cue review, 2026-10-03): hitching the shoulder girdle to hold
      // the arm at 90° is the position of the clinical shrug sign (Jia et al.
      // 2008, Clin Orthop Relat Res, doi:10.1007/s11999-008-0331-3). Both arms
      // stay near 90° here, so arm height confounds the shoulder line less than
      // in the two-arm raise. It is the hold's only visible shoulder cue.
      { name: "shoulderSymmetry",
        cue: {
          id: "ex_006.shoulder-symmetry",
          message: "Level your shoulders.",
          priority: 30,
          trigger: { on: 7, off: 5 },
        },
        warningThreshold: 5, bandsOverride: SHOULDER_SYMMETRY_ASYMMETRIC_BANDS },
    ],
    // Display-only coaching check, added 2026-10-04 by user decision: the same
    // elbow reading, source and 130 line as on ex_001 (see the comment there).
    // The same library keeps the "elbows straight" while the arm is out. In the
    // pilot subject's arm holds (one subject; tuning data) the elbows read 163
    // at the lowest. Judged from `from: 80`, the bottom of the target band. A
    // hold has no repetitions, so `hold: "live"` passes the live angle and the
    // cue clears once the arms are straightened; the warning latch's debounce
    // and the default cue wait give the persistence (`persistMs` 0). Last in
    // priority, after the compensation cues above.
    coachingChecks: [
      {
        name: "elbowBend",
        warningThreshold: 130,
        compareDirection: "below",
        check: { mode: "elbow-bend", from: 80, persistMs: 0, hold: "live" },
        cue: {
          id: "ex_006.elbow-bend",
          message: "Keep your elbows straight.",
          priority: 40,
        },
      },
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
        // `warningThreshold: 5`: the shared trunkLean warning boundary.
        // Engineering default set above the documented ~3° landmark noise
        // floor. Published CONTEXT, not grounding: inter-rater minimal
        // detectable change for clinical goniometry on human shoulders is
        // 5–11° (Kiatkulanusorn et al., Sci Rep 2023, PMID 38017058), so 5°
        // sits at the lower edge of what the reference method can resolve.
        // Cue review (2026-10-03): kept, on the general support for trunk lean
        // in arm raising recorded on ex_001's trunk lean. Leaning back, the
        // press's usual fault, is out of the image plane and is not measured.
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
      // HIDDEN 2026-10-01 (logged, never drawn): in the pilot replay this cue
      // never appeared, including on deliberately bent-arm presses. Bent elbows
      // lower the wrist, so a bent press tops out below the near-peak gate
      // (0.9 × targetROM) and the warning is never allowed to latch. Needs a
      // top-of-repetition gate rather than an absolute height before it is shown.
      // Cue review (2026-10-03): stays hidden. A bent-arm press is a short
      // press, which the repetition result already reports as partial, and the
      // elbow angle is the least accurate monocular measure (Moreira et al.
      // 2024, Sensors, PMID 39771719).
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
          hidden: {
            reason: "Pilot replay: never drawn, including on bent-arm presses; a bent press tops out below the near-peak gate (0.9 x targetROM), so the warning cannot latch.",
            since: "2026-10-01",
          },
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
      // Cue review (2026-10-03): kept, on the general support for trunk lean in
      // arm raising recorded on ex_001's trunk lean only. Wall-angel instructions
      // name keeping the arms on the wall and not shrugging, not a side lean
      // (University of Illinois Extension, Wall Angels; Hinge Health, How to do
      // wall angels), and the arms or back leaving the wall is out of the
      // image plane.
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
      // HIDDEN 2026-10-03 (cue review; logged, never drawn). Wall-angel
      // instructions ask for the arms to stay on the wall as they slide up, not
      // for straight elbows (University of Illinois Extension, Wall Angels;
      // Hinge Health, How to do wall angels), so this cue could pull the arms
      // off the wall. The elbow angle is also the least accurate monocular
      // measure (Moreira et al. 2024, Sensors, PMID 39771719).
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
          hidden: {
            reason: "Cue review: wall-angel instructions ask for the arms to stay on the wall, not for straight elbows, so the cue could pull the arms off the wall; the elbow angle is the least accurate camera measure.",
            since: "2026-10-03",
          },
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
    for (const comp of coachingWarningSpecs(def)) {
      if (!comp.cue) continue;
      const kind = def.compensationMetrics.includes(comp) ? "compensation metric" : "coaching check";
      const owner = `${def.id} ${kind} "${comp.name}"`;
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
        ["minVisibleMs", comp.cue.minVisibleMs],
      ] as const) {
        if (value !== undefined && !(Number.isFinite(value) && value >= 0)) {
          throw new Error(
            `Registry invariant violated for ${owner}: coaching cue ` +
            `"${comp.cue.id}" ${field} (${value}) must be a non-negative ` +
            `finite number of milliseconds.`
          );
        }
      }
      if (comp.cue.trigger !== undefined) {
        const { on, off } = comp.cue.trigger;
        const below = comp.compareDirection === "below";
        if (!Number.isFinite(on) || !Number.isFinite(off) || (below ? !(on < off) : !(on > off && off >= 0))) {
          throw new Error(
            `Registry invariant violated for ${owner}: coaching cue ` +
            `"${comp.cue.id}" trigger (on ${on}, off ${off}) must be finite, ` +
            (below ? "with on below off." : "with on above off and off at least 0.")
          );
        }
      }
      if (comp.cue.evaluation !== undefined) {
        const { mode, upTo, persistMs } = comp.cue.evaluation;
        const perLimbDynamic = def.kind === "dynamic" && def.bilateral && def.bilateralMode === "per-limb";
        if (
          mode !== "rep-ascent" || !perLimbDynamic ||
          !Number.isFinite(upTo) || !(upTo > def.primaryMetric.thresholds.startThreshold) ||
          !Number.isFinite(persistMs) || persistMs < 0
        ) {
          throw new Error(
            `Registry invariant violated for ${owner}: coaching cue ` +
            `"${comp.cue.id}" evaluation must be rep-ascent on a per-limb dynamic ` +
            `exercise, with upTo above the repetition start and persistMs at least 0.`
          );
        }
      }
      seenCueIds.set(comp.cue.id, owner);
    }
  }

  // Display-only coaching checks. Latches and cues are keyed by metric name,
  // so a check must not share one with a compensation metric.
  for (const def of Object.values(EXERCISE_REGISTRY)) {
    if (!def.coachingChecks) continue;
    const names = new Set<MetricName>(def.compensationMetrics.map((comp) => comp.name));
    for (const check of def.coachingChecks) {
      const owner = `${def.id} coaching check "${check.name}"`;
      if (check.name === "hipShift") {
        const { mode, stanceMs, from, persistMs } = check.check;
        if (
          def.kind !== "dynamic" || mode !== "hip-shift-from-stance" ||
          !def.bilateral || def.bilateralMode !== "bidirectional-alternating"
        ) {
          throw new Error(
            `Registry invariant violated for ${owner}: the hip-shift-from-stance ` +
            `check is named "hipShift" and needs a bidirectional-alternating dynamic exercise.`
          );
        }
        if (
          !(Number.isFinite(check.warningThreshold) && check.warningThreshold > 0) ||
          !(Number.isFinite(stanceMs) && stanceMs > 0) ||
          !(Number.isFinite(from) && from >= def.primaryMetric.thresholds.startThreshold) ||
          !(Number.isFinite(persistMs) && persistMs >= 0)
        ) {
          throw new Error(
            `Registry invariant violated for ${owner}: warningThreshold and stanceMs ` +
            `must be positive, from at least the repetition start, and persistMs at least 0.`
          );
        }
      } else {
        // An elbow angle runs from 0 to 180 and is warned below the line; a
        // repetition hold needs a dynamic exercise's repetition start, and a
        // live hold has no persistence of its own.
        const { mode, from, persistMs, hold } = check.check;
        const repetition = hold === "repetition";
        if (
          mode !== "elbow-bend" || check.compareDirection !== "below" ||
          !def.bilateral || def.bilateralMode !== "per-limb" ||
          (repetition ? def.kind !== "dynamic" : hold !== "live")
        ) {
          throw new Error(
            `Registry invariant violated for ${owner}: the elbow-bend check is named ` +
            `"elbowBend", warns below its line, needs a per-limb bilateral exercise, ` +
            `and holds per repetition only on a dynamic exercise.`
          );
        }
        if (
          !(Number.isFinite(check.warningThreshold) && check.warningThreshold > 0 && check.warningThreshold < 180) ||
          !Number.isFinite(from) ||
          (def.kind === "dynamic" && !(from >= def.primaryMetric.thresholds.startThreshold)) ||
          !(Number.isFinite(persistMs) && persistMs >= 0) || (!repetition && persistMs !== 0)
        ) {
          throw new Error(
            `Registry invariant violated for ${owner}: warningThreshold must lie ` +
            `between 0 and 180, from be finite (at least the repetition start on a ` +
            `dynamic exercise), and persistMs at least 0 (0 for a live hold).`
          );
        }
      }
      if (names.has(check.name)) {
        throw new Error(
          `Registry invariant violated for ${owner}: the name is already used by ` +
          `another compensation metric or check on this exercise.`
        );
      }
      names.add(check.name);
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
