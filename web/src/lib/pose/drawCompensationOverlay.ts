import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { CompensationMetricSpec, MetricName } from "@/lib/exercises/registry";

/**
 * Landmark indices (MediaPipe, 33-point model) used to compute the
 * bounding box for each compensation metric.
 */
const METRIC_LANDMARKS: Partial<Record<MetricName, number[]>> = {
  neckTilt:          [7, 8, 11, 12], // ears + shoulders
  shoulderSymmetry:  [11, 12],       // shoulder line
  trunkLean:         [11, 12, 23, 24], // shoulders + hips
  scapularElevation: [7, 11, 8, 12], // ear-to-shoulder both sides
  elbowFlexion:      [13, 14],       // elbow joints only (most focused)
};

/**
 * Static display labels for each compensation metric. `shoulderSymmetry`,
 * `trunkLean` and `neckTilt` get an actionable correction label drawn by the
 * directional path instead of these; the values here are the fallbacks used
 * when the generic single-box path runs (no direction available).
 */
const METRIC_LABEL: Partial<Record<MetricName, string>> = {
  neckTilt:          "Neck tilted",
  shoulderSymmetry:  "Asymmetric shoulders",
  trunkLean:         "Trunk lean",
  scapularElevation: "Shoulder elevated",
  elbowFlexion:      "Straighten arms",
};

function isWarning(spec: CompensationMetricSpec, value: number): boolean {
  const dir = spec.compareDirection ?? "above";
  return dir === "above"
    ? Math.abs(value) >= spec.warningThreshold
    : value < spec.warningThreshold;
}

const BOX_PAD    = 12; // px padding around the landmark bounding box
const BOX_RADIUS = 10; // px corner radius of the outline box
const FONT_SIZE  = 22; // px — fixed; canvas is typically ~640 px wide

const SHOULDER_BOX_HALF = 26; // px half-extent of each single-shoulder box
const ARROW_LEN   = 42; // px length of a trunk/neck correction arrow
const ARROW_HEAD  = 13; // px size of the arrowhead
const ARROW_WIDTH = 6;  // px shaft width

// Bigger arrow for the elevated-shoulder "LOWER" cue.
const SHOULDER_ARROW_LEN   = 74; // px length
const SHOULDER_ARROW_HEAD  = 24; // px arrowhead
const SHOULDER_ARROW_WIDTH = 11; // px shaft width

// Warning colour for the compensation overlay (boxes, arrows, label pill).
const WARN = "rgba(250, 204, 21, 0.95)"; // yellow
const WARN_TEXT = "#111111";             // label text on the yellow pill

/**
 * Raw-image-x sign (+1 toward larger x / image-right, −1 toward image-left)
 * that points toward the patient's anatomical `side`.
 *
 * Front-camera mirroring: MediaPipe's landmark 11 ("left shoulder") sits on the
 * patient's anatomical RIGHT shoulder, and landmark 12 on their LEFT. So the
 * raw-x of the patient's right side is `landmarks[11].x` and their left side is
 * `landmarks[12].x`. Because correction arrows are drawn in RAW canvas space
 * (then flipped together with the body by the wrapper's CSS `scaleX(-1)`), a
 * direction expressed in raw-x stays visually correct after the mirror.
 *
 * Pure + exported for unit testing.
 */
export function anatomicalSideScreenDirX(
  side: "left" | "right",
  landmarks: { x: number }[],
): -1 | 1 {
  const patientRightX = landmarks[11]?.x ?? 0;
  const patientLeftX  = landmarks[12]?.x ?? 0;
  const targetX = side === "right" ? patientRightX : patientLeftX;
  const otherX  = side === "right" ? patientLeftX  : patientRightX;
  return targetX >= otherX ? 1 : -1;
}

/**
 * MediaPipe landmark index (11 or 12) of the elevated shoulder — the one that
 * is HIGHER on screen, i.e. has the smaller y. y increases downward and is
 * unaffected by the canvas' horizontal CSS mirror, so the higher-on-screen
 * shoulder is exactly the one the patient should lower. Picking by raw y here
 * (rather than mapping the metric's anatomical `elevatedSide`) keeps the cue on
 * the correct shoulder regardless of mirroring. Pure + exported for testing.
 */
export function higherShoulderLandmarkIndex(landmarks: { y: number }[]): 11 | 12 {
  const y11 = landmarks[11]?.y ?? Infinity;
  const y12 = landmarks[12]?.y ?? Infinity;
  return y11 <= y12 ? 11 : 12;
}

/** Draws a rounded rect path (stroke or fill by the caller). */
function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Strokes a rounded outline box in the given colour. */
function strokeBox(
  ctx: CanvasRenderingContext2D,
  minX: number, minY: number, maxX: number, maxY: number, color: string,
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  roundedRectPath(ctx, minX, minY, maxX - minX, maxY - minY, BOX_RADIUS);
  ctx.stroke();
  ctx.restore();
}

/**
 * Draws a shaft + filled arrowhead from (x0,y0) to (x1,y1) in RAW canvas space.
 * Drawn raw (not counter-transformed) so the arrow flips together with the body
 * under the wrapper's CSS `scaleX(-1)` and keeps pointing at the same body
 * target. A vertical arrow is unaffected by the horizontal flip; a horizontal
 * one has its raw direction chosen by the caller so it reads correctly on screen.
 */
function drawArrow(
  ctx: CanvasRenderingContext2D,
  x0: number, y0: number, x1: number, y1: number, color: string,
  width: number = ARROW_WIDTH, head: number = ARROW_HEAD,
): void {
  const ang = Math.atan2(y1 - y0, x1 - x0);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  // Shaft stops short of the tip so the head sits cleanly at the end.
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1 - Math.cos(ang) * head * 0.6, y1 - Math.sin(ang) * head * 0.6);
  ctx.stroke();
  // Arrowhead.
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - head * Math.cos(ang - Math.PI / 6), y1 - head * Math.sin(ang - Math.PI / 6));
  ctx.lineTo(x1 - head * Math.cos(ang + Math.PI / 6), y1 - head * Math.sin(ang + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * Draws the legible text pill above (or below, near the top edge) a box.
 *
 * Rendered with a canvas counter-transform so characters read correctly when
 * the canvas parent has CSS `scaleX(-1)` (front-camera selfie mode). On a rear
 * camera with no CSS flip, text appears mirrored — that edge case is not
 * corrected here as the app targets front-camera use.
 */
function drawLabelPill(
  ctx: CanvasRenderingContext2D,
  canvasW: number, centerX: number, boxMinY: number, boxMaxY: number,
  label: string, color: string,
): void {
  ctx.save();
  ctx.transform(-1, 0, 0, 1, canvasW, 0);

  ctx.font = `bold ${FONT_SIZE}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";

  const textX = canvasW - centerX;
  const labelH = FONT_SIZE + 8;
  // Place above the box; fall back to below if too close to the top edge.
  const textY = boxMinY > labelH + 4 ? boxMinY - 4 : boxMaxY + labelH + 4;

  const pillW = ctx.measureText(label).width + 14;

  ctx.fillStyle = color;
  roundedRectPath(ctx, textX - pillW / 2, textY - labelH, pillW, labelH, 6);
  ctx.fill();

  ctx.fillStyle = WARN_TEXT;
  ctx.fillText(label, textX, textY);
  ctx.restore();
}

/** Axis-aligned bounding box (in px) of the given landmark indices, or null. */
function boundingBox(
  landmarks: NormalizedLandmark[], indices: number[], canvasW: number, canvasH: number,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let found = false;
  for (const idx of indices) {
    const lm = landmarks[idx];
    if (!lm) continue;
    const px = lm.x * canvasW;
    const py = lm.y * canvasH;
    if (px < minX) minX = px;
    if (py < minY) minY = py;
    if (px > maxX) maxX = px;
    if (py > maxY) maxY = py;
    found = true;
  }
  return found ? { minX, minY, maxX, maxY } : null;
}

/**
 * Shoulder asymmetry: a yellow box around EACH shoulder keypoint (landmarks 11
 * and 12), plus a big downward arrow beside the elevated (hiked) shoulder and a
 * "LOWER" label, so the patient sees which shoulder to bring down.
 *
 * The elevated shoulder is chosen by raw y (the higher one on screen) via
 * `higherShoulderLandmarkIndex`, so the cue always lands on the shoulder the
 * patient actually sees as raised — independent of the metric's anatomical
 * labelling and the canvas CSS mirror. The down arrow is vertical (mirror-
 * immune); the boxes are anchored to raw landmark positions and flip into place
 * with the body. The arrow sits on the OUTER (lateral) side of the elevated
 * shoulder so it doesn't overlap the body.
 */
function drawShoulderAsymmetry(
  ctx: CanvasRenderingContext2D,
  landmarks: NormalizedLandmark[],
  canvasW: number, canvasH: number,
): void {
  const elevatedIdx = higherShoulderLandmarkIndex(landmarks);
  const otherIdx = elevatedIdx === 11 ? 12 : 11;
  const elevated = landmarks[elevatedIdx];
  const other = landmarks[otherIdx];
  if (!elevated || !other) return;

  const ex = elevated.x * canvasW, ey = elevated.y * canvasH;
  const ox = other.x * canvasW,    oy = other.y * canvasH;
  const h = SHOULDER_BOX_HALF;

  // A yellow box around each shoulder keypoint.
  strokeBox(ctx, ox - h, oy - h, ox + h, oy + h, WARN);
  strokeBox(ctx, ex - h, ey - h, ex + h, ey + h, WARN);

  // Big down arrow beside (lateral to) the elevated shoulder.
  const outward = ex >= ox ? 1 : -1;
  const ax = ex + outward * (h + 20);
  drawArrow(
    ctx, ax, ey - SHOULDER_ARROW_LEN / 2, ax, ey + SHOULDER_ARROW_LEN / 2,
    WARN, SHOULDER_ARROW_WIDTH, SHOULDER_ARROW_HEAD,
  );

  // "LOWER" label above the elevated shoulder box.
  drawLabelPill(ctx, canvasW, ex, ey - h, ey + h, "LOWER", WARN);
}

/**
 * Draws a yellow bounding-box outline around the problem joint area for
 * every active compensation warning, plus an actionable cue:
 *
 *  - `shoulderSymmetry`: a box per shoulder + a downward "LOWER" arrow on the
 *    elevated side (see `drawShoulderAsymmetry`).
 *  - `trunkLean` / `neckTilt`: the landmark box + a horizontal "straighten"
 *    arrow pointing the way to correct.
 *  - everything else: the box + a static text label.
 *
 * `metricDirections` carries the tilt-corrected directional qualifiers used by
 * the directional paths: `shoulderSymmetry` → elevated side (anatomical),
 * `neckTilt` → tilt side (anatomical), `trunkLean` → lean side (image-space).
 * The strings come from the caller, which has access to the full direction-rich
 * computation results not surfaced in `metricValues`.
 *
 * Call after drawConnectors/drawLandmarks so the overlay renders on top.
 */
export function drawCompensationOverlay(
  ctx: CanvasRenderingContext2D,
  landmarks: NormalizedLandmark[],
  canvasW: number,
  canvasH: number,
  compensationMetrics: readonly CompensationMetricSpec[],
  metricValues: Partial<Record<MetricName, number | null>>,
  metricDirections?: Partial<Record<MetricName, string>>,
): void {
  for (const spec of compensationMetrics) {
    const value = metricValues[spec.name];
    if (typeof value !== "number") continue;
    if (!isWarning(spec, value)) continue;

    // ── Shoulder asymmetry: per-shoulder boxes + down-arrow on the high side ──
    // The warning has already fired (isWarning above); place the cue on the
    // higher shoulder by raw y inside drawShoulderAsymmetry.
    if (spec.name === "shoulderSymmetry") {
      drawShoulderAsymmetry(ctx, landmarks, canvasW, canvasH);
      continue;
    }

    const lmIndices = METRIC_LANDMARKS[spec.name];
    if (!lmIndices) continue;

    const bb = boundingBox(landmarks, lmIndices, canvasW, canvasH);
    if (!bb) continue;

    const minX = bb.minX - BOX_PAD;
    const minY = bb.minY - BOX_PAD;
    const maxX = bb.maxX + BOX_PAD;
    const maxY = bb.maxY + BOX_PAD;
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    strokeBox(ctx, minX, minY, maxX, maxY, WARN);

    // ── Directional correction arrow for trunk lean / neck tilt ──────────────
    let label = METRIC_LABEL[spec.name] ?? spec.name;
    if (spec.name === "trunkLean") {
      const d = metricDirections?.trunkLean; // image-space: "left" | "right"
      if (d === "left" || d === "right") {
        // Lean direction is already in image space — correct toward the
        // opposite side. "right" leans toward larger raw-x, so point −x.
        const dx = d === "right" ? -1 : 1;
        drawArrow(ctx, centerX, centerY, centerX + dx * ARROW_LEN, centerY, WARN);
        label = "STRAIGHTEN";
      }
    } else if (spec.name === "neckTilt") {
      const d = metricDirections?.neckTilt; // anatomical: "left" | "right"
      if (d === "left" || d === "right") {
        const correctionSide = d === "left" ? "right" : "left";
        const dx = anatomicalSideScreenDirX(correctionSide, landmarks);
        drawArrow(ctx, centerX, centerY, centerX + dx * ARROW_LEN, centerY, WARN);
        label = "STRAIGHTEN";
      }
    }

    drawLabelPill(ctx, canvasW, centerX, minY, maxY, label, WARN);
  }
}
