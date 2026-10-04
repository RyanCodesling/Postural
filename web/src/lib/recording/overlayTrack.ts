/**
 * The coaching overlay saved beside a session video: for each processed camera
 * frame, the pose landmarks and the cue drawn on it, so playback can redraw
 * what the patient saw with the live drawing code. Stored as JSON lines, one
 * frame per line, and only for recordings the patient consented to.
 */
import type { CompensationMetricSpec, MetricName } from "@/lib/exercises/registry";
import { drawCompensationOverlay } from "@/lib/pose/drawCompensationOverlay";
import { formatVideoTime } from "./timeline";

export type OverlayFrame = {
  /** Milliseconds from the start of the recording part. */
  t: number;
  /** x, y of each pose landmark, normalized to the frame (3 decimals). */
  lm: number[];
  /**
   * The compensation cue drawn on this frame, if any. `shoulder` is the
   * shoulder landmark (11 or 12) a LOWER arrow was locked to live; tracks saved
   * before it existed lack it, and playback then picks the higher shoulder each
   * frame, as the live drawing did when they were saved.
   */
  cue?: { metric: MetricName; direction: string | null; shoulder?: 11 | 12 };
};

// MediaPipe Pose's 33-landmark skeleton, as the live camera draws it.
export const POSE_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 7], [0, 4], [4, 5], [5, 6], [6, 8], [9, 10],
  [11, 12], [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [17, 19],
  [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20],
  [11, 23], [12, 24], [23, 24], [23, 25], [24, 26], [25, 27], [26, 28],
  [27, 29], [28, 30], [29, 31], [30, 32], [27, 31], [28, 32],
];

export function encodeLandmarks(landmarks: ReadonlyArray<{ x: number; y: number }>): number[] {
  const out: number[] = [];
  for (const lm of landmarks) out.push(Math.round(lm.x * 1000) / 1000, Math.round(lm.y * 1000) / 1000);
  return out;
}

export function parseOverlayTrack(text: string): OverlayFrame[] {
  const frames: OverlayFrame[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const frame = JSON.parse(line) as OverlayFrame;
      if (Number.isFinite(frame.t) && Array.isArray(frame.lm)) frames.push(frame);
    } catch {
      // A damaged line (for example a cut-off final write) is skipped.
    }
  }
  return frames.sort((a, b) => a.t - b.t);
}

/**
 * The latest frame at or before `ms`. Older than `maxAgeMs` means tracking had
 * stopped (no person, camera covered), so nothing is drawn, as live.
 */
export function overlayFrameAt(frames: readonly OverlayFrame[], ms: number, maxAgeMs = 400): OverlayFrame | null {
  let lo = 0;
  let hi = frames.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t <= ms) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (found < 0 || ms - frames[found].t > maxAgeMs) return null;
  return frames[found];
}

/**
 * Draws one recorded frame on an unmirrored canvas the size of the video: the
 * skeleton in the live colours, then its cue through the live overlay code.
 */
export function drawOverlayFrame(ctx: CanvasRenderingContext2D, frame: OverlayFrame, width: number, height: number) {
  const landmarks: Array<{ x: number; y: number; z: number; visibility: number }> = [];
  for (let i = 0; i + 1 < frame.lm.length; i += 2) landmarks.push({ x: frame.lm[i], y: frame.lm[i + 1], z: 0, visibility: 1 });
  ctx.save();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#00FF00";
  ctx.beginPath();
  for (const [a, b] of POSE_CONNECTIONS) {
    const p = landmarks[a];
    const q = landmarks[b];
    if (!p || !q) continue;
    ctx.moveTo(p.x * width, p.y * height);
    ctx.lineTo(q.x * width, q.y * height);
  }
  ctx.stroke();
  ctx.fillStyle = "#FF0000";
  for (const p of landmarks) {
    ctx.beginPath();
    ctx.arc(p.x * width, p.y * height, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  if (frame.cue) {
    const { metric, direction, shoulder } = frame.cue;
    // The recorded cue was on screen, so it is drawn as active; only its name,
    // direction and locked shoulder matter to the drawing.
    drawCompensationOverlay(
      ctx, landmarks, width, height,
      [{ name: metric } as CompensationMetricSpec],
      { [metric]: 0 },
      direction ? { [metric]: direction } : {},
      new Set([metric]),
      { mirroredDisplay: false, shoulderElevatedIndex: shoulder === 11 || shoulder === 12 ? shoulder : undefined },
    );
  }
}

/**
 * A label at the top centre: for videos without a saved track, the cue's label
 * from the coaching record (yellow, like a cue); or a note about the overlay
 * itself (grey).
 */
export function drawCueLabel(ctx: CanvasRenderingContext2D, text: string, width: number, tone: "cue" | "note" = "cue") {
  const size = Math.max(18, Math.round(width / 40));
  ctx.save();
  ctx.font = `bold ${size}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const pillW = ctx.measureText(text).width + size;
  const pillH = size * 1.6;
  ctx.fillStyle = tone === "cue" ? "rgba(250, 204, 21, 0.95)" : "rgba(31, 41, 55, 0.85)";
  ctx.fillRect(width / 2 - pillW / 2, size, pillW, pillH);
  ctx.fillStyle = tone === "cue" ? "#111111" : "#FFFFFF";
  ctx.fillText(text, width / 2, size + pillH / 2);
  ctx.restore();
}

export type OverlayCoverage = "complete" | "partial" | "none";

/** Drawn on the video where a partly saved track has no data. */
export const OVERLAY_NOT_SAVED_LABEL = "Overlay not saved from this point";

/**
 * What the player shows for a part's overlays: the saved track, or for a part
 * without one the cue labels from the coaching record; where a partly saved
 * track stops; and the note under the video. A stretch the track does not
 * cover is labelled on the video, unlike a tracking gap, which stays blank as
 * it did live.
 */
export function overlayPlayback(part: { hasOverlay?: boolean; overlay?: OverlayCoverage; overlayThroughMs?: number | null }): {
  source: "track" | "labels";
  savedThroughMs: number | null;
  note: string;
} {
  const coverage = part.overlay ?? (part.hasOverlay ? "partial" : "none");
  if (!part.hasOverlay) {
    return {
      source: "labels",
      savedThroughMs: null,
      note: coverage === "partial"
        ? "The coaching overlays of this video could not be saved, so only the cue labels from the coaching record are shown."
        : "No coaching overlays were saved with this video, so only the cue labels from the coaching record are shown.",
    };
  }
  if (coverage === "complete") {
    return {
      source: "track",
      savedThroughMs: null,
      note: "Overlays are redrawn from the pose and cues saved with this video, as they appeared on screen.",
    };
  }
  const savedThroughMs = typeof part.overlayThroughMs === "number" ? part.overlayThroughMs : null;
  return {
    source: "track",
    savedThroughMs,
    note: savedThroughMs !== null
      ? `Overlays were saved only up to ${formatVideoTime(savedThroughMs)}, so none are drawn after that.`
      : "Overlays are redrawn from the pose and cues saved with this video, but parts of the track may be missing.",
  };
}
