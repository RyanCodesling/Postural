/**
 * poseMetrics.ts
 *
 * Computes clinically-oriented pose metrics from MediaPipe Pose landmarks,
 * with camera-tilt correction via a consensus-based reference system.
 *
 * Landmark indices used (MediaPipe Pose, 33-point model):
 *   7  = left ear
 *   8  = right ear
 *  11  = left shoulder
 *  12  = right shoulder
 *  23  = left hip
 *  24  = right hip
 *
 * All landmarks are normalized: x and y are in the range [0, 1].
 * IMPORTANT: In this coordinate system, y = 0 is the TOP of the frame
 * and y = 1 is the BOTTOM. This is the opposite of standard math convention
 * and affects how we interpret angle signs throughout this file.
 */

import type { ExerciseDefinition, MetricName } from "@/lib/exercises/registry";

type LM = { x: number; y: number; visibility?: number };

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — FOUNDATIONAL GEOMETRY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * lineAngleDeg
 *
 * Returns the angle (in degrees) of the line from point A to point B,
 * measured relative to the positive x-axis (i.e., rightward horizontal).
 *
 * Uses atan2(dy, dx), which is the standard way to find the direction of
 * a 2D vector. The result is in the range (-180°, +180°].
 *
 * Because y increases DOWNWARD in normalized coords:
 *   - A perfectly level line (same y for both points) → 0°
 *   - A line sloping DOWN to the right                → positive angle
 *   - A line sloping UP to the right                  → negative angle
 *
 * This convention means: if the LEFT landmark is higher (smaller y) than
 * the RIGHT landmark, dy is positive (right.y > left.y), so the angle
 * is positive. We use this consistently across all landmark pairs.
 */
function lineAngleDeg(a: LM, b: LM): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y; // positive = b is LOWER in the frame than a
  return Math.atan2(dy, dx) * (180 / Math.PI);
}

/**
 * angleDiffDeg
 *
 * Returns the signed difference (a - b) between two angles in degrees,
 * normalized to the range [-180°, +180°].
 *
 * We need this normalization because angles can wrap around. For example,
 * the difference between 179° and -179° is only 2°, not 358°. Without
 * normalization, the consensus check could falsely flag two nearly-identical
 * angles as divergent when they straddle the ±180° boundary.
 */
function angleDiffDeg(a: number, b: number): number {
  let diff = a - b;
  while (diff > 180)  diff -= 360;
  while (diff < -180) diff += 360;
  return diff;
}

/** Read MediaPipe visibility score, defaulting to 1 if the field is absent. */
function vis(p: LM): number {
  return typeof p.visibility === "number" ? p.visibility : 1;
}

/**
 * MIN_VIS
 *
 * Minimum visibility score (0–1) required for a landmark to participate
 * in any calculation. Values below 0.5 indicate partial or full occlusion.
 * Using them would introduce noise that looks like real postural data.
 */
const MIN_VIS = 0.5;

function pairVisible(a: LM | undefined, b: LM | undefined): boolean {
  return !!a && !!b && vis(a) >= MIN_VIS && vis(b) >= MIN_VIS;
}

/**
 * bodyPairAngleDeg
 *
 * Returns the angle of the line connecting a left/right body landmark pair,
 * measured in image coordinates relative to the positive x-axis.
 *
 * MediaPipe labels landmarks from the SUBJECT'S perspective. For a patient
 * facing the camera, the "left" landmark (e.g. landmarks[23] left hip)
 * appears on the camera's RIGHT side of the image (larger x value). If we
 * naively call lineAngleDeg(leftHip, rightHip), the resulting vector points
 * in the negative-x direction and atan2 returns ±180° instead of ~0° for
 * a level body line.
 *
 * This helper takes the pair in subject order (left, right) but computes
 * the camera-order vector (right → left, i.e. left-to-right in image space)
 * so the result matches the "level → 0°" convention used throughout this file.
 */
function bodyPairAngleDeg(subjectLeft: LM, subjectRight: LM): number {
  return lineAngleDeg(subjectRight, subjectLeft);
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — CONSENSUS TILT REFERENCE
// ─────────────────────────────────────────────────────────────────────────────

export type TiltConfidence = "high" | "low" | "insufficient";

export type TiltReference = {
  /**
   * Estimated camera tilt in degrees.
   * Positive = camera tilted clockwise (right side of camera is lower).
   * This value is subtracted from raw metric angles to isolate body-relative angles.
   */
  cameraTiltDeg: number;

  confidence: TiltConfidence;

  /**
   * Angular divergence between the hip line and ear line, in degrees.
   * Only present when both lines were visible.
   *
   * A large divergence means at least one body segment is genuinely deviated —
   * a lateral trunk lean, a head tilt, or both. This is a clinical data point
   * in its own right and should be surfaced to the therapist.
   */
  divergenceDeg: number | null;
};

/**
 * AGREEMENT_THRESHOLD_DEG
 *
 * Maximum angular difference between the hip line and ear line for them
 * to be considered "in agreement" about the camera tilt.
 *
 * Why 3°?
 * - MediaPipe Full model has a landmark placement noise floor of ~1–2°
 * - A 1° buffer on top brings us to 3°
 * - Any divergence larger than 3° cannot be reliably attributed to
 *   measurement noise alone and is more likely a real body asymmetry
 */
const AGREEMENT_THRESHOLD_DEG = 3;

/**
 * computeTiltReference
 *
 * ── THE CORE INSIGHT ─────────────────────────────────────────────────────────
 * A camera tilt rotates the entire image frame uniformly. Every real-world
 * horizontal line will appear at the same angle in the image — an angle
 * exactly equal to the camera tilt. This means we can estimate the camera
 * tilt by measuring lines that should be horizontal on a neutral body.
 *
 * ── WHY TWO REFERENCES? ──────────────────────────────────────────────────────
 * Any single body line can be wrong for two independent reasons simultaneously:
 *   (a) the camera is tilted, and
 *   (b) the patient's body is genuinely asymmetric at that segment.
 * A single line cannot distinguish between these cases.
 *
 * With two independent reference lines, we can check for agreement:
 *   Hip line (LM23 → LM24): unaffected by neck or shoulder pathology
 *   Ear line (LM7  → LM8 ): unaffected by shoulder or hip pathology
 *
 * If they agree → the angle they share is almost certainly from the camera.
 * If they disagree → one segment is deviated, and we can't perfectly isolate
 * the camera tilt. We fall back to hips (more stable in this population)
 * and flag low confidence.
 *
 * ── WHY NOT SHOULDERS AS A REFERENCE? ────────────────────────────────────────
 * Shoulder line (LM11 → LM12) is the primary metric we're measuring. Using it
 * as its own reference would cause us to subtract out the very asymmetry we're
 * trying to detect. The system would always report "Level" for shoulders.
 *
 * ── CONFIDENCE LEVELS ────────────────────────────────────────────────────────
 * HIGH:         Both references visible and agree within AGREEMENT_THRESHOLD_DEG.
 *               Average of the two lines is the camera tilt estimate.
 *
 * LOW:          Only one reference visible, OR both visible but diverging.
 *               Prefer hips as the estimate when both are available.
 *               Metrics are still computed but flagged in the UI.
 *
 * INSUFFICIENT: Neither reference visible.
 *               Assume 0° tilt — no correction applied.
 */
export function computeTiltReference(landmarks: LM[]): TiltReference {
  const leftHip  = landmarks[23];
  const rightHip = landmarks[24];
  const leftEar  = landmarks[7];
  const rightEar = landmarks[8];

  const hipsOk = pairVisible(leftHip, rightHip);
  const earsOk = pairVisible(leftEar, rightEar);

  // ── Neither reference available ───────────────────────────────────────────
  if (!hipsOk && !earsOk) {
    return { cameraTiltDeg: 0, confidence: "insufficient", divergenceDeg: null };
  }

  // ── Only one reference available ──────────────────────────────────────────
  if (!hipsOk || !earsOk) {
    const tilt = hipsOk
      ? bodyPairAngleDeg(leftHip!, rightHip!)
      : bodyPairAngleDeg(leftEar!, rightEar!);
    return { cameraTiltDeg: tilt, confidence: "low", divergenceDeg: null };
  }

  // ── Both references available — check consensus ───────────────────────────
  const hipAngle = bodyPairAngleDeg(leftHip!, rightHip!);
  const earAngle = bodyPairAngleDeg(leftEar!, rightEar!);

  // angleDiffDeg handles the ±180° wrap boundary correctly
  const divergence = Math.abs(angleDiffDeg(hipAngle, earAngle));

  if (divergence <= AGREEMENT_THRESHOLD_DEG) {
    // Averaging two independent readings reduces random noise by ~√2
    const cameraTilt = (hipAngle + earAngle) / 2;
    return { cameraTiltDeg: cameraTilt, confidence: "high", divergenceDeg: divergence };
  } else {
    // Real body asymmetry detected — prefer hips, flag low confidence
    return { cameraTiltDeg: hipAngle, confidence: "low", divergenceDeg: divergence };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3 — SEVERITY CLASSIFICATION
// ─────────────────────────────────────────────────────────────────────────────

export type Severity = "normal" | "mild" | "moderate" | "severe";

/**
 * classifyNeckTilt
 *
 * Thresholds grounded in cervical lateral flexion rehabilitation literature.
 * Healthy adults demonstrate < 5° of passive lateral asymmetry at rest.
 *
 * "Normal" does not mean zero tilt — it means the tilt is within a range
 * where corrective feedback is not clinically indicated.
 */
function classifyNeckTilt(absDeg: number): Severity {
  if (absDeg < 5)  return "normal";
  if (absDeg < 10) return "mild";
  if (absDeg < 20) return "moderate";
  return "severe";
}

/**
 * classifyShoulderAsymmetry
 *
 * The 3° lower bound is the measurement noise floor of the MediaPipe Full
 * model's shoulder landmark placement. Readings below 3° cannot be reliably
 * distinguished from measurement error and must never be reported as asymmetric.
 *
 * Clinical context for thresholds above the noise floor:
 *   Mild   (3– 7°): Common dominant-arm compensation, often subclinical
 *   Moderate(7–12°): Associated with trapezius imbalance or scoliotic posture
 *   Severe (>12°):  Strong clinical flag, warrants therapist review
 */
function classifyShoulderAsymmetry(absDeg: number): Severity {
  if (absDeg < 3)  return "normal";
  if (absDeg < 7)  return "mild";
  if (absDeg < 12) return "moderate";
  return "severe";
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4 — METRIC COMPUTATIONS
// ─────────────────────────────────────────────────────────────────────────────

export type NeckTiltResult = {
  /** Tilt-corrected angle in degrees. Always ≥ 0; use `direction` for side. */
  angleDeg: number;
  direction: "right" | "left" | "center";
  severity: Severity;
  correctionConfidence: TiltConfidence;
};

/**
 * Internal helper — returns the tilt-corrected signed ear-line angle in
 * degrees, or null if either ear landmark is unreliable.
 *
 *   correctedAngle > 0  →  right ear is lower in frame after correction
 *                       →  head tilting RIGHT
 *   correctedAngle < 0  →  head tilting LEFT
 *
 * Used by both `computeLateralNeckTilt` (which absolute-values it) and
 * `computeNeckLateralFlexionSigned` (which keeps the sign for the rep
 * counter to track which side a rep belonged to).
 */
function signedNeckFlexionAngle(
  landmarks: LM[],
  tiltRef: TiltReference
): number | null {
  const leftEar  = landmarks[7];
  const rightEar = landmarks[8];
 
  if (!pairVisible(leftEar, rightEar)) return null;
 
  const rawEarAngle = bodyPairAngleDeg(leftEar!, rightEar!);
  return angleDiffDeg(rawEarAngle, tiltRef.cameraTiltDeg);
}

/**
 * computeLateralNeckTilt
 *
 * ── WHAT WE'RE MEASURING ─────────────────────────────────────────────────────
 * The sideways tilt of the head (one ear dropping toward a shoulder) relative
 * to the body's own horizontal axis — not the absolute camera horizontal.
 *
 * ── THE MATH ─────────────────────────────────────────────────────────────────
 * Camera tilt shifts every line in the image by the same amount. Therefore:
 *
 *   raw_ear_angle  =  camera_tilt  +  body_neck_tilt
 *
 * Rearranging:
 *
 *   body_neck_tilt  =  raw_ear_angle  −  camera_tilt
 *
 * This is exactly what angleDiffDeg(rawEarAngle, tiltRef.cameraTiltDeg) computes.
 *
 * ── WHY EARS? ────────────────────────────────────────────────────────────────
 * The ears are rigidly attached to the skull. When the head tilts, both ears
 * move together, so the ear line is a direct and stable proxy for head orientation.
 * It is more stable than eye outer corners (affected by gaze) or the nose
 * midpoint (a single landmark, noisier than a two-point line).
 *
 * ── SIGN CONVENTION (y increases downward) ───────────────────────────────────
 *   correctedAngle > 0  →  right ear is lower in frame after correction
 *                       →  head tilting RIGHT (right ear toward right shoulder)
 *   correctedAngle < 0  →  left ear is lower → head tilting LEFT
 *
 * ── NOTE ON EAR-LINE AND TILT REFERENCE ─────────────────────────────────────
 * This is why we do NOT use the ear line as the tilt reference for shoulder
 * symmetry. If the patient has a neck tilt, that tilt is baked into the ear
 * angle — which is correct here (it's what we want to measure), but would
 * contaminate the shoulder metric if used as its reference. Hips remain
 * decoupled from neck motion and are used for shoulder correction instead.
 */
export function computeLateralNeckTilt(
  landmarks: LM[],
  tiltRef: TiltReference
): NeckTiltResult | null {
  const correctedAngle = signedNeckFlexionAngle(landmarks, tiltRef);
  if (correctedAngle === null) return null;
 
  const absDeg = Math.abs(correctedAngle);
 
  // 2° dead-band: below this, the angle is indistinguishable from landmark noise
  const direction: NeckTiltResult["direction"] =
    absDeg < 2         ? "center" :
    correctedAngle > 0 ? "left"  : "right";
 
  return {
    angleDeg:             Math.round(absDeg * 10) / 10,
    direction,
    severity:             classifyNeckTilt(absDeg),
    correctionConfidence: tiltRef.confidence,
  };
}

export type ShoulderSymmetryResult = {
  /** Tilt-corrected angle in degrees. Always ≥ 0; use `elevatedSide` for direction. */
  angleDeg: number;
  elevatedSide: "left" | "right" | "level";
  severity: Severity;
  correctionConfidence: TiltConfidence;
};

/**
 * computeShoulderSymmetry
 *
 * ── WHAT WE'RE MEASURING ─────────────────────────────────────────────────────
 * Whether one shoulder is elevated relative to the other, expressed as the
 * angle of the shoulder line after removing the camera tilt component.
 *
 * ── WHY ANGLE INSTEAD OF RAW Y DIFFERENCE? ───────────────────────────────────
 * Raw Y difference is:   leftShoulder.y − rightShoulder.y
 * This equals:           camera_tilt_effect + actual_asymmetry
 *
 * There is no mathematical way to separate these two components from a
 * single Y difference. We need a reference to anchor what "level" means.
 *
 * By computing the shoulder LINE ANGLE and subtracting the camera tilt angle:
 *
 *   shoulder_line_angle − camera_tilt_angle  =  pure body asymmetry angle
 *
 * Both quantities are angles in the same coordinate space, so the subtraction
 * isolates the body contribution with correct sign behavior.
 *
 * ── WHY HIPS AS THE CORRECTION REFERENCE (not ears)? ────────────────────────
 * The ear line is affected by neck tilt — if the patient's head is tilting,
 * that tilt is part of the ear angle. Using that angle to "correct" shoulder
 * symmetry would make neck tilt bleed into the shoulder metric. For example,
 * a patient with a right neck tilt would appear to have a slightly elevated
 * right shoulder even with level shoulders.
 *
 * Hips are mechanically decoupled from shoulder and neck motion in the
 * upper-body rehabilitation exercises this system targets. Camera tilt
 * affects the hip line and shoulder line identically — so the subtraction
 * cleanly removes the camera component without introducing body cross-talk.
 *
 * The camera tilt estimate used here comes from computeTiltReference(), which
 * already prioritizes the hip line as its primary estimate.
 *
 * ── SIGN CONVENTION ──────────────────────────────────────────────────────────
 *   correctedAngle > 0  →  right shoulder lower → LEFT shoulder is elevated
 *   correctedAngle < 0  →  left shoulder lower  → RIGHT shoulder is elevated
 */
export function computeShoulderSymmetry(
  landmarks: LM[],
  tiltRef: TiltReference
): ShoulderSymmetryResult | null {
  const leftShoulder  = landmarks[11];
  const rightShoulder = landmarks[12];

  if (!pairVisible(leftShoulder, rightShoulder)) return null;

  const rawShoulderAngle = bodyPairAngleDeg(leftShoulder!, rightShoulder!);
  const correctedAngle   = angleDiffDeg(rawShoulderAngle, tiltRef.cameraTiltDeg);
  const absDeg           = Math.abs(correctedAngle);
  const severity         = classifyShoulderAsymmetry(absDeg);

  // Within the 3° noise floor: always report as level regardless of sign
  const elevatedSide: ShoulderSymmetryResult["elevatedSide"] =
    severity === "normal"  ? "level" :
    correctedAngle > 0     ? "right"  : "left";

  return {
    angleDeg:             Math.round(absDeg * 10) / 10,
    elevatedSide,
    severity,
    correctionConfidence: tiltRef.confidence,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4.5 — TRUNK LATERAL LEAN
// ─────────────────────────────────────────────────────────────────────────────
 
export type TrunkLeanResult = {
  /** Tilt-corrected angle in degrees. Always ≥ 0; use `direction` for side. */
  angleDeg: number;
  direction: "left" | "right" | "center";
  severity: Severity;
  correctionConfidence: TiltConfidence;
};
 
/**
 * classifyTrunkLean
 *
 * Trunk lean thresholds are tighter than neck tilt because the trunk has
 * far less anatomical range of motion at rest than the cervical spine.
 *
 * Healthy adults in quiet standing typically show < 2° of lateral trunk
 * deviation. Anything beyond 5° at rest is generally considered a postural
 * compensation worth flagging during exercise execution.
 *
 *  0– 2° (normal):    within standing-sway noise
 *  2– 5° (mild):      mild compensatory lean, common during arm raises
 *  5–10° (moderate):  clear compensation, likely off-loading the working side
 *   >10° (severe):    significant trunk dump, exercise should be re-instructed
 */
function classifyTrunkLean(absDeg: number): Severity {
  if (absDeg < 2)  return "normal";
  if (absDeg < 5)  return "mild";
  if (absDeg < 10) return "moderate";
  return "severe";
}
 
/**
 * computeTrunkLateralLean
 *
 * ── WHAT WE'RE MEASURING ─────────────────────────────────────────────────────
 * The sideways tilt of the entire torso, expressed as the angular deviation
 * of the shoulder-midpoint-to-hip-midpoint line from true vertical, after
 * removing the camera tilt component.
 *
 * This catches two distinct compensations that the existing metrics miss:
 *   1. Lateral trunk shift — ribcage slides sideways over the pelvis without
 *      either girdle rotating. Hips and shoulders stay parallel (and level),
 *      so symmetry metrics see nothing, but the midpoint-to-midpoint line
 *      is no longer vertical.
 *   2. Whole-trunk rotation lean — torso tilts like the Tower of Pisa.
 *      The tilt reference falls back to hips alone in this case (ears
 *      diverge), which means the corrected trunk angle still reads the
 *      true lean rather than being cancelled by the correction.
 *
 * ── COORDINATE NOTE (read this before changing the math) ─────────────────────
 * In normalized image coords, y INCREASES DOWNWARD. An upright trunk has
 * the shoulder midpoint at smaller y than the hip midpoint, so the vector
 * from hip-mid to shoulder-mid points UP in the image, which is the
 * NEGATIVE-y direction. lineAngleDeg() uses atan2(dy, dx) which returns
 * −90° for an upward vector, not +90°.
 *
 * Therefore: a perfectly vertical trunk yields rawTrunkAngle ≈ −90°.
 * We measure deviation FROM −90°, not from 0° or +90°.
 *
 * ── SIGN CONVENTION ──────────────────────────────────────────────────────────
 * After computing (rawTrunkAngle − cameraTilt) − (−90°):
 *   correctedDeviation > 0  →  trunk top leaning toward image-right
 *                           →  patient leaning RIGHT
 *   correctedDeviation < 0  →  trunk top leaning toward image-left
 *                           →  patient leaning LEFT
 *
 * Note: this is image-frame "left/right" — the same convention used by
 * neck tilt and shoulder symmetry. If the camera is mirrored for the
 * patient's view (typical for a webcam UI), the UI layer handles the flip.
 * The metric itself stays in raw image space.
 *
 * ── TILT CORRECTION ──────────────────────────────────────────────────────────
 * Camera roll rotates ALL lines in the image by the same angular amount,
 * including both horizontal references AND vertical references. So the
 * same cameraTiltDeg subtraction that corrects shoulder symmetry (a
 * horizontal-reference metric) also correctly adjusts trunk lean (a
 * vertical-reference metric). The geometry is symmetric.
 */
export function computeTrunkLateralLean(
  landmarks: LM[],
  tiltRef: TiltReference
): TrunkLeanResult | null {
  const leftShoulder  = landmarks[11];
  const rightShoulder = landmarks[12];
  const leftHip       = landmarks[23];
  const rightHip      = landmarks[24];
 
  // All four landmarks must be reliable — this metric depends on midpoints
  // of two pairs, so a single weak landmark corrupts a midpoint and from
  // there the entire angle.
  if (!pairVisible(leftShoulder, rightShoulder)) return null;
  if (!pairVisible(leftHip, rightHip)) return null;
 
  // Midpoints. Averaging two landmarks per endpoint roughly halves the
  // landmark-placement noise relative to single-landmark angle metrics.
  const shoulderMid: LM = {
    x: (leftShoulder!.x + rightShoulder!.x) / 2,
    y: (leftShoulder!.y + rightShoulder!.y) / 2,
  };
  const hipMid: LM = {
    x: (leftHip!.x + rightHip!.x) / 2,
    y: (leftHip!.y + rightHip!.y) / 2,
  };
 

  // ── TEMPORARY DEBUG ──
  const rawTrunkAngle = lineAngleDeg(hipMid, shoulderMid);

  // ── END DEBUG ──
 
  // Step 1: remove camera tilt. After this, the angle is in body-relative
  // image space — what the trunk angle would be if the camera were level.
  const tiltCorrected = angleDiffDeg(rawTrunkAngle, tiltRef.cameraTiltDeg);
 
  // Step 2: express as deviation from vertical. Subtracting −90° (i.e.,
  // adding 90°) shifts the reference so 0° means "perfectly upright".
  // angleDiffDeg keeps the result in [−180°, +180°] and handles the wrap.
  const deviation = angleDiffDeg(tiltCorrected, -90);
 
  const absDeg   = Math.abs(deviation);
  const severity = classifyTrunkLean(absDeg);
 
  // Within the 2° noise floor: report center regardless of sign
  const direction: TrunkLeanResult["direction"] =
    severity === "normal" ? "center" :
    deviation > 0         ? "right"  : "left";
 
  return {
    angleDeg:             Math.round(absDeg * 10) / 10,
    direction,
    severity,
    correctionConfidence: tiltRef.confidence,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5 — COMPENSATION SCORE (0–100, exercise-aware)
// ─────────────────────────────────────────────────────────────────────────────
//
// REPLACES the previous fixed 33/33/33 posture score.
//
// ── WHY THIS CHANGED ─────────────────────────────────────────────────────────
// The old `computePostureScore` deducted from neck tilt, shoulder asymmetry,
// and trunk lean — three "standing well at rest" metrics that were always
// shown regardless of exercise. With registry-driven exercise selection, the
// displayed metrics change per exercise, and a fixed three-metric score is
// meaningless when those three aren't all in scope.
//
// ── WHAT THIS MEASURES NOW ───────────────────────────────────────────────────
// COMPENSATION quality — how cleanly the patient is performing the active
// exercise, scored across the compensation metrics declared in the registry
// for that exercise. The PRIMARY metric (the angle the patient is trying to
// hit, e.g. shoulder abduction during a lateral raise) is NOT part of the
// score. Reaching the target ROM is the rep state machine's job; this score
// answers a different question: "while reaching that target, how much
// compensation pattern did the patient show?"
//
// A patient executing perfect lateral raises with zero shrug and zero trunk
// lean scores 100. A patient hiking the trapezius and leaning to assist the
// raise gets penalized. That maps directly to what a therapist reviews when
// scoring movement quality.
//
// ── WEIGHTING ────────────────────────────────────────────────────────────────
// Equal weighting across whichever compensation metrics the exercise declares.
// One compensation metric → it owns 100 pts of deduction headroom.
// Two compensation metrics → 50/50.
// Three → ~33/33/33.
// This way, the maximum possible deduction is always ≤ 100 regardless of how
// many compensation metrics the registry lists.


/**
 * Per-metric deduction bands. Each band defines a continuous interpolation
 * range — entering a band scales linearly from `deductionMin` to `deductionMax`.
 * Same banded-with-interpolation approach as the previous scoring code; only
 * the per-metric tables and the weighting changed.
 *
 * Units match the metric:
 *   - angle metrics (neck, shoulder symmetry, trunk lean):    degrees
 *   - displacement metrics (scapular elevation):              torso-length fraction
 *
 * The deduction values below assume each band's full deduction would represent
 * a "saturated" metric. They get scaled by 1/N at score-computation time, where
 * N is the number of compensation metrics for the active exercise.
 */
type Band = { max: number; deductionMin: number; deductionMax: number };

const COMPENSATION_BANDS: Record<MetricName, Band[]> = {
  // Neck tilt: 5° normal floor (matches existing severity classifier)
  neckTilt: [
    { max: 5,  deductionMin: 0,   deductionMax: 0   },
    { max: 10, deductionMin: 0,   deductionMax: 35  },
    { max: 20, deductionMin: 35,  deductionMax: 75  },
    { max: 30, deductionMin: 75,  deductionMax: 100 },
  ],
  // Shoulder symmetry: 3° noise floor
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

  // Stubs for compatibility — these metrics exist as MetricName values but
  // are not currently used as compensation metrics in the registry. If they
  // ever appear as a compensation entry, replace these placeholder bands.
  shoulderAbduction:        [{ max: 0, deductionMin: 0, deductionMax: 0 }],
  shoulderFlexion:          [{ max: 0, deductionMin: 0, deductionMax: 0 }],
  neckLateralFlexion:       [{ max: 0, deductionMin: 0, deductionMax: 0 }],
  trunkLateralFlexion:      [{ max: 0, deductionMin: 0, deductionMax: 0 }],
  shoulderHorizAbd:         [{ max: 0, deductionMin: 0, deductionMax: 0 }],
};

/**
 * bandedDeduction
 *
 * Maps a metric value to a 0–100 deduction using the per-metric bands above.
 * Continuous within each band (linear interpolation) so there are no score
 * cliffs at band boundaries.
 *
 * Same algorithm as the previous bandedDeduction; kept private to this section.
 */
function bandedDeduction(absValue: number, bands: Band[]): number {
  let prevMax = 0;
  for (const band of bands) {
    if (absValue <= band.max) {
      const width = band.max - prevMax;
      const t = width > 0 ? (absValue - prevMax) / width : 1;
      return band.deductionMin + t * (band.deductionMax - band.deductionMin);
    }
    prevMax = band.max;
  }
  return bands[bands.length - 1].deductionMax;
}

/**
 * computeCompensationScore
 *
 * Computes a 0–100 score reflecting compensation-pattern quality for the
 * currently active exercise.
 *
 * @param definition  The active exercise from the registry.
 * @param metricValues  A partial map from metric name to its CURRENT absolute
 *                      value. Pass null/undefined for metrics that couldn't
 *                      be computed this frame (e.g. occlusion).
 *
 * Returns null if NO compensation metrics could be evaluated this frame —
 * this is distinct from "100" (perfect form) and signals to the UI that the
 * score is unavailable rather than perfect.
 *
 * If only some compensation metrics are unavailable, the score is computed
 * from those that ARE available, with weighting redistributed equally among
 * them. This avoids penalizing the patient for landmarks we couldn't see.
 */
export function computeCompensationScore(
  definition: ExerciseDefinition,
  metricValues: Partial<Record<MetricName, number | null>>
): number | null {
  const compensations = definition.compensationMetrics;
  if (compensations.length === 0) {
    // Exercise declares no compensation metrics. Return null rather than 100,
    // because a perfect score would be misleading — we have no quality signal.
    return null;
  }

  // Filter to compensation metrics that have a non-null reading this frame.
  const active = compensations.filter((c) => {
    const v = metricValues[c.name];
    return typeof v === "number";
  });

  if (active.length === 0) return null;

  // Equal weighting across active compensation metrics. Each metric's max
  // possible deduction is 100/N, so summed deductions stay in [0, 100].
  const weightPerMetric = 100 / active.length;

  let totalDeduction = 0;
  for (const c of active) {
    const value = metricValues[c.name] as number;
    const bands = COMPENSATION_BANDS[c.name];
    const rawDeduction = bandedDeduction(Math.abs(value), bands);
    // rawDeduction is on a 0–100 per-metric scale; scale to its weight share.
    totalDeduction += (rawDeduction / 100) * weightPerMetric;
  }

  return Math.max(0, Math.min(100, Math.round(100 - totalDeduction)));
}


// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7 — METRIC STUBS (registry-referenced, math TBD)
// ─────────────────────────────────────────────────────────────────────────────
//
// These functions exist so the exercise registry can reference them and the
// camera loop can wire up state machines without runtime errors. Each stub
// returns null so any consumer that checks for "no data" handles them
// correctly. Replace each stub with real math one at a time as you implement
// rep counting per exercise.
//
// All stubs return a number (the metric value in the units declared by the
// registry — degrees for angles, normalized torso-length for displacements)
// or null when the required landmarks aren't visible.

/**
 * Shoulder abduction angle (degrees) — used by ex_001 Lateral Arm Raises.
 *
 * Definition: angle between the trunk-vertical axis and the shoulder→elbow
 * vector, measured in the frontal plane. 0° = arm at side, 90° = arm
 * horizontal, 180° = arm overhead.
 *
 * Landmarks needed:
 *   side="left":  11 (left shoulder), 13 (left elbow), plus midpoints of
 *                 11/12 and 23/24 to derive trunk vertical
 *   side="right": 12, 14, plus the same midpoints
 *
 * TODO: implement. Tilt-correct using `tiltRef.cameraTiltDeg` so the
 * trunk-vertical reference is camera-roll-independent.
 */
export function computeShoulderAbduction(
  _landmarks: LM[],
  _tiltRef: TiltReference,
  _side: "left" | "right"
): number | null {
  return null;
}

/**
 * Shoulder flexion angle (degrees) — used by ex_002 Overhead Arm Raises.
 *
 * Definition: angle between trunk-vertical and shoulder→elbow vector in the
 * sagittal plane. Front-camera 2D estimation produces a foreshortened
 * apparent angle (acknowledged in proposal limitations); this metric returns
 * the apparent angle, not the anatomical angle.
 *
 * TODO: implement. Targets the same registry-declared thresholds as
 * abduction but interpreted in the apparent-angle space.
 */
export function computeShoulderFlexion(
  _landmarks: LM[],
  _tiltRef: TiltReference,
  _side: "left" | "right"
): number | null {
  return null;
}

/**
 * Scapular elevation (normalized torso-lengths) — used by ex_003 Shoulder Shrugs.
 *
 * Definition: vertical distance from shoulder landmark to ear landmark on
 * the same side, normalized by trunk length (shoulder-midpoint to
 * hip-midpoint distance) for scale invariance across patients.
 *
 * Returns the CHANGE from a per-session resting baseline. The camera loop
 * is responsible for sampling and storing the baseline during the first
 * ~1 second after capture-readiness clears, before the patient begins
 * shrugging. This stub returns the raw normalized distance; baseline
 * subtraction is the caller's job.
 *
 * TODO: implement. Tilt correction needed because shoulder-to-ear vertical
 * distance changes with camera roll.
 */
export function computeScapularElevation(
  _landmarks: LM[],
  _tiltRef: TiltReference,
  _side: "left" | "right"
): number | null {
  return null;
}

/**
 * Signed neck lateral flexion angle (degrees) — used by ex_004.
 *
 * Returns the tilt-corrected ear-line angle in body-relative frame.
 * Sign convention:
 *   negative  →  head tilting LEFT  (left ear toward left shoulder)
 *   positive  →  head tilting RIGHT (right ear toward right shoulder)
 *   ~0        →  head level
 *
 * The `_side` parameter is currently ignored — neck lateral flexion is
 * a single bidirectional metric, not a per-side measurement. The
 * parameter exists for signature compatibility with other per-side metrics
 * routed through `computeMetricByName`. The bidirectional-alternating
 * routing in CameraClient takes care of side attribution per rep.
 */
export function computeNeckLateralFlexionSigned(
  landmarks: LM[],
  tiltRef: TiltReference,
  _side: "left" | "right"
): number | null {
  return signedNeckFlexionAngle(landmarks, tiltRef);
}

/**
 * Trunk lateral flexion (degrees) — used by ex_005.
 *
 * Same situation as neck flexion: existing `computeTrunkLateralLean`
 * returns absolute angle + direction enum; the state machine needs the
 * signed continuous value. Wrapper TBD.
 */
export function computeTrunkLateralFlexionSigned(
  _landmarks: LM[],
  _tiltRef: TiltReference,
  _side: "left" | "right"
): number | null {
  return null;
}

/**
 * Shoulder horizontal abduction (degrees) — used by ex_006 isometric T-pose.
 *
 * Definition: angle of the shoulder→elbow vector relative to the
 * trunk-horizontal axis, measured in the transverse plane projection.
 * 0° = arm forward, 90° = arm out to side at shoulder height (T-pose).
 *
 * For the isometric hold, the camera loop checks whether this value stays
 * within the registry's targetBand (center 90°, tolerance 10°).
 *
 * TODO: implement. For a frontal-camera setup, this ends up being
 * essentially the same calculation as shoulder abduction — they only
 * differ in clinical interpretation, not in the geometric measurement.
 */
export function computeShoulderHorizAbduction(
  _landmarks: LM[],
  _tiltRef: TiltReference,
  _side: "left" | "right"
): number | null {
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 8 — REGISTRY-AWARE ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────
//
// `computePoseMetricsForExercise` is the new top-level call from CameraClient.
// It looks at the active exercise definition and returns ONLY the metrics
// that exercise needs — primary metric (for rep counting), compensation
// metrics (for the score and warning UI), nothing else.
//
// The original `computePoseMetrics` is kept for backward compatibility and
// for any UI surface that wants the always-on three-metric snapshot. New
// camera-loop code should use this function instead.



/**
 * Snapshot of every metric the active exercise cares about, plus the
 * compensation score. The shape is dynamic — only metrics referenced by the
 * exercise definition appear in `metrics`. Consumers should iterate over
 * `definition.compensationMetrics` and `definition.primaryMetric` (or
 * `definition.isometric.metric`) rather than expecting fixed fields.
 */
export type ExerciseFrameMetrics = {
  tiltReference: TiltReference;
  /** Map keyed by MetricName. Values are the metric's CURRENT raw value or null. */
  metrics: Partial<Record<MetricName, number | null>>;
  /** 0–100 compensation-quality score, or null if no compensation data. */
  compensationScore: number | null;
};

/**
 * Compute one frame's worth of metrics for the active exercise.
 *
 * For now, primary-metric values come from the stub functions in Section 7
 * and will return null until those are implemented. Compensation metrics use
 * the existing computed values (neck tilt, shoulder symmetry, trunk lean) —
 * those work today.
 *
 * The function deliberately reads the active definition rather than computing
 * everything always-on. This keeps per-frame work proportional to what the UI
 * actually displays — important once the per-frame rate climbs and the stubs
 * become real implementations doing real math.
 */
export function computePoseMetricsForExercise(
  landmarks: LM[],
  definition: ExerciseDefinition
): ExerciseFrameMetrics {
  const tiltReference = computeTiltReference(landmarks);
  const metrics: Partial<Record<MetricName, number | null>> = {};

  // ── Primary metric ──────────────────────────────────────────────────────
  // Only one of these branches runs per frame. The result is stored in the
  // metrics map under the metric name declared in the registry.
  if (definition.kind === "dynamic") {
    const p = definition.primaryMetric;
    metrics[p.name] = computeMetricByName(landmarks, tiltReference, p.name, p.side);
  } else {
    const i = definition.isometric;
    metrics[i.metric] = computeMetricByName(landmarks, tiltReference, i.metric, i.side);
  }

  // ── Compensation metrics ────────────────────────────────────────────────
  for (const comp of definition.compensationMetrics) {
    // Compensation metrics in the current registry don't carry a `side`,
    // so pass undefined and let the metric resolver pick the bilateral form.
    if (metrics[comp.name] === undefined) {
      metrics[comp.name] = computeMetricByName(landmarks, tiltReference, comp.name, undefined);
    }
  }

  const compensationScore = computeCompensationScore(definition, metrics);

  return { tiltReference, metrics, compensationScore };
}

/**
 * Resolves a metric name to its computation function.
 *
 * This is the single source of truth for "which function computes which
 * metric." Adding a new metric means: add to the MetricName union, add a
 * compute function (real or stubbed), add a case here. That's it.
 *
 * Returns the metric's value as a plain number (or null when unavailable),
 * stripped of any wrapper objects. Consumers comparing to thresholds want
 * the raw number; if a UI surface wants the rich form (severity + direction
 * for neck tilt, etc.) it should call the underlying function directly.
 */
function computeMetricByName(
  landmarks: LM[],
  tiltRef: TiltReference,
  metricName: MetricName,
  side: "left" | "right" | undefined
): number | null {
  switch (metricName) {
    case "neckTilt": {
      const r = computeLateralNeckTilt(landmarks, tiltRef);
      return r ? r.angleDeg : null;
    }
    case "shoulderSymmetry": {
      const r = computeShoulderSymmetry(landmarks, tiltRef);
      return r ? r.angleDeg : null;
    }
    case "trunkLean": {
      const r = computeTrunkLateralLean(landmarks, tiltRef);
      return r ? r.angleDeg : null;
    }
    case "shoulderAbduction":
      return computeShoulderAbduction(landmarks, tiltRef, side ?? "left");
    case "shoulderFlexion":
      return computeShoulderFlexion(landmarks, tiltRef, side ?? "left");
    case "scapularElevation":
      return computeScapularElevation(landmarks, tiltRef, side ?? "left");
    case "neckLateralFlexion":
      return computeNeckLateralFlexionSigned(landmarks, tiltRef, side ?? "left");
    case "trunkLateralFlexion":
      return computeTrunkLateralFlexionSigned(landmarks, tiltRef, side ?? "left");
    case "shoulderHorizAbd":
      return computeShoulderHorizAbduction(landmarks, tiltRef, side ?? "left");
    default: {
      // Exhaustiveness guard — TypeScript will complain if a MetricName is
      // ever added without a case here.
      const _exhaustive: never = metricName;
      return null;
    }
  }
}