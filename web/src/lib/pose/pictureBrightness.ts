/**
 * How bright the camera picture is, for the wording of two messages. Display only.
 *
 * WHAT
 * The picture's mean luma (0-255, Rec. 601 weights on the RGB the browser decodes), from a small copy of the video
 * frame taken every `PICTURE_LUMA_SAMPLE_MS`.
 *
 * WHY THESE LINES (full-range luma; the measurements were in limited range and are converted)
 * In a darkened and noised copy of a REHAB24-6 clip, MediaPipe still found the person at a mean luma of 21.5 and found
 * nobody at 15.4 or below, whatever the noise. The researcher's own session videos read 75-105, and the evaluation
 * server's session 3, whose flicker came from a busy, bright background, 103.
 *   - `DARK_PICTURE_LUMA` 40: below it, when no person is found or the overall visibility gate fails, the message
 *     says the room is too dark instead of asking the patient to step into the frame. It sits above where tracking
 *     failed, with margin, and below every ordinary session.
 *   - `BRIGHT_PICTURE_LUMA` 70: at or above it, the unsteady-tracking message leaves out "More light", which was the
 *     wrong advice in session 3's bright room.
 * Both are engineering values from one clip and one person's sessions; a webcam's automatic exposure brightens a dim
 * room, so a dark picture is the extreme case.
 */

export const PICTURE_LUMA_SAMPLE_MS = 500;
export const DARK_PICTURE_LUMA = 40;
export const BRIGHT_PICTURE_LUMA = 70;
export const DARK_PICTURE_MESSAGE = "The room is too dark for the camera. Turn on a light or face a window.";

const SAMPLE_W = 64;
const SAMPLE_H = 36;

/** Mean luma of RGBA pixel data, or null when there is none. */
export function meanLuma(rgba: ArrayLike<number>): number | null {
  const n = Math.floor(rgba.length / 4);
  if (n === 0) return null;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += 0.299 * rgba[4 * i] + 0.587 * rgba[4 * i + 1] + 0.114 * rgba[4 * i + 2];
  return sum / n;
}

/**
 * The current video frame's mean luma, or null where it cannot be read (no document, a video without a frame, or a
 * canvas the browser refuses to read). `cache` keeps the small canvas between calls.
 */
export function samplePictureLuma(video: unknown, cache: { canvas: unknown }): number | null {
  try {
    if (typeof document === "undefined") return null;
    let canvas = cache.canvas as HTMLCanvasElement | null;
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.width = SAMPLE_W;
      canvas.height = SAMPLE_H;
      cache.canvas = canvas;
    }
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video as CanvasImageSource, 0, 0, SAMPLE_W, SAMPLE_H);
    return meanLuma(ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data);
  } catch {
    return null;
  }
}

/** The picture is dark enough that a failed detection is better explained by the light than by the framing. */
export function pictureIsDark(luma: number | null): boolean {
  return typeof luma === "number" && luma < DARK_PICTURE_LUMA;
}

/** The picture is already bright, so "More light" is not worth suggesting. Unknown brightness is not bright. */
export function pictureIsBright(luma: number | null): boolean {
  return typeof luma === "number" && luma >= BRIGHT_PICTURE_LUMA;
}

/**
 * The capture message to show: the dark-picture message when no person was found, or the overall visibility gate
 * failed, in a dark picture; otherwise the readiness check's own message.
 */
export function captureMessageForPicture(status: string, message: string, luma: number | null): string {
  return (status === "NOT_VISIBLE" || status === "LOW_CONFIDENCE") && pictureIsDark(luma) ? DARK_PICTURE_MESSAGE : message;
}
