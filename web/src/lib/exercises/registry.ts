/**
 * registry.ts
 *
 * Per-exercise definitions that drive rep counting, metric display, and
 * compensation tracking. Keyed by exercise IDs that match `admin_exercises`
 * seed data (ex_001…ex_006). When admin_exercises migrates from localStorage
 * to Postgres, this registry stays unchanged — the join is by id.
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
 *   - `minimumPeakThreshold`   — minimum peak angle for "complete" classification;
 *                                below this counts as "partial"
 *   - `targetROM`              — clinically prescribed full ROM; reps reaching
 *                                this are classified "complete" rather than partial
 *
 * For an `isometric` exercise, the state machine is NOT used. Instead, the
 * camera loop accumulates time-in-target-band using `isometric.targetBand`.
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
  | "shoulderAbduction"   // arm out to the side, used by lateral arm raise
  | "shoulderFlexion"     // arm forward/overhead, used by overhead arm raise
  | "scapularElevation"   // shoulder-to-ear vertical distance, used by shrugs
  | "neckLateralFlexion"  // head tilting ear-to-shoulder, used by neck flexion ex
  | "trunkLateralFlexion" // torso side-bending, used by standing side bends
  | "shoulderHorizAbd"    // arm held at 90° abduction (T-pose), used by isometric hold
  | "trunkLean"           // existing — used as compensation metric
  | "shoulderSymmetry"    // existing — used as compensation metric
  | "neckTilt";           // existing — used as compensation metric

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
 * "bidirectional-alternating": One bidirectional motion (left tilts negative,
 *   right tilts positive on the same signed scale). Patient alternates
 *   sides each rep. Camera loop runs ONE state machine fed the ABSOLUTE
 *   value of the signed angle, with the sign at peak time recorded
 *   separately so each rep can be tagged left or right.
 *
 * Unilateral exercises (bilateral: false) ignore this field.
 */
export type BilateralMode = "per-limb" | "bidirectional-alternating";


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
  };
};

/**
 * A metric displayed and logged but NOT used for rep counting.
 * `warningThreshold` is the value above which the metric is visually
 * flagged in the UI as a likely compensation pattern. Same units as the
 * underlying metric.
 */
export type CompensationMetricSpec = {
  name: MetricName;
  warningThreshold: number;
};

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
      primaryMetric: PrimaryMetricSpec;
      compensationMetrics: CompensationMetricSpec[];
    }
  | {
      id: string;
      name: string;
      kind: "isometric";
      bilateral: boolean;
      bilateralMode?: BilateralMode;
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
        // 60° distinguishes a partial (struggle / fatigue) rep from a full one.
        // Patients in early rehab often plateau around 45–60° before regaining
        // full ROM. Below 60°, count as partial; at or above, count as complete.
        minimumPeakThreshold: 60,
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
      // the lift. Trunk lean ≥ 5° during the rep should flag.
      { name: "trunkLean", warningThreshold: 5 },
      // Shoulder shrug (scapular elevation) is the second-most-common
      // compensation — patients hike the trapezius to substitute for
      // weak deltoid. Surfaced as a warning when shrug exceeds the
      // shrug exercise's own start threshold.
      { name: "scapularElevation", warningThreshold: 0.04 },
    ],
  },

  // ────────────────────────────────────────────────────────────────────────
  // ex_002 — Overhead Arm Raises (Shoulder Flexion)
  // Patient raises arms forward and up overhead. Sagittal-plane motion;
  // foreshortened on a front-facing camera (acknowledged limitation,
  // proposal page 10, depth ambiguity).
  // ────────────────────────────────────────────────────────────────────────
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
      { name: "trunkLean", warningThreshold: 5 },
      { name: "scapularElevation", warningThreshold: 0.04 },
    ],
  },

  // ────────────────────────────────────────────────────────────────────────
  // ex_003 — Shoulder Shrugs (Scapular Elevation)
  // Patient lifts both shoulders toward ears, holds briefly, releases.
  // Metric is normalized vertical shoulder-to-ear distance — small absolute
  // displacement, so thresholds are normalized to torso length for scale
  // invariance across patients of different sizes.
  // ────────────────────────────────────────────────────────────────────────
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
      { name: "shoulderSymmetry", warningThreshold: 5 },
    ],
  },

  // ────────────────────────────────────────────────────────────────────────
  // ex_004 — Neck Lateral Flexion (Cervical Side Bending)
  // Patient tilts head ear-toward-shoulder, alternating sides. Bilateral
  // by prescription convention ("10 each side"). Independent state machines
  // per side handle the natural left/right sequence cleanly.
  // ────────────────────────────────────────────────────────────────────────
  ex_004: {
    id: "ex_004",
    name: "Neck Lateral Flexion",
    kind: "dynamic",
    bilateral: true,
    bilateralMode: "bidirectional-alternating",
    primaryMetric: {
      name: "neckLateralFlexion",
      thresholds: {
        // Above the ±2° dead-band already used by `computeLateralNeckTilt`.
        startThreshold: 5,
        repCompleteThreshold: 2,
        // Minimum peak to count as a rep at all. Peaks below this are
        // silently discarded as false starts. 12° (lowered from the
        // original 20° literature value in May 2026 for the rehab pilot)
        // — also acts as the noise/settle guard for the bidirectional
        // abs() path: post-rep return wobble rarely exceeds 12°, so this
        // suppresses the opposite-side phantom reps that a lower floor
        // (the reverted three-tier 4°) let through. Tradeoff accepted:
        // genuine sub-12° reduced-ROM tilts are not counted.
        minimumPeakThreshold: 12,
        // Healthy adult cervical lateral flexion ROM is 30–45°; conservative
        // home-exercise target is 30°. Source: AAOS clinical assessment ROM
        // norms.
        targetROM: 30,
      },
      // neckLateralFlexion is a signed angle in degrees, range ~0–30°. The
      // global degree-scale default (1.0, 0.1) was tuned for the 0–150°
      // arm-raise range; at ~5× smaller scale it is too light and landmark
      // jitter crosses the 5° startThreshold, accumulating phantom reps
      // while the patient holds still (same failure mode ex_003 documents,
      // milder — its signal is ~3000× smaller, this one ~5×). minCutoff is
      // the dominant knob for at-rest jitter rejection; beta barely matters
      // here since |dxHat| stays small at low speed. STARTING values —
      // expected to need one tuning iteration against the live stillness
      // diagnostic before being treated as final.
      smoothing: { minCutoff: 0.5, beta: 0.05 },
    },
    compensationMetrics: [
      // Trunk lean during neck flexion = patient is bending the whole spine
      // instead of isolating the neck. Strong quality indicator.
      { name: "trunkLean", warningThreshold: 3 },
      // Asymmetric shoulder elevation during neck flexion = patient is
      // raising the shoulder to meet the ear instead of lowering the ear.
      { name: "shoulderSymmetry", warningThreshold: 5 },
    ],
  },

  // ────────────────────────────────────────────────────────────────────────
  // ex_005 — Standing Side Bends (Trunk Lateral Flexion)
  // Patient stands upright, bends torso to one side, returns to neutral,
  // alternates. Same bilateral-with-independent-state-machines pattern
  // as neck flexion.
  // ────────────────────────────────────────────────────────────────────────
  ex_005: {
    id: "ex_005",
    name: "Standing Side Bends",
    kind: "dynamic",
    bilateral: true,
    bilateralMode: "bidirectional-alternating",
    primaryMetric: {
      name: "trunkLateralFlexion",
      thresholds: {
        // Above the 2° dead-band used by trunkLean.
        startThreshold: 5,
        repCompleteThreshold: 2,
        // 15° is a meaningful side bend; below this counts as partial.
        minimumPeakThreshold: 15,
        // Healthy adult lumbar lateral flexion ROM is 20–30°. Target the
        // conservative end for home prescription. Source: AAOS norms.
        targetROM: 25,
      },
    },
    compensationMetrics: [
      // Neck tilt during a trunk side bend usually means the patient is
      // tilting their head INSTEAD of bending the trunk — common on the
      // side where trunk mobility is restricted.
      { name: "neckTilt", warningThreshold: 5 },
      // Shoulder shrug during side bend = bracing through the shoulder
      // girdle instead of moving from the spine.
      { name: "scapularElevation", warningThreshold: 0.04 },
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
      { name: "scapularElevation", warningThreshold: 0.04 },
      // Trunk lean during T-pose hold = unbalanced load between arms.
      { name: "trunkLean", warningThreshold: 5 },
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
 * Validates the registry's threshold invariants at module load time.
 * Catches typos in threshold values that would otherwise silently break
 * rep counting (e.g., repCompleteThreshold accidentally set higher than
 * startThreshold). Throws on the first violation so the build fails loudly.
 *
 * Called once at the bottom of this file. Has no runtime cost in production
 * once the registry is verified — the JIT eliminates the dead checks.
 */
function validateRegistry(): void {
  for (const def of Object.values(EXERCISE_REGISTRY)) {
    if (def.bilateral && !def.bilateralMode) {
      throw new Error(
        `Registry invariant violated for ${def.id}: ` +
        `bilateral exercises must declare bilateralMode ` +
        `("per-limb" or "bidirectional-alternating").`
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
      }
    }
    if (def.kind === "isometric") {
      if (def.isometric.targetBand.tolerance <= 0) {
        throw new Error(
          `Registry invariant violated for ${def.id}: ` +
          `isometric tolerance must be positive.`
        );
      }
    }
  }
}

validateRegistry();