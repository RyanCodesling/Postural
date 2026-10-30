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
  | "HIPS_NOT_VISIBLE"
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
 * HEAD VERTICAL RANGE — MODE-DEPENDENT
 *
 * The acceptable head (nose) y-position differs by exercise type. Default
 * mode is "ground-to-shoulder" exercises (lateral raises, shrugs, side
 * neck flexion, T-pose) where the patient never reaches above head height —
 * head sits in the top quarter so the body extends down to include knees +
 * hips clearly. Side bends use lateral mode because the head can sweep far
 * down and sideways during the rep. Overhead mode is for exercises that
 * reach above head height (shoulder press, wall angels) — the head MUST
 * sit lower in the frame so the patient can stand further from the
 * camera and keep wrists in-frame at peak extension. Forcing head into
 * the top quarter for overhead exercises causes the wrists to leave the
 * frame at the top of the motion, which would otherwise pause metric
 * computation mid-rep.
 *
 * Default ("ground-to-shoulder"):
 *   HEAD_Y_MIN = 0.05  — head not cut off at the very top
 *   HEAD_Y_MAX = 0.25  — head in top quarter; body extends down to knees
 *
 * Overhead ("requires overhead room"):
 *   HEAD_Y_MIN = 0.10  — leaves at least 10% frame above head as minimum
 *                        clearance for hands at peak
 *   HEAD_Y_MAX = 0.45  — head allowed in upper-middle area; patient is
 *                        smaller in frame, further from camera, with
 *                        substantial overhead room
 *
 * Added 2026-05-21 (live-tuning iter #2): the original single-zone rule
 * forced overhead-exercise patients close to the camera and their wrists
 * left the frame at the top of every press. Per-mode bounds let them
 * back up while preserving the strict "in the top quarter" feel for
 * exercises that don't need overhead clearance.
 */
export type FramingMode = "default" | "overhead" | "lateral";

function headYBounds(mode: FramingMode): { min: number; max: number } {
  // "lateral" (side bends): a side bend drops the head as the torso tilts, so
  // the head-y ceiling is relaxed far below the strict top-quarter cap. The
  // ex_005 metric tracks the HEAD itself, so the head must stay accepted
  // through the whole bend. The face/ear metric guards still reject truly
  // off-frame heads, and the knee gate still ensures the body fits.
  if (mode === "lateral")  return { min: 0.00, max: 0.92 };
  return mode === "overhead"
    ? { min: 0.10, max: 0.45 }
    // Default ceiling relaxed 0.25 -> 0.35 (2026-09-07), on measurement rather
    // than preference. In a recorded ex_006 session a deliberate backward lean
    // put the ear line at y = 0.250 — flush against the old 0.25 ceiling with
    // no margin at all — and the transitions in and out of it crossed the gate.
    // Each crossing was a sustained readiness dropout, and at the time a
    // dropout re-ran neutral calibration, so the session silently re-captured
    // its "neutral" baseline while the subject was leaning and again while
    // slouching. The bound was rejecting ordinary postural movement, not bad
    // framing. 0.35 leaves roughly 0.10 of margin over that measured worst case
    // and stays well inside the overhead mode's 0.45. It is safe to relax
    // because it was only ever a proxy for "does the body still fit below the
    // head" — the knee-visibility gate tests that directly, and still does.
    : { min: 0.05, max: 0.35 };
}

/**
 * HEAD HORIZONTAL TOLERANCE — MODE-DEPENDENT
 *
 * Default/overhead keep the tight ±0.12 center gate. "lateral" mode (side
 * bends) widens it substantially: a side bend swings the head far off-center,
 * and the ex_005 metric needs the HEAD tracked throughout, so the gate must not
 * pause mid-bend. ±0.42 lets the nose range over almost the full width
 * (x ∈ [0.08, 0.92]); only a head near the very edge fails. The overlay target
 * uses this same width in lateral mode so the visible target matches the gate.
 */
const HEAD_X_TOL_DEFAULT = 0.12;
const HEAD_X_TOL_LATERAL = 0.42;

function headXTol(mode: FramingMode): number {
  return mode === "lateral" ? HEAD_X_TOL_LATERAL : HEAD_X_TOL_DEFAULT;
}

const HEAD_X_CENTER = 0.5;

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
 * HIP VISIBILITY THRESHOLD (lateral mode)
 *
 * In lateral mode (side bends) the hips are checked directly, because the knee
 * visibility score proved unreliable there (see Gate 4). 0.5 matches the
 * landmark rule the side-bend metric itself applies (`MIN_VIS` in
 * poseMetrics.ts).
 */
const HIP_VIS_MIN = 0.5;

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
  videoH: number,
  mode: FramingMode = "default",
  requiredSide: "both" | "left" | "right" = "both",
): ReadinessResult {
  const { min: HEAD_Y_MIN, max: HEAD_Y_MAX } = headYBounds(mode);
  const HEAD_X_TOL = headXTol(mode);
  const isOverhead = mode === "overhead";
  const isLateral = mode === "lateral";

  /**
   * The target rect shown in the overlay represents the head zone for the
   * active mode. Its height matches the actual valid y-span (HEAD_Y_MAX
   * − HEAD_Y_MIN), and lateral mode also widens the visible target horizontally
   * so side-bend users do not chase a narrower visual box than the real gate.
   */
  const targetW = videoW * (isLateral ? HEAD_X_TOL * 2 : 0.20);
  const targetH = videoH * (HEAD_Y_MAX - HEAD_Y_MIN);
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
      message: "Step back or lower the camera so you are visible from head to knees.",
      target,
      person,
      score01: vis(nose),
    };
  }

  if (nose.y > HEAD_Y_MAX) {
    // Head too low in frame — patient is too far or camera angled down.
    // In overhead mode the head is meant to sit in the upper-middle (not the
    // top quarter), so "near the top" would contradict the framing the patient
    // was told to adopt — phrase it as head-to-knees framing instead.
    return {
      ok: false,
      status: "MOVE_CLOSER",
      message: isOverhead
        ? "Step closer or raise the camera so you are in frame from head to knees."
        : "Step closer or raise the camera so your head is near the top.",
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
   *
   * LATERAL MODE (side bends), changed 2026-10-02: the knees must still lie
   * inside the picture, but their visibility score is not required. At the
   * bottom of a deep side bend MediaPipe's knee visibility falls below 0.5
   * although both knees are plainly visible: a live side-bend session lost 342
   * frames (12.8 s) and 12 bends that way, with the knees at about 80% of the
   * frame height and no hand over them. What this gate protects, the hips in
   * frame and well detected, is checked directly below instead.
   */
  const leftKnee  = landmarks[25];
  const rightKnee = landmarks[26];
  const kneeSeen = (knee: LM | undefined) =>
    !!knee && inFrame01(knee) && (isLateral || vis(knee) >= KNEE_VIS_MIN);

  const leftKneeOk  = kneeSeen(leftKnee);
  const rightKneeOk = kneeSeen(rightKnee);

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

  // ── Gate 4b: hip visibility (lateral mode only) ─────────────────────────
  // Replaces the knee visibility score in lateral mode (see Gate 4): the side
  // bend's metric runs from the hip midpoint, so both hips must be inside the
  // picture and well detected.
  if (isLateral) {
    const leftHip  = landmarks[23];
    const rightHip = landmarks[24];
    const hipSeen = (hip: LM | undefined) => !!hip && inFrame01(hip) && vis(hip) >= HIP_VIS_MIN;
    if (!hipSeen(leftHip) || !hipSeen(rightHip)) {
      return {
        ok: false,
        status: "HIPS_NOT_VISIBLE",
        message: "Step back so your hips and knees are in the picture.",
        target,
        person,
        score01: Math.min(
          vis(leftHip  ?? { x: 0, y: 0 }),
          vis(rightHip ?? { x: 0, y: 0 })
        ),
      };
    }
  }

  // ── Gate 5: wrist visibility (SKIPPED in overhead/lateral modes) ─────────
  /**
   * Wrist visibility ensures both arms are in frame during exercises that
   * involve arm movement. In DEFAULT mode this gate is strict — if a wrist
   * leaves the frame, metric computation pauses.
   *
   * SKIPPED in OVERHEAD mode (added 2026-05-21, live-tuning iter #2):
   * overhead-reach exercises (ex_007 Press, ex_008 Wall Angels) routinely
   * push the wrists out of the visible frame at the top of the motion.
   * Pausing metrics there would silently drop the peak — exactly the
   * frames the rep counter needs. Instead, we trust the metric-level null
   * handling: when a wrist landmark is missing, the per-side metric
   * returns null, the rep counter sees a gap, and the in-progress rep's
   * peak is frozen at the last visible value. The `RepCounter` continuity
   * gate handles the resulting time gap correctly — it
   * doesn't refuse a rep just because the peak was reached during a
   * brief out-of-frame interval, as long as the ASCENDING phase had
   * enough visible data to track the climb.
   *
   * The framing rule itself (head positioned lower in the frame for
   * overhead mode) is calibrated so that the patient stands far enough
   * from the camera that wrists DO stay in frame at peak — the wrist
   * gate is skipped as a safety net for the off-nominal case, not a
   * primary expectation.
   *
   * SKIPPED in LATERAL mode (side bends): ex_005 does not use wrists for its
   * primary or compensation metrics. Requiring hands at the frame edge can
   * pause a valid trunk bend even when the head/hips/shoulders are tracked.
   */
  const leftWrist  = landmarks[15];
  const rightWrist = landmarks[16];

  if (!isOverhead && !isLateral) {
    const rawLeftInFrame = !!leftWrist && inFrame01(leftWrist);
    const rawRightInFrame = !!rightWrist && inFrame01(rightWrist);
    const rawLeftHandOk = rawLeftInFrame && vis(leftWrist) >= HAND_VIS_MIN;
    const rawRightHandOk = rawRightInFrame && vis(rightWrist) >= HAND_VIS_MIN;
    // MediaPipe names the person's own sides on the raw camera frame it reads;
    // only the screen is mirrored, by CSS. Its left wrist is the patient's left
    // hand: the repetition counters read the same sides (a right-arm-only raise
    // counted on the right in a live check), and so does the knee gate above.
    // Until 2026-10-25 this gate assumed a mirrored frame and swapped them, so
    // it named the other hand and a one-sided prescription required the other
    // hand.
    const leftHandOk = rawLeftHandOk;
    const rightHandOk = rawRightHandOk;
    const leftHandInFrame = rawLeftInFrame;
    const rightHandInFrame = rawRightInFrame;
    const requiredHandsOk =
      requiredSide === "left"
        ? leftHandOk
        : requiredSide === "right"
          ? rightHandOk
          : leftHandOk && rightHandOk;

    if (!requiredHandsOk) {
      // A required hand inside the picture whose visibility is under the line
      // is there but not made out: it blends into the background or is hidden
      // behind the body. Asking to show it would name the wrong fix.
      const missingLeft = requiredSide !== "right" && !leftHandOk;
      const missingRight = requiredSide !== "left" && !rightHandOk;
      const unclear = (!missingLeft || leftHandInFrame) && (!missingRight || rightHandInFrame);
      const msg = unclear
        ? missingLeft && missingRight
          ? "The camera can't make out your hands. A plainer background or clothes that stand out may help."
          : `The camera can't make out your ${missingLeft ? "left" : "right"} hand. A plainer background or clothes that stand out may help.`
        : requiredSide === "left"
        ? "Show your left hand to the camera."
        : requiredSide === "right"
          ? "Show your right hand to the camera."
          : !leftHandOk && !rightHandOk
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
        score01:
          requiredSide === "left"
            ? vis(leftWrist ?? { x: 0, y: 0 })
            : requiredSide === "right"
              ? vis(rightWrist ?? { x: 0, y: 0 })
              : Math.min(
                  vis(leftWrist ?? { x: 0, y: 0 }),
                  vis(rightWrist ?? { x: 0, y: 0 }),
                ),
      };
    }
  }

  // ── All gates passed ──────────────────────────────────────────────────────
  // Wrist visibility contributes to the score01 only when it's present and
  // we required it (default mode). In overhead mode, missing wrists are
  // acceptable and don't penalize confidence — the metric pipeline
  // gracefully degrades. Use `??` fallbacks so we never call `vis(undefined)`.
  const safeLeftWristVis =
    requiredSide === "left" || requiredSide === "both"
      ? leftWrist
        ? vis(leftWrist)
        : 1
      : 1;
  const safeRightWristVis =
    requiredSide === "right" || requiredSide === "both"
      ? rightWrist
        ? vis(rightWrist)
        : 1
      : 1;
  return {
    ok: true,
    status: "OK",
    message: "Captured",
    target,
    person,
    score01: Math.min(
      vis(nose),
      vis(leftKnee!),
      vis(rightKnee!),
      safeLeftWristVis,
      safeRightWristVis,
    ),
  };
}
