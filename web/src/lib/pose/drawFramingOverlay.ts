import type { Rect, ReadinessResult } from "./captureReadiness";

export function drawCutoutOverlay(
  ctx: CanvasRenderingContext2D,
  videoW: number,
  videoH: number,
  readiness: ReadinessResult
) {
  const { target, person, ok } = readiness;

  // Darken whole frame
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, 0, videoW, videoH);

  // Cut out the target window (make it transparent)
  ctx.globalCompositeOperation = "destination-out";
  roundRect(ctx, target, 18);
  ctx.fill();

  // Draw target border
  ctx.globalCompositeOperation = "source-over";
  ctx.lineWidth = 4;
  ctx.strokeStyle = ok ? "rgba(0,255,0,0.9)" : "rgba(255,200,0,0.95)";
  roundRect(ctx, target, 18);
  ctx.stroke();

  // Optional: draw person bbox
  if (person) {
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.strokeRect(person.x, person.y, person.w, person.h);
  }

  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, r: Rect, radius: number) {
  const x = r.x,
    y = r.y,
    w = r.w,
    h = r.h;
  const rr = Math.min(radius, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}