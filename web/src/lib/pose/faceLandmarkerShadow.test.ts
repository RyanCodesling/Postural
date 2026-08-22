/**
 * Run with:
 *   npx tsx src/lib/pose/faceLandmarkerShadow.test.ts
 */
import {
  angleDeltaDegrees,
  faceOrientationDegrees,
  faceRollImageDegrees,
  fixedFaceRoiFromPose,
  type FaceTransformMatrix,
} from "./faceLandmarkerShadow";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function close(actual: number | null, expected: number, tolerance = 1e-9): void {
  assert(actual !== null, "expected a finite result");
  assert(
    Math.abs(actual - expected) <= tolerance,
    `expected ${expected}, got ${actual}`,
  );
}

function rotationMatrixColumnMajor(metricDegrees: number, scale = 1): FaceTransformMatrix {
  const radians = (metricDegrees * Math.PI) / 180;
  const cosine = Math.cos(radians) * scale;
  const sine = Math.sin(radians) * scale;
  return {
    rows: 4,
    columns: 4,
    data: [
      cosine, sine, 0, 0,
      -sine, cosine, 0, 0,
      0, 0, scale, 0,
      0, 0, 0, 1,
    ],
  };
}

function orientationMatrixColumnMajor(
  pitchDeg: number,
  yawDeg: number,
  metricRollDeg: number,
  scale = 1,
): FaceTransformMatrix {
  const pitch = (pitchDeg * Math.PI) / 180;
  const yaw = (yawDeg * Math.PI) / 180;
  const roll = (metricRollDeg * Math.PI) / 180;
  const sx = Math.sin(pitch);
  const cx = Math.cos(pitch);
  const sy = Math.sin(yaw);
  const cy = Math.cos(yaw);
  const sz = Math.sin(roll);
  const cz = Math.cos(roll);

  // Rz(roll) * Ry(yaw) * Rx(pitch), flattened column-major.
  const r00 = cz * cy;
  const r01 = cz * sy * sx - sz * cx;
  const r02 = cz * sy * cx + sz * sx;
  const r10 = sz * cy;
  const r11 = sz * sy * sx + cz * cx;
  const r12 = sz * sy * cx - cz * sx;
  const r20 = -sy;
  const r21 = cy * sx;
  const r22 = cy * cx;
  return {
    rows: 4,
    columns: 4,
    data: [
      r00 * scale, r10 * scale, r20 * scale, 0,
      r01 * scale, r11 * scale, r21 * scale, 0,
      r02 * scale, r12 * scale, r22 * scale, 0,
      0, 0, 0, 1,
    ],
  };
}

{
  const landmarks = Array.from({ length: 9 }, () => ({
    x: 0,
    y: 0,
    visibility: 0,
  }));
  landmarks[7] = { x: 0.55, y: 0.2, visibility: 1 };
  landmarks[8] = { x: 0.45, y: 0.2, visibility: 1 };
  const roi = fixedFaceRoiFromPose(landmarks, 1920, 1080);
  assert(roi !== null, "valid ears did not produce a crop");
  assert(roi.pixel.x1 - roi.pixel.x0 === 594, "unexpected capped crop width");
  assert(roi.pixel.y1 - roi.pixel.y0 === 594, "crop is not square in pixels");
  assert(roi.pixel.y0 === 0, "top-edge crop was not clamped");
  close(roi.left, roi.pixel.x0 / 1920);
  close(roi.bottom, roi.pixel.y1 / 1080);
}

{
  const landmarks = Array.from({ length: 9 }, () => ({
    x: 0,
    y: 0,
    visibility: 0,
  }));
  landmarks[7] = { x: 0.55, y: 0.2, visibility: 0.49 };
  landmarks[8] = { x: 0.45, y: 0.2, visibility: 1 };
  assert(
    fixedFaceRoiFromPose(landmarks, 1920, 1080) === null,
    "low-visibility ear was accepted",
  );
}

close(faceRollImageDegrees(rotationMatrixColumnMajor(27)), -27);
close(faceRollImageDegrees(rotationMatrixColumnMajor(-18, 2.5)), 18);
{
  const orientation = faceOrientationDegrees(
    orientationMatrixColumnMajor(12, -23, 17, 2.5),
  );
  assert(orientation !== null, "combined rotation was rejected");
  close(orientation.rollImageDeg, -17);
  close(orientation.yawDeg, -23);
  close(orientation.pitchDeg, 12);
}
{
  const base = orientationMatrixColumnMajor(-9, 14, -21);
  const data = [...base.data];
  for (const index of [0, 1, 2]) data[index] *= 1.4;
  for (const index of [4, 5, 6]) {
    data[index] = data[index] * 0.8 + data[index - 4] * 0.05;
  }
  for (const index of [8, 9, 10]) data[index] *= 1.2;
  const orientation = faceOrientationDegrees({ ...base, data });
  assert(orientation !== null, "scaled/sheared rotation was rejected");
  close(orientation.rollImageDeg, 21);
  close(orientation.yawDeg, 14);
  close(orientation.pitchDeg, -9);
}
assert(
  faceRollImageDegrees({ rows: 3, columns: 3, data: Array(16).fill(0) }) === null,
  "invalid matrix shape was accepted",
);
assert(
  faceOrientationDegrees({ rows: 4, columns: 4, data: Array(16).fill(0) }) === null,
  "degenerate orientation matrix was accepted",
);
close(angleDeltaDegrees(-179, 179), 2);
close(angleDeltaDegrees(179, -179), -2);

console.log("faceLandmarkerShadow tests passed");
