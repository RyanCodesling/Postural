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
 *   - `minimumPeakThreshold`   — DISCARD FLOOR. Peaks below this are silently
 *                                dropped as false starts — NO rep counted at all.
 *                                Peaks ≥ minimumPeakThreshold count as at least
 *                                "partial"; ≥ targetROM count as "complete."
 *                                (Fixed 2026-05-21 — earlier doc here said this
 *                                was the partial/complete boundary, which is
 *                                wrong; that boundary is `targetROM`. See
 *                                the classification comments in repCounter.ts and the
 *                                ex_004 inline comment for the authoritative
 *                                semantics.)
 *   - `targetROM`              — clinically prescribed full ROM. THIS is the
 *                                "complete" vs "partial" classification boundary:
 *                                peak ≥ targetROM             → "complete";
 *                                minimumPeakThreshold ≤ peak < targetROM → "partial";
 *                                peak < minimumPeakThreshold  → discarded silently.
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
  | "shoulderAbduction"      // arm out to the side, used by ex_001 lateral arm raise + ex_008 wall angels
  | "shoulderFlexion"        // arm forward/overhead, used by ex_002 (DEPRECATED 2026-05-21, kept for back-compat)
  | "scapularElevation"      // shoulder-to-ear vertical distance, used by ex_003 (DEPRECATED 2026-05-21, kept for back-compat) + compensation on ex_001/ex_006 only; ex_007/ex_008 deferred pending compensation-baseline capture
  | "neckLateralFlexion"     // head tilting ear-to-shoulder, used by ex_004 neck lateral flexion
  | "trunkLateralFlexion"    // torso side-bending, used by ex_005 standing side bends
  | "shoulderHorizAbd"       // arm held at 90° abduction (T-pose), used by ex_006 isometric hold
  | "trunkLean"              // existing — used as compensation metric on ex_001/ex_004/ex_005/ex_006/ex_007/ex_008
  | "shoulderSymmetry"       // existing — used as compensation metric on ex_001/ex_004/ex_006 (and deprecated ex_003)
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
 * "bidirectional-alternating": One bidirectional motion (left tilts negative,
 *   right tilts positive on the same signed scale). Patient alternates
 *   sides each rep. Camera loop runs ONE state machine fed the ABSOLUTE
 *   value of the signed angle, with the sign at peak time recorded
 *   separately so each rep can be tagged left or right.
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
export type CompensationMetricSpec = {
  name: MetricName;
  warningThreshold: number;
  compareDirection?: "above" | "below";
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
      /**
       * Optional strategy override for signed bidirectional rep segmentation.
       * Defaults to the magnitude/neutral-settle wrapper. ex_004 uses the
       * velocity strategy so passive return-stroke overshoot does not count as
       * an opposite-side rep while loose-neutral deliberate alternation still
       * counts.
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
      // the lift. Trunk lean ≥ 5° during the rep should flag.
      { name: "trunkLean", warningThreshold: 5 },
      // Shoulder shrug (scapular elevation) is the second-most-common
      // compensation — patients hike the trapezius to substitute for
      // weak deltoid. Surfaced as a warning when shrug exceeds the
      // shrug exercise's own start threshold.
      { name: "scapularElevation", warningThreshold: 0.04, requiresBaselineCapture: true },
      // Uneven shoulder line during the raise — one whole shoulder rides
      // higher than the other (distinct from a symmetric shrug). Drives the
      // per-shoulder overlay boxes + "LOWER" arrow. Starting threshold 5°
      // (above the 3° landmark noise floor); tune live.
      { name: "shoulderSymmetry", warningThreshold: 5 },
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
      { name: "shoulderSymmetry", warningThreshold: 5 },
    ],
  },

  // ────────────────────────────────────────────────────────────────────────
  // ex_004 — Neck Lateral Flexion (Cervical Side Bending)
  // Patient tilts head ear-toward-shoulder, alternating sides. Bilateral
  // by prescription convention ("10 each side"). A signed bidirectional
  // segmenter tags left/right from the peak sign.
  // ────────────────────────────────────────────────────────────────────────
  ex_004: {
    id: "ex_004",
    name: "Neck Lateral Flexion",
    kind: "dynamic",
    bilateral: true,
    bilateralMode: "bidirectional-alternating",
    bidirectionalRepStrategy: "velocity-zero-crossing",
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
      // milder — its signal is ~3000× smaller, this one ~5×). The velocity
      // segmenter also reads the filter's smoothed derivative, so ex_004 uses
      // a lower derivative cutoff to avoid near-neutral velocity spikes. These
      // are live-tuned starting values; too much smoothing can lag real reps.
      smoothing: { minCutoff: 0.45, beta: 0.04, dCutoff: 0.8 },
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
      // side where trunk mobility is restricted.
      { name: "neckTilt", warningThreshold: 5 },
      // Shoulder shrug during side bend = bracing through the shoulder
      // girdle instead of moving from the spine.
      { name: "scapularElevation", warningThreshold: 0.04, requiresBaselineCapture: true },
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
      { name: "scapularElevation", warningThreshold: 0.04, requiresBaselineCapture: true },
      // Trunk lean during T-pose hold = unbalanced load between arms.
      { name: "trunkLean", warningThreshold: 5 },
      // Uneven shoulder line during the hold — one shoulder rides higher than
      // the other. Drives the per-shoulder overlay boxes + "LOWER" arrow.
      // Starting threshold 5° (above the 3° landmark noise floor); tune live.
      { name: "shoulderSymmetry", warningThreshold: 5 },
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
  // THRESHOLD STATUS (2026-05-21): starting estimates. NOT pilot-calibrated.
  //   Live-tuning pass expected before final validation; revise here when
  //   empirical traces come in. Don't treat current values as final.
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
        // partial presses can be recorded. Peaks in [0.21, 0.6) classify as
        // `partial`; >= 0.6 (targetROM) classify as `complete`.
        minimumPeakThreshold: 0.21,
        // 0.6 = ~60% of trunk length above shoulder, ≈ arms fully extended
        // overhead. STARTING value.
        targetROM: 0.6,
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
      { name: "trunkLean", warningThreshold: 5 },
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
      { name: "elbowFlexion", warningThreshold: 150, compareDirection: "below", peakRelevant: true },
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
  // THRESHOLD STATUS (2026-05-21): starting estimates. NOT pilot-calibrated.
  //   Live-tuning pass expected before final validation.
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
        // Reuse ex_001's resting noise floor and hysteresis band — same
        // underlying metric, same noise profile.
        startThreshold: 20,
        repCompleteThreshold: 10,
        // 100° = arm well into the overhead range. Wall Angels' ROM goes
        // past horizontal (90°) up toward overhead (~150°), so a 60° floor
        // (ex_001's value) is too lax here — it would count a horizontal
        // arm raise as a "partial" Wall Angel, which it isn't.
        // STARTING value, live-tuning required.
        minimumPeakThreshold: 100,
        // 150° ≈ arms-overhead position at full extension along the wall.
        // Foreshortening at full overhead is an accepted thesis limitation
        // (known foreshortening limitation in computeShoulderAbduction).
        // STARTING value.
        targetROM: 150,
      },
      // No descentEpsilon override (degree-scale, global 0.5 is fine).
      // No smoothing override (global degree-scale default fine).
    },
    compensationMetrics: [
      // Trunk lean = patient is using torso shift to slide arms up the wall
      // instead of recruiting shoulder muscles.
      { name: "trunkLean", warningThreshold: 5 },
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
      { name: "elbowFlexion", warningThreshold: 150, compareDirection: "below", peakRelevant: true },
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
