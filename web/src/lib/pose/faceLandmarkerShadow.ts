/**
 * Pure helpers for the opt-in ex_004 Face Landmarker shadow diagnostic.
 *
 * The live exercise remains authoritative on Pose Landmarker. These helpers
 * only reproduce the fixed Pose-guided crop and transformation-matrix
 * orientation extraction used by the offline comparison harness.
 */

type PosePoint = {
  x: number;
  y: number;
  visibility?: number;
};

export type FixedFaceRoi = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  pixel: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  };
};

export type FaceTransformMatrix = {
  rows: number;
  columns: number;
  data: readonly number[];
};

export type FaceOrientationDegrees = {
  /** Rotation about camera Z, converted to Postural's y-down image convention. */
  rollImageDeg: number;
  /** Rotation about MediaPipe metric-space Y. Used diagnostically for yaw. */
  yawDeg: number;
  /** Rotation about MediaPipe metric-space X. Used diagnostically for pitch. */
  pitchDeg: number;
};

const MIN_EAR_VISIBILITY = 0.5;

function visibility(point: PosePoint): number {
  return typeof point.visibility === "number" ? point.visibility : 1;
}

function finitePoint(point: PosePoint | undefined): point is PosePoint {
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

/**
 * Build the same generous, axis-aligned square crop used by the successful
 * offline screen. LM7/LM8 are MediaPipe Pose's left/right ear landmarks.
 * The crop is fixed by the caller for the rest of the calibration/session.
 */
export function fixedFaceRoiFromPose(
  landmarks: readonly PosePoint[],
  frameWidth: number,
  frameHeight: number,
): FixedFaceRoi | null {
  const leftEar = landmarks[7];
  const rightEar = landmarks[8];
  if (
    !finitePoint(leftEar) ||
    !finitePoint(rightEar) ||
    visibility(leftEar) < MIN_EAR_VISIBILITY ||
    visibility(rightEar) < MIN_EAR_VISIBILITY ||
    !Number.isFinite(frameWidth) ||
    !Number.isFinite(frameHeight) ||
    frameWidth <= 1 ||
    frameHeight <= 1
  ) {
    return null;
  }

  const leftX = leftEar.x * frameWidth;
  const leftY = leftEar.y * frameHeight;
  const rightX = rightEar.x * frameWidth;
  const rightY = rightEar.y * frameHeight;
  const earSpanPx = Math.hypot(leftX - rightX, leftY - rightY);
  if (earSpanPx < 2) return null;

  const minDimension = Math.min(frameWidth, frameHeight);
  const sidePx = Math.max(
    2,
    Math.round(
      Math.min(
        Math.max(5.5 * earSpanPx, 0.22 * minDimension),
        0.55 * minDimension,
      ),
    ),
  );
  const centerX = (leftX + rightX) / 2;
  const centerY = (leftY + rightY) / 2 - 0.05 * sidePx;
  const maxX0 = Math.max(frameWidth - sidePx, 0);
  const maxY0 = Math.max(frameHeight - sidePx, 0);
  const x0 = Math.min(Math.max(Math.round(centerX - sidePx / 2), 0), maxX0);
  const y0 = Math.min(Math.max(Math.round(centerY - sidePx / 2), 0), maxY0);
  const x1 = Math.min(x0 + sidePx, frameWidth);
  const y1 = Math.min(y0 + sidePx, frameHeight);
  if (x1 <= x0 || y1 <= y0) return null;

  return {
    left: x0 / frameWidth,
    top: y0 / frameHeight,
    right: x1 / frameWidth,
    bottom: y1 / frameHeight,
    pixel: { x0, y0, x1, y1 },
  };
}

type Vector3 = readonly [number, number, number];

function dot3(left: Vector3, right: Vector3): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function normalize3(vector: Vector3): Vector3 | null {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (!Number.isFinite(length) || length < 1e-9) return null;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function cross3(left: Vector3, right: Vector3): Vector3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

/**
 * Read roll/yaw/pitch diagnostics from MediaPipe's 4x4 face transform.
 *
 * MatrixData is column-major. The upper-left 3x3 maps the canonical face into
 * MediaPipe's right-handed metric camera space and may carry scale. A small
 * Gram-Schmidt step removes scale/shear and rejects reflections before the
 * proper rotation is decomposed as Rz(roll) * Ry(yaw) * Rx(pitch). Negating
 * only roll converts metric y-up rotation to Postural's y-down image angle.
 *
 * Yaw and pitch are diagnostic matrix components, not anatomical cervical
 * angles. Their magnitudes are logged so controlled trials can later determine
 * whether out-of-plane motion invalidates the roll candidate.
 */
export function faceOrientationDegrees(
  matrix: FaceTransformMatrix | null | undefined,
): FaceOrientationDegrees | null {
  if (
    !matrix ||
    matrix.rows !== 4 ||
    matrix.columns !== 4 ||
    matrix.data.length < 16 ||
    !matrix.data.slice(0, 16).every(Number.isFinite)
  ) {
    return null;
  }

  const firstColumn = normalize3([
    matrix.data[0],
    matrix.data[1],
    matrix.data[2],
  ]);
  if (!firstColumn) return null;

  const secondRaw: Vector3 = [
    matrix.data[4],
    matrix.data[5],
    matrix.data[6],
  ];
  const projection = dot3(secondRaw, firstColumn);
  const secondColumn = normalize3([
    secondRaw[0] - projection * firstColumn[0],
    secondRaw[1] - projection * firstColumn[1],
    secondRaw[2] - projection * firstColumn[2],
  ]);
  const observedThird = normalize3([
    matrix.data[8],
    matrix.data[9],
    matrix.data[10],
  ]);
  if (!secondColumn || !observedThird) return null;

  const thirdColumn = normalize3(cross3(firstColumn, secondColumn));
  if (!thirdColumn || dot3(thirdColumn, observedThird) <= 0) return null;

  // Recompute Y from the proper X/Z pair so all three columns are orthonormal.
  const correctedSecond = cross3(thirdColumn, firstColumn);
  const r00 = firstColumn[0];
  const r10 = firstColumn[1];
  const r20 = firstColumn[2];
  const r21 = correctedSecond[2];
  const r22 = thirdColumn[2];
  const cosYaw = Math.hypot(r00, r10);
  if (cosYaw < 1e-7) return null;

  const toDegrees = 180 / Math.PI;
  const metricRollDeg = Math.atan2(r10, r00) * toDegrees;
  return {
    rollImageDeg: -metricRollDeg,
    yawDeg: Math.atan2(-r20, cosYaw) * toDegrees,
    pitchDeg: Math.atan2(r21, r22) * toDegrees,
  };
}

/** Backward-compatible roll-only accessor used by the existing diagnostic. */
export function faceRollImageDegrees(
  matrix: FaceTransformMatrix | null | undefined,
): number | null {
  return faceOrientationDegrees(matrix)?.rollImageDeg ?? null;
}

/** Signed current-minus-baseline delta normalized to [-180, 180]. */
export function angleDeltaDegrees(current: number, baseline: number): number {
  let delta = current - baseline;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  return delta;
}
