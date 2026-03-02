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
  | "HEAD_NOT_CENTERED";

export type Rect = { x: number; y: number; w: number; h: number };

export type ReadinessResult = {
  ok: boolean;
  status: ReadinessStatus;
  message: string;
  target: Rect; // guide area (we’ll use this as a head-center target box)
  person?: Rect; // optional debug bbox (we’ll keep it but not rely on it)
  score01: number; // 0..1
};

// MediaPipe Pose landmarks: normalized 0..1 (x,y)
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
  const v = lms
    .map((p) => vis(p))
    .filter((x) => Number.isFinite(x));
  if (v.length === 0) return 0;
  return v.reduce((s, x) => s + x, 0) / v.length;
}

function bboxPx(lms: LM[], vw: number, vh: number): Rect | null {
  if (!lms.length) return null;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

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

export function evaluateCaptureReadiness(
  landmarks: LM[] | undefined,
  videoW: number,
  videoH: number
): ReadinessResult {
  // We’ll use a small center “head target” window for the overlay guide
  // (Tune these proportions to your preference.)
  const w = videoW * 0.20;
  const h = videoH * 0.30;
  const target: Rect = {
    x: (videoW - w) / 2,
    y: (videoH - h) / 2,
    w,
    h,
  };

  if (!landmarks || landmarks.length === 0) {
    return {
      ok: false,
      status: "NOT_VISIBLE",
      message: "No person detected. Step into the frame.",
      target,
      score01: 0,
    };
  }

  // Overall confidence (still useful to avoid noisy tracking)
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

  // Optional debug bbox (not used for gating anymore)
  const person = bboxPx(landmarks, videoW, videoH) ?? undefined;

  /**
   * MediaPipe Pose landmark indices we care about:
   * 0  = nose
   * 15 = left wrist
   * 16 = right wrist
   */
  const nose = landmarks[0];
  const leftWrist = landmarks[15];
  const rightWrist = landmarks[16];

  // ---- Gate 1: both hands visible (wrists as proxy)
  const HAND_VIS_MIN = 0.6;

  const leftHandOk =
    !!leftWrist && inFrame01(leftWrist) && vis(leftWrist) >= HAND_VIS_MIN;
  const rightHandOk =
    !!rightWrist && inFrame01(rightWrist) && vis(rightWrist) >= HAND_VIS_MIN;

  if (!leftHandOk || !rightHandOk) {
    // More specific message if only one hand is missing
    const msg =
      !leftHandOk && !rightHandOk
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
      score01: Math.min(vis(leftWrist ?? { x: 0, y: 0 }), vis(rightWrist ?? { x: 0, y: 0 })),
    };
  }

  // ---- Gate 2: head centered (nose near center)
  if (!nose || !inFrame01(nose) || vis(nose) < 0.6) {
    return {
      ok: false,
      status: "HEAD_NOT_CENTERED",
      message: "Make sure your face is visible and centered.",
      target,
      person,
      score01: nose ? vis(nose) : 0,
    };
  }

  // Center tolerance (how strict “very center” is)
  // Smaller values = stricter. Start here and tune:
  const CENTER_TOL_X = 0.07; // 7% of frame width from exact center
  const CENTER_TOL_Y = 0.08; // 8% of frame height from exact center

  const dx = nose.x - 0.5;
  const dy = nose.y - 0.5;

  const headCentered = Math.abs(dx) <= CENTER_TOL_X && Math.abs(dy) <= CENTER_TOL_Y;

  if (!headCentered) {
    // Directional hint based on which side of center
    let status: ReadinessStatus = "HEAD_NOT_CENTERED";
    let message = "Center your head in the camera.";

    if (Math.abs(dx) > CENTER_TOL_X) {
      status = dx < 0 ? "MOVE_RIGHT" : "MOVE_LEFT";
      message = dx < 0 ? "Move right to center your head." : "Move left to center your head.";
    } else if (Math.abs(dy) > CENTER_TOL_Y) {
      status = dy < 0 ? "MOVE_DOWN" : "MOVE_UP";
      message = dy < 0 ? "Move down/farther to center your head." : "Move up/closer to center your head.";
    }

    return {
      ok: false,
      status,
      message,
      target,
      person,
      score01: vis(nose),
    };
  }

  return {
    ok: true,
    status: "OK",
    message: "Captured",
    target,
    person,
    score01: Math.min(vis(nose), vis(leftWrist), vis(rightWrist)),
  };
}