export type ReadinessStatus =
  | "OK"
  | "MOVE_CLOSER"
  | "MOVE_BACK"
  | "MOVE_LEFT"
  | "MOVE_RIGHT"
  | "MOVE_UP"
  | "MOVE_DOWN"
  | "LOW_CONFIDENCE"
  | "NOT_VISIBLE"
  | "HANDS_NOT_VISIBLE"
  | "KNEES_NOT_VISIBLE"
  | "HEAD_NOT_POSITIONED";

export type Rect = { x: number; y: number; w: number; h: number };

export type ReadinessResult = {
  ok: boolean;
  status: ReadinessStatus;
  message: string;
  target: Rect;
  person?: Rect;
  score01: number;
};

type LM = { x: number; y: number; visibility?: number };

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function inFrame01(p: LM) {
  return p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
}

function vis(p: LM) {
  return typeof p.visibility === "number" ? p.visibility : 1;
}

function avgVisibility(lms: LM[]) {
  const v = lms.map((p) => vis(p)).filter((x) => Number.isFinite(x));
  if (v.length === 0) return 0;
  return v.reduce((s, x) => s + x, 0) / v.length;
}

function bboxPx(lms: LM[], vw: number, vh: number): Rect | null {
  if (!lms.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of lms) {
    const x = clamp(p.x, 0, 1) * vw;
    const y = clamp(p.y, 0, 1) * vh;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const w = Math.max(0, maxX - minX);
  const h = Math.max(0, maxY - minY);
  if (w < 10 || h < 10) return null;
  return { x: minX, y: minY, w, h };
}

// ─────────────────────────────────────────────────────────────────────────────
// POSITIONING CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * HEAD VERTICAL RANGE
 *
 * The nose should appear in the upper portion of the frame.
 * Why this range?
 *   - HEAD_Y_MIN (0.05): prevents the head from being cut off at the very top
 *   - HEAD_Y_MAX (0.25): keeps the head in the top quarter, which naturally
 *     centers the torso in the frame and leaves room for hips and knees below
 *
 * With the nose at y ≈ 0.15–0.20, hips typically fall around y ≈ 0.55–0.65,
 * which is well within frame and clearly visible for the tilt reference.
 */
const HEAD_Y_MIN = 0.05;
const HEAD_Y_MAX = 0.25;

/**
 * HEAD HORIZONTAL TOLERANCE
 *
 * Slightly more lenient than the previous center-gate (±0.07) because the
 * primary framing concern is now vertical, not horizontal. Minor horizontal
 * offset has a much smaller impact on metric quality than vertical miscutting.
 */
const HEAD_X_CENTER = 0.5;
const HEAD_X_TOL    = 0.12;

/**
 * KNEE VISIBILITY THRESHOLD
 *
 * Minimum visibility score required for knee landmarks (LM25, LM26).
 * Set lower than wrist threshold (0.6) because knees are partially occluded
 * more often by clothing and are at the edge of the recommended frame area.
 * 0.5 is still meaningful — it means the model has reasonable confidence
 * the landmark is in the visible part of the image.
 *
 * Why knees as a gate?
 * If both knees are visible, the hips (LM23, LM24) are almost certainly
 * fully in frame and well-detected — knees are always below the hips.
 * This indirectly guarantees the tilt reference has clean data to work with.
 */
const KNEE_VIS_MIN = 0.5;

/**
 * WRIST VISIBILITY THRESHOLD
 *
 * Kept from the previous implementation. Wrist visibility ensures the full
 * upper body including arm positions can be tracked during exercises.
 */
const HAND_VIS_MIN = 0.6;

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────────────────────

export function evaluateCaptureReadiness(
  landmarks: LM[] | undefined,
  videoW: number,
  videoH: number
): ReadinessResult {
  /**
   * The target rect shown in the overlay now represents the head zone
   * (top quarter of frame, centered) rather than a center window.
   * This visually guides the patient to position themselves correctly.
   */
  const targetW = videoW * 0.20;
  const targetH = videoH * 0.20;
  const target: Rect = {
    x: (videoW - targetW) / 2,
    y: videoH * HEAD_Y_MIN,
    w: targetW,
    h: targetH,
  };

  // ── Gate 0: any person detected at all ───────────────────────────────────
  if (!landmarks || landmarks.length === 0) {
    return {
      ok: false,
      status: "NOT_VISIBLE",
      message: "No person detected. Step into the frame.",
      target,
      score01: 0,
    };
  }

  // ── Gate 1: overall landmark confidence ──────────────────────────────────
  const overall = avgVisibility(landmarks);
  if (overall < 0.5) {
    return {
      ok: false,
      status: "LOW_CONFIDENCE",
      message: "Hold still and ensure good lighting.",
      target,
      score01: overall,
    };
  }

  const person = bboxPx(landmarks, videoW, videoH) ?? undefined;

  // ── Gate 2: head vertical position ───────────────────────────────────────
  /**
   * We check the nose (LM0) y-coordinate against HEAD_Y_MIN / HEAD_Y_MAX.
   * Directional messages tell the patient exactly how to adjust.
   *
   * "Move back" (farther from camera) raises the apparent body in frame.
   * "Move closer" lowers it. We phrase this as "step back/forward" because
   * that's how a patient at home naturally thinks about it.
   */
  const nose = landmarks[0];

  if (!nose || !inFrame01(nose) || vis(nose) < 0.6) {
    return {
      ok: false,
      status: "HEAD_NOT_POSITIONED",
      message: "Make sure your face is visible.",
      target,
      person,
      score01: nose ? vis(nose) : 0,
    };
  }

  if (nose.y < HEAD_Y_MIN) {
    // Head too high in frame — patient is too close or camera angled up
    return {
      ok: false,
      status: "MOVE_BACK",
      message: "Step back or lower the camera so your full body is visible.",
      target,
      person,
      score01: vis(nose),
    };
  }

  if (nose.y > HEAD_Y_MAX) {
    // Head too low in frame — patient is too far or camera angled down
    return {
      ok: false,
      status: "MOVE_CLOSER",
      message: "Step closer or raise the camera so your head is near the top.",
      target,
      person,
      score01: vis(nose),
    };
  }

  // ── Gate 3: head horizontal centering ────────────────────────────────────
  const dx = nose.x - HEAD_X_CENTER;
  if (Math.abs(dx) > HEAD_X_TOL) {
    const status = dx < 0 ? "MOVE_RIGHT" : "MOVE_LEFT";
    const message = dx < 0
      ? "Move right to center yourself."
      : "Move left to center yourself.";
    return { ok: false, status, message, target, person, score01: vis(nose) };
  }

  // ── Gate 4: knee visibility ───────────────────────────────────────────────
  /**
   * MediaPipe Pose landmarks:
   *   25 = left knee
   *   26 = right knee
   *
   * We require both knees to be visible. If a knee is off-screen or occluded,
   * it almost certainly means the hips are also partially clipped — which
   * would corrupt the tilt reference and make all metrics unreliable.
   *
   * We check inFrame01 here because a landmark can have reasonable visibility
   * score even when it's being extrapolated just outside the frame boundary.
   */
  const leftKnee  = landmarks[25];
  const rightKnee = landmarks[26];

  const leftKneeOk  = !!leftKnee  && inFrame01(leftKnee)  && vis(leftKnee)  >= KNEE_VIS_MIN;
  const rightKneeOk = !!rightKnee && inFrame01(rightKnee) && vis(rightKnee) >= KNEE_VIS_MIN;

  if (!leftKneeOk || !rightKneeOk) {
    const msg = !leftKneeOk && !rightKneeOk
      ? "Step back so your knees are visible — hips must be in frame."
      : !leftKneeOk
      ? "Your left knee is not visible. Step back slightly."
      : "Your right knee is not visible. Step back slightly.";

    return {
      ok: false,
      status: "KNEES_NOT_VISIBLE",
      message: msg,
      target,
      person,
      score01: Math.min(
        vis(leftKnee  ?? { x: 0, y: 0 }),
        vis(rightKnee ?? { x: 0, y: 0 })
      ),
    };
  }

  // ── Gate 5: wrist visibility ──────────────────────────────────────────────
  /**
   * Kept from the previous implementation.
   * Ensures both arms are in frame during exercises that involve arm movement.
   * Wrists are checked after knees because the knee gate is the more critical
   * one for metric quality — wrist occlusion only affects exercise tracking,
   * not the tilt reference.
   */
  const leftWrist  = landmarks[15];
  const rightWrist = landmarks[16];

  const leftHandOk  = !!leftWrist  && inFrame01(leftWrist)  && vis(leftWrist)  >= HAND_VIS_MIN;
  const rightHandOk = !!rightWrist && inFrame01(rightWrist) && vis(rightWrist) >= HAND_VIS_MIN;

  if (!leftHandOk || !rightHandOk) {
    const msg = !leftHandOk && !rightHandOk
      ? "Show both hands to the camera."
      : !leftHandOk
      ? "Show your left hand to the camera."
      : "Show your right hand to the camera.";

    return {
      ok: false,
      status: "HANDS_NOT_VISIBLE",
      message: msg,
      target,
      person,
      score01: Math.min(
        vis(leftWrist  ?? { x: 0, y: 0 }),
        vis(rightWrist ?? { x: 0, y: 0 })
      ),
    };
  }

  // ── All gates passed ──────────────────────────────────────────────────────
  return {
    ok: true,
    status: "OK",
    message: "Captured",
    target,
    person,
    score01: Math.min(vis(nose), vis(leftKnee!), vis(rightKnee!), vis(leftWrist!), vis(rightWrist!)),
  };
}