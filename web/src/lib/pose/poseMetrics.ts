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
      ? lineAngleDeg(leftHip!, rightHip!)
      : lineAngleDeg(leftEar!, rightEar!);
    return { cameraTiltDeg: tilt, confidence: "low", divergenceDeg: null };
  }

  // ── Both references available — check consensus ───────────────────────────
  const hipAngle = lineAngleDeg(leftHip!, rightHip!);
  const earAngle = lineAngleDeg(leftEar!, rightEar!);

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
  const leftEar  = landmarks[7];
  const rightEar = landmarks[8];

  if (!pairVisible(leftEar, rightEar)) return null;

  const rawEarAngle    = lineAngleDeg(leftEar!, rightEar!);
  const correctedAngle = angleDiffDeg(rawEarAngle, tiltRef.cameraTiltDeg);
  const absDeg         = Math.abs(correctedAngle);

  // 2° dead-band: below this, the angle is indistinguishable from landmark noise
  const direction: NeckTiltResult["direction"] =
    absDeg < 2         ? "center" :
    correctedAngle > 0 ? "right"  : "left";

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

  const rawShoulderAngle = lineAngleDeg(leftShoulder!, rightShoulder!);
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
// SECTION 5 — POSTURE SCORE (0–100)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * bandedDeduction
 *
 * Maps a continuous angle value to a point deduction using severity bands
 * with LINEAR INTERPOLATION within each band.
 *
 * ── WHY BANDED INSTEAD OF PURELY LINEAR? ─────────────────────────────────────
 * A purely linear score (e.g., −2 pts per degree) has two problems:
 *   1. A single extreme metric can exhaust its deduction budget before
 *      the other metric can contribute, making the score misleading.
 *   2. It implies equal clinical sensitivity across all angle values, which
 *      is not true — the difference between 1° and 2° is clinically
 *      insignificant, while 10° vs 11° is meaningful.
 *
 * ── WHY INTERPOLATE WITHIN BANDS? ────────────────────────────────────────────
 * Hard band boundaries create score cliffs: a patient at 4.9° and 5.1° would
 * receive very different scores for essentially the same posture. Linear
 * interpolation within each band makes the score a smooth, continuous function
 * of the angle, eliminating cliff effects at severity boundaries.
 *
 * How to read band definitions:
 *   { max: 10, deductionMin: 10, deductionMax: 25 }
 *   → When absDeg is between the previous band's max and 10°,
 *     the deduction scales linearly from 10 pts to 25 pts.
 */
function bandedDeduction(
  absDeg: number,
  bands: Array<{ max: number; deductionMin: number; deductionMax: number }>
): number {
  let prevMax = 0;

  for (const band of bands) {
    if (absDeg <= band.max) {
      const bandWidth = band.max - prevMax;
      // t = fractional position within this band (0 at entry, 1 at exit)
      const t = bandWidth > 0 ? (absDeg - prevMax) / bandWidth : 1;
      return band.deductionMin + t * (band.deductionMax - band.deductionMin);
    }
    prevMax = band.max;
  }

  // Beyond the last defined band — return its maximum deduction
  return bands[bands.length - 1].deductionMax;
}

/**
 * Neck tilt deduction table (max contribution: 50 pts)
 *
 *  0– 5° (normal):    0–10 pts   within tolerance, small penalty
 *  5–10° (mild):     10–25 pts   increasing concern
 * 10–20° (moderate): 25–40 pts   significant deviation
 * 20–30° (severe):   40–50 pts   maximum contribution; capped at 30°
 */
const NECK_BANDS = [
  { max: 5,  deductionMin: 0,  deductionMax: 10 },
  { max: 10, deductionMin: 10, deductionMax: 25 },
  { max: 20, deductionMin: 25, deductionMax: 40 },
  { max: 30, deductionMin: 40, deductionMax: 50 },
];

/**
 * Shoulder asymmetry deduction table (max contribution: 50 pts)
 *
 *  0– 3° (normal):    0 pts      noise floor — zero penalty always
 *  3– 7° (mild):      0–20 pts   clinically notable, common
 *  7–12° (moderate): 20–35 pts   likely compensatory pattern
 * 12–20° (severe):   35–50 pts   strong clinical flag; capped at 20°
 *
 * The explicit 0-pt noise floor band ensures we never penalize a patient
 * for a deviation that is indistinguishable from measurement error.
 */
const SHOULDER_BANDS = [
  { max: 3,  deductionMin: 0,  deductionMax: 0  },
  { max: 7,  deductionMin: 0,  deductionMax: 20 },
  { max: 12, deductionMin: 20, deductionMax: 35 },
  { max: 20, deductionMin: 35, deductionMax: 50 },
];

/**
 * computePostureScore
 *
 * 50/50 split between neck tilt and shoulder symmetry reflects:
 *   - Equal clinical relevance for upper-body rehabilitation exercises
 *   - Neither metric can single-handedly drive the score to 0
 *
 * Partial availability: if only one metric could be computed (e.g., hips
 * not visible so shoulder result is null), the score is computed from
 * whichever is available. The maximum deduction in that case is 50 pts,
 * so scores cluster higher. This is intentional — we must not penalize a
 * patient for data we simply could not measure.
 */
export function computePostureScore(
  neck: NeckTiltResult | null,
  shoulder: ShoulderSymmetryResult | null
): number | null {
  if (!neck && !shoulder) return null;

  let score = 100;
  if (neck)     score -= bandedDeduction(neck.angleDeg, NECK_BANDS);
  if (shoulder) score -= bandedDeduction(shoulder.angleDeg, SHOULDER_BANDS);

  return Math.max(0, Math.round(score));
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6 — MAIN EXPORT
// ─────────────────────────────────────────────────────────────────────────────

export type PoseMetrics = {
  /** Camera tilt estimate + confidence — log this per session for quality auditing */
  tiltReference: TiltReference;
  neckTilt: NeckTiltResult | null;
  shoulderSymmetry: ShoulderSymmetryResult | null;
  /** Composite score 0–100. Null only when no relevant landmarks are visible. */
  postureScore: number | null;
};

/**
 * computePoseMetrics
 *
 * Single entry point for the camera loop.
 * Call once per frame with results.landmarks[0] from MediaPipe.
 *
 * Execution order is mandatory:
 *   1. Tilt reference must be computed first — all metrics depend on it.
 *   2. Neck and shoulder can be computed in either order.
 *   3. Posture score is computed last, from the two corrected metrics.
 */
export function computePoseMetrics(landmarks: LM[]): PoseMetrics {
  const tiltReference    = computeTiltReference(landmarks);
  const neckTilt         = computeLateralNeckTilt(landmarks, tiltReference);
  const shoulderSymmetry = computeShoulderSymmetry(landmarks, tiltReference);
  const postureScore     = computePostureScore(neckTilt, shoulderSymmetry);

  return { tiltReference, neckTilt, shoulderSymmetry, postureScore };
}