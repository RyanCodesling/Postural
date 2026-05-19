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
 * SIGN CONVENTION (authoritative — pinned by neckSideAgreement.test.ts and
 * matching `computeLateralNeckTilt` + CLAUDE.md; do NOT "correct" this back
 * to a right-positive reading — that was a long-standing doc error):
 *
 *   correctedAngle > 0  →  head tilting to the patient's LEFT
 *   correctedAngle < 0  →  head tilting to the patient's RIGHT
 *
 * (Earlier revisions of this comment claimed positive → RIGHT. That was
 * wrong; the code has always mapped positive → "left" and the regression
 * test enforces it.)
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
 * ── SIGN CONVENTION (authoritative; pinned by neckSideAgreement.test.ts) ─────
 *   correctedAngle > 0  →  head tilting to the patient's LEFT
 *   correctedAngle < 0  →  head tilting to the patient's RIGHT
 * The code below maps `correctedAngle > 0 ? "left" : "right"`. Matches
 * CLAUDE.md. Do not flip this comment back to a right-positive reading.
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
 * ── WHAT WE'RE MEASURING ─────────────────────────────────────────────────────
 * The angle between the trunk's downward axis and the upper arm, measured
 * in the image plane (frontal-plane projection given a front-facing camera).
 *
 *   Arm at side, hanging down  →  ~0°
 *   Arm out horizontally       →  ~90°
 *   Arm raised past horizontal →  >90° (not relevant — registry targetROM is 90°)
 *
 * ── WHY SHOULDER→ELBOW (not shoulder→wrist) ──────────────────────────────────
 * The elbow flexes during arm raise even when the patient is keeping the arm
 * "straight," and the wrist is at the end of the longest kinematic chain so
 * its landmark is the noisiest. Goniometric convention (Kisner & Colby) places
 * the moving arm of the goniometer along the humerus — i.e., shoulder to
 * elbow. We follow that.
 *
 * ── THE MATH ─────────────────────────────────────────────────────────────────
 * Two vectors, both originating conceptually at the shoulder:
 *   1. Trunk-down vector: shoulder-midpoint → hip-midpoint.
 *      Points DOWN in the image, ≈ +90° in atan2 image-coords.
 *   2. Upper-arm vector: shoulder → elbow (on the chosen side).
 *      Also points DOWN at rest (arm hanging), ≈ +90°.
 *
 * The angle between them is `angleDiffDeg(armAngle, trunkDownAngle)`.
 * At rest the two vectors are nearly parallel, so the result is near 0°.
 * As the arm abducts, the upper-arm vector rotates while the trunk-down
 * vector stays put, and the difference grows toward 90°.
 *
 * ── WHY NO TILT-CORRECTION SUBTRACTION ───────────────────────────────────────
 * Camera roll rotates BOTH vectors by the same angular amount, so the
 * difference between them is invariant to camera roll. The trunk's own axis
 * is the body-relative reference here — there's nothing to subtract. This
 * differs from ear-line metrics (which need the hip-derived camera tilt to
 * isolate body-relative angle), and is the cleaner case of the two.
 *
 * `tiltRef` is still in the signature for shape-compatibility with the rest
 * of the metric family, and so the camera loop can pass the same value to
 * every metric without branching. Its `confidence` field could be propagated
 * out as a quality flag in a future revision; for now we just ignore it.
 *
 * ── SIGN ─────────────────────────────────────────────────────────────────────
 * The signed angleDiff carries two pieces of information at once:
 *   (a) lateral abduction vs cross-body adduction on the SAME limb — these
 *       motions produce opposite signs because the arm vector rotates the
 *       opposite way around the trunk axis.
 *   (b) the mirror-image asymmetry between left and right limbs.
 *
 * Collapsing both with Math.abs() was a bug: it made cross-body motion (arm
 * swinging across the chest, up past the head, back down to the side) look
 * identical to true lateral abduction, so the rep state machine could trip
 * a full rep on a non-clinical movement.
 *
 * Per-side sign convention with the current bodyPairAngle setup and y-down
 * normalized coords:
 *   side="left"  (LM11 on image-right): lateral abduction → signed ≈ −90°
 *   side="right" (LM12 on image-left ): lateral abduction → signed ≈ +90°
 *
 * We flip the left-side sign so lateral abduction is positive on both sides,
 * then clamp negatives (cross-body) to null. The rep counter sees a null
 * during cross-body motion and never crosses startThreshold.
 *
 * ── LANDMARKS REQUIRED ───────────────────────────────────────────────────────
 *   11, 12 — both shoulders (for shoulder-midpoint, the trunk top)
 *   23, 24 — both hips (for hip-midpoint, the trunk bottom)
 *   side="left":  13 (left elbow), pairs with shoulder 11
 *   side="right": 14 (right elbow), pairs with shoulder 12
 *
 * Returns null if any required landmark is below MIN_VIS — a partial
 * computation here would silently corrupt rep counting.
 */
export function computeShoulderAbduction(
  landmarks: LM[],
  _tiltRef: TiltReference,
  side: "left" | "right"
): number | null {
  const leftShoulder  = landmarks[11];
  const rightShoulder = landmarks[12];
  const leftHip       = landmarks[23];
  const rightHip      = landmarks[24];

  // Trunk endpoints — required regardless of which arm we're measuring,
  // because both contribute to the trunk-down reference vector.
  if (!pairVisible(leftShoulder, rightShoulder)) return null;
  if (!pairVisible(leftHip, rightHip))           return null;

  // Per-side shoulder + elbow. Note `shoulder` here aliases the same
  // landmark as `leftShoulder` or `rightShoulder` above — the explicit
  // re-pick reads more clearly at the call site.
  const shoulder = side === "left" ? leftShoulder! : rightShoulder!;
  const elbow    = side === "left" ? landmarks[13] : landmarks[14];
  if (!elbow || vis(elbow) < MIN_VIS) return null;

  // Trunk-down vector: from shoulder-midpoint down to hip-midpoint.
  // Direction matters — we want it pointing DOWN so it parallels the
  // arm-at-rest vector and the resulting angle is near 0° at rest.
  const shoulderMid: LM = {
    x: (leftShoulder!.x + rightShoulder!.x) / 2,
    y: (leftShoulder!.y + rightShoulder!.y) / 2,
  };
  const hipMid: LM = {
    x: (leftHip!.x + rightHip!.x) / 2,
    y: (leftHip!.y + rightHip!.y) / 2,
  };

  const trunkDownAngle = lineAngleDeg(shoulderMid, hipMid);
  const armAngle       = lineAngleDeg(shoulder,    elbow);

  const signedAbduction = angleDiffDeg(armAngle, trunkDownAngle);
  // Flip the left-side sign so positive = lateral abduction on BOTH sides.
  // Negatives (cross-body adduction) are returned as null below. See the SIGN
  // section in the doc comment for why this is not Math.abs.
  const lateralAbduction = side === "left" ? -signedAbduction : signedAbduction;
  // Boundary case: ±180° are the same physical angle (arm straight up,
  // exactly opposite trunk-down). `angleDiffDeg` returns -180 at this
  // boundary because its wrap-loop uses strict `< -180`. On the LEFT side
  // the sign-flip accidentally lands on +180; on the RIGHT side the value
  // stays -180 and would be rejected by the cross-body check below. Map
  // -180 to +180 so straight-overhead poses (common in ex_002 Overhead
  // Arm Raises) read identically on both sides.
  if (lateralAbduction <= -180 + 1e-9) return 180;
  // Return null (not 0) during cross-body motion. The rep counter relies on the
  // time gap created by skipping null frames to detect that the arm went out of
  // the valid lateral region. Clamping to 0 would feed continuous data to the
  // state machine and let it mistake "lateral overhead after a cross-body sweep"
  // for a normal rep ascent — see CONTINUITY GATE in repCounter.ts.
  return lateralAbduction < 0 ? null : lateralAbduction;
}

/**
 * Shoulder flexion angle (degrees) — used by ex_002 Overhead Arm Raises.
 *
 * ── WHY THIS DELEGATES TO computeShoulderAbduction ───────────────────────────
 * Anatomically, abduction (frontal plane, arm out to the side) and flexion
 * (sagittal plane, arm forward and up) are different motions. With a
 * front-facing 2D webcam, both motions are projected into the image plane
 * and the metric we can measure is the apparent angle between the trunk-down
 * vector and the upper-arm vector — the same geometric quantity in both cases.
 *
 * Clinically, patients perform "overhead arm raises" in front of a webcam by
 * lifting their arms straight up in the FRONTAL plane (extending lateral
 * abduction past horizontal into the overhead region), not by true sagittal
 * flexion. The frontal-plane motion is well-captured by the abduction math:
 *   arm at side       → 0°
 *   arm horizontal    → 90°
 *   arm overhead      → ~180°
 *
 * If a patient does perform true sagittal flexion (arm forward), the elbow
 * lands near the shoulder in image space and the apparent angle reads
 * artificially small. That foreshortening is an accepted thesis limitation
 * — this function returns the APPARENT angle, not the anatomical angle.
 *
 * ── INHERITED CONTRACT ───────────────────────────────────────────────────────
 * Because this delegates, all of `computeShoulderAbduction`'s behavior carries
 * over verbatim:
 *   - per-side sign normalization (lateral motion is positive on both sides)
 *   - returns null during cross-body motion (the rep counter relies on this
 *     to detect that the arm went out of the valid lateral region)
 *   - returns null on any landmark below MIN_VIS
 *   - camera-roll invariant (no tilt subtraction)
 *
 * If ex_002 ever needs to diverge from ex_001 (e.g. a different sign rule,
 * a different rest reference, or compensation-specific behavior), break this
 * delegation and implement inline. For now keep one source of truth so the
 * cross-body null contract can't drift between the two exercises.
 */
export function computeShoulderFlexion(
  landmarks: LM[],
  tiltRef: TiltReference,
  side: "left" | "right"
): number | null {
  return computeShoulderAbduction(landmarks, tiltRef, side);
}

/**
 * Scapular elevation (normalized trunk-length units) — used by ex_003 Shoulder
 * Shrugs as the primary metric and by ex_001 Lateral Arm Raises as a
 * compensation metric (shoulder hiking).
 *
 * ── METHOD: TRUNK-AXIS PROJECTION ────────────────────────────────────────────
 * Returns the signed projection of the ear-from-shoulder offset onto the
 * trunk axis (shoulder-midpoint → hip-midpoint direction), normalized by
 * trunk length so the value is scale-invariant across patients.
 *
 * Why projection along the trunk axis, not image-vertical distance:
 *   - Lateral arm raises performed with proper form involve a slight forward
 *     lean. In image-vertical units, the lean alone reduces ear-to-shoulder
 *     distance, producing a false positive on "shrug" even when the trapezius
 *     isn't recruiting.
 *   - Projecting along the trunk axis preserves the relative geometry of ear
 *     and shoulder along the body, independent of how the body is oriented in
 *     the camera frame (within reasonable lean angles).
 *
 * ── SIGN CONVENTION ──────────────────────────────────────────────────────────
 * Trunk-up vector points from hip-midpoint toward shoulder-midpoint. The ear
 * sits ABOVE the shoulder (further along trunk-up), so the projection is
 * positive at rest. When the shoulder hikes toward the ear, the ear-from-
 * shoulder distance along trunk-up DECREASES — i.e., a shrug produces a
 * smaller value than baseline.
 *
 * The caller subtracts a per-session resting baseline and inverts the sign so
 * downstream consumers (rep counter, warning threshold) see "positive =
 * elevation away from rest" — see baselineCapture handling in the camera loop.
 * THIS FUNCTION returns the raw signed projection. It is the caller's job to
 * baseline-subtract and re-orient.
 *
 * ── FAILURE MODES (acknowledged in thesis limitations) ───────────────────────
 *   - Forward head posture during lean: head juts forward independently of
 *     trunk, breaking the assumption that ear and trunk move together.
 *   - Cervical flexion (chin-to-chest): shortens projection along trunk axis,
 *     reads as shrug in the wrong direction.
 *   - Camera height too low/high: distorts the projection.
 *
 * ── LANDMARKS REQUIRED ───────────────────────────────────────────────────────
 *   11, 12 — shoulders (for shoulder-midpoint and per-side shoulder)
 *   23, 24 — hips (for hip-midpoint, completes trunk axis)
 *   side="left":  7  (left ear)
 *   side="right": 8  (right ear)
 *
 * Returns null if any required landmark is below MIN_VIS, or if trunk length
 * is degenerate (patient sitting on the camera, basically).
 */
export function computeScapularElevation(
  landmarks: LM[],
  _tiltRef: TiltReference,
  side: "left" | "right"
): number | null {
  const leftShoulder  = landmarks[11];
  const rightShoulder = landmarks[12];
  const leftHip       = landmarks[23];
  const rightHip      = landmarks[24];

  if (!pairVisible(leftShoulder, rightShoulder)) return null;
  if (!pairVisible(leftHip, rightHip))           return null;

  const ear = side === "left" ? landmarks[7] : landmarks[8];
  if (!ear || vis(ear) < MIN_VIS) return null;

  const shoulderMid: LM = {
    x: (leftShoulder!.x + rightShoulder!.x) / 2,
    y: (leftShoulder!.y + rightShoulder!.y) / 2,
  };
  const hipMid: LM = {
    x: (leftHip!.x + rightHip!.x) / 2,
    y: (leftHip!.y + rightHip!.y) / 2,
  };

  // Trunk-up vector (hip → shoulder direction). In normalized image coords
  // with y increasing downward, "up" in the image corresponds to NEGATIVE dy.
  const trunkVecX = shoulderMid.x - hipMid.x;
  const trunkVecY = shoulderMid.y - hipMid.y;
  const trunkLen  = Math.hypot(trunkVecX, trunkVecY);

  // Degenerate case: shoulder and hip midpoints essentially coincide. Either
  // the patient is collapsed, or landmarks are wildly off. Either way the
  // projection is meaningless.
  const TRUNK_LEN_EPSILON = 0.05; // 5% of frame height; well below any real torso
  if (trunkLen < TRUNK_LEN_EPSILON) return null;

  const trunkUpX = trunkVecX / trunkLen;
  const trunkUpY = trunkVecY / trunkLen;

  // Per-side shoulder for the ear-from-shoulder vector. Using the SAME-side
  // shoulder rather than shoulder-midpoint preserves the asymmetric signal:
  // if only one shoulder hikes, that side's measurement changes while the
  // other side's stays near baseline.
  const sameShoulder = side === "left" ? leftShoulder! : rightShoulder!;
  const earOffsetX = ear.x - sameShoulder.x;
  const earOffsetY = ear.y - sameShoulder.y;

  // Dot product with trunk-up direction, then normalize by trunk length so
  // the result is in "trunk-length units" rather than raw normalized pixels.
  const projection = earOffsetX * trunkUpX + earOffsetY * trunkUpY;
  return projection / trunkLen;
}

/**
 * Signed neck lateral flexion angle (degrees) — used by ex_004.
 *
 * Returns the tilt-corrected ear-line angle in body-relative frame.
 * Sign convention (authoritative; pinned by neckSideAgreement.test.ts,
 * matches `computeLateralNeckTilt` + CLAUDE.md):
 *   positive  →  head tilting to the patient's LEFT
 *   negative  →  head tilting to the patient's RIGHT
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
  /**
   * Per-side primary metric values for per-limb bilateral exercises.
   * Only populated when the active exercise has bilateralMode === "per-limb".
   * The rep-counting loop reads these instead of the single `metrics[name]`
   * entry so each arm's counter gets its own angle stream.
   *
   * For bidirectional-alternating and unilateral exercises this is undefined —
   * those modes read from `metrics` directly.
   */
  perSideMetrics?: {
    left: number | null;
    right: number | null;
  };
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
  let perSideMetrics: { left: number | null; right: number | null } | undefined;

  // ── Primary metric ──────────────────────────────────────────────────────
  if (definition.kind === "dynamic") {
    const p = definition.primaryMetric;

    if (definition.bilateral && definition.bilateralMode === "per-limb") {
      // Per-limb: compute the metric once per side. Both values go into
      // perSideMetrics for the rep counters; the left value is also placed
      // in the main metrics map so compensation-score and UI code that
      // expects a single entry still works without changes.
      const leftVal  = computeMetricByName(landmarks, tiltReference, p.name, "left");
      const rightVal = computeMetricByName(landmarks, tiltReference, p.name, "right");
      metrics[p.name] = leftVal;
      perSideMetrics = { left: leftVal, right: rightVal };
    } else {
      // Bidirectional-alternating or unilateral: single value, no per-side split.
      metrics[p.name] = computeMetricByName(landmarks, tiltReference, p.name, p.side);
    }
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

  return { tiltReference, metrics, perSideMetrics, compensationScore };
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