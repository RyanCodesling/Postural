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
 * Static display labels for each compensation metric.
 * neckTilt gets a dynamic direction suffix appended by the caller.
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

/**
 * Draws a red bounding-box outline around the problem joint area, plus a
 * legible text badge above the box, for every active compensation warning.
 *
 * Text is rendered with a canvas counter-transform so it appears readable
 * when the canvas parent has CSS `scaleX(-1)` (front-camera selfie mode).
 * On a rear camera with no CSS flip, text will appear mirrored — that
 * edge case is not corrected here as the app targets front-camera use.
 *
 * `metricDirections` carries optional directional qualifiers for metrics
 * that have meaningful left/right labels (currently `neckTilt` only).
 * The strings come from the caller, which has access to the full
 * direction-rich computation results not surfaced in `metricValues`.
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

    const lmIndices = METRIC_LANDMARKS[spec.name];
    if (!lmIndices) continue;

    // ── Bounding box from landmark positions ──────────────────────────────
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let found = false;
    for (const idx of lmIndices) {
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
    if (!found) continue;

    minX -= BOX_PAD;
    minY -= BOX_PAD;
    maxX += BOX_PAD;
    maxY += BOX_PAD;

    const centerX = (minX + maxX) / 2;

    // ── Red outline box ───────────────────────────────────────────────────
    ctx.save();
    ctx.strokeStyle = "rgba(180, 108, 28, 0.90)";
    ctx.lineWidth = 3;
    roundedRectPath(ctx, minX, minY, maxX - minX, maxY - minY, BOX_RADIUS);
    ctx.stroke();
    ctx.restore();

    // ── Text label ────────────────────────────────────────────────────────
    let label = METRIC_LABEL[spec.name] ?? spec.name;
    if (spec.name === "neckTilt") {
      const dir = metricDirections?.[spec.name];
      if (dir && dir !== "center") label = `Neck tilted ${dir}`;
    }

    // Counter-transform so characters render correctly under CSS scaleX(-1).
    // Drawing at x = (canvasW − centerX) in flipped space places the text
    // visually centred above the box after the parent's CSS mirror.
    ctx.save();
    ctx.transform(-1, 0, 0, 1, canvasW, 0);

    ctx.font = `bold ${FONT_SIZE}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";

    const textX = canvasW - centerX;
    // Place above box; fall back to below if too close to the top edge.
    const labelH = FONT_SIZE + 8;
    const textY = minY > labelH + 4 ? minY - 4 : maxY + labelH + 4;

    const measured = ctx.measureText(label);
    const pillW = measured.width + 14;
    const pillH = labelH;

    // Amber pill background
    ctx.fillStyle = "rgba(180, 108, 28, 0.90)";
    roundedRectPath(ctx, textX - pillW / 2, textY - pillH, pillW, pillH, 6);
    ctx.fill();

    // White text
    ctx.fillStyle = "white";
    ctx.fillText(label, textX, textY);

    ctx.restore();
  }
}
