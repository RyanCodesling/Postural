"use client";

// Optional session video: shown only to the patient who recorded it and their
// assigned therapist (the API enforces that). The timeline marks sets and
// repetitions from their stored timestamps, and paints yellow wherever the
// coaching record says a cue was on screen.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import {
  buildVideoTimeline,
  formatVideoTime,
  type TimelineSource,
  type VideoTimeline,
} from "@/lib/recording/timeline";
import {
  drawCueLabel,
  drawOverlayFrame,
  OVERLAY_NOT_SAVED_LABEL,
  overlayFrameAt,
  overlayPlayback,
  parseOverlayTrack,
  type OverlayCoverage,
  type OverlayFrame,
} from "@/lib/recording/overlayTrack";

export type VideoPart = {
  index: number;
  mimeType: string;
  startWallMs: number;
  endWallMs: number | null;
  bytes: number;
  status: "recording" | "complete" | "incomplete";
  /** A coaching overlay track was saved with this part. */
  hasOverlay?: boolean;
  /** Whether the whole track was saved; "none" when the part has no track. */
  overlay?: OverlayCoverage;
  /** How far into the part the saved track reaches, when known. */
  overlayThroughMs?: number | null;
};

/** Loads a session's video and timeline data; renders nothing when the session has no video. */
export default function SessionVideo({ sessionId, onDeleted }: { sessionId: number; onDeleted?: () => void }) {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "none" }
    | { kind: "error" }
    | { kind: "deleted" }
    | { kind: "ready"; parts: VideoPart[]; canDelete: boolean; source: TimelineSource }
  >({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const listing = await fetch(`/api/sessions/${sessionId}/recording`, { cache: "no-store" });
        if (!listing.ok) throw new Error(`recording list returned ${listing.status}`);
        const { parts, canDelete } = (await listing.json()) as { parts: VideoPart[]; canDelete: boolean };
        if (!parts.length) {
          if (!cancelled) setState({ kind: "none" });
          return;
        }
        const detail = await fetch(`/api/sessions/${sessionId}`, { cache: "no-store" });
        if (!detail.ok) throw new Error(`session detail returned ${detail.status}`);
        const { session } = (await detail.json()) as { session: TimelineSource };
        if (!cancelled) setState({ kind: "ready", parts, canDelete, source: session });
      } catch (error) {
        console.error("Session video failed to load:", error);
        if (!cancelled) setState({ kind: "error" });
      }
    })();
    return () => { cancelled = true; };
  }, [sessionId]);

  if (state.kind === "none" || state.kind === "loading") return null;
  if (state.kind === "error") {
    return <p className="text-xs text-red-600">The session video could not be loaded.</p>;
  }
  if (state.kind === "deleted") {
    return <p className="text-xs text-gray-500">The session video was deleted.</p>;
  }
  return (
    <SessionVideoPlayer
      parts={state.parts}
      source={state.source}
      partUrl={(part) => `/api/sessions/${sessionId}/recording/${part.index}`}
      overlayUrl={(part) => `/api/sessions/${sessionId}/recording/${part.index}?track=overlay`}
      onDelete={state.canDelete ? async () => {
        const response = await fetch(`/api/sessions/${sessionId}/recording`, { method: "DELETE" });
        if (!response.ok) throw new Error(`delete returned ${response.status}`);
        setState({ kind: "deleted" });
        onDeleted?.();
      } : undefined}
    />
  );
}

export function SessionVideoPlayer({
  parts,
  source,
  partUrl,
  overlayUrl,
  onDelete,
}: {
  parts: VideoPart[];
  source: TimelineSource;
  partUrl: (part: VideoPart) => string;
  overlayUrl?: (part: VideoPart) => string;
  onDelete?: () => Promise<void>;
}) {
  const [partIndex, setPartIndex] = useState(0);
  const part = parts[Math.min(partIndex, parts.length - 1)];
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [currentMs, setCurrentMs] = useState(0);
  const [mediaDurationMs, setMediaDurationMs] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [showOverlay, setShowOverlay] = useState(false);
  const [overlays, setOverlays] = useState<Record<number, OverlayFrame[] | "loading" | "error">>({});
  const overlayState = overlays[part.index];
  const frames = Array.isArray(overlayState) ? overlayState : null;
  const playback = overlayPlayback(part);
  // Full screen shows the video and its overlay canvas together; the video's
  // own full-screen button is hidden because it would leave the overlay behind.
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => setFullscreen(!!frameRef.current && document.fullscreenElement === frameRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    } else {
      void frameRef.current?.requestFullscreen?.().catch((error) => console.error("Full screen failed:", error));
    }
  };

  const loadOverlay = (p: VideoPart) => {
    if (!p.hasOverlay || !overlayUrl || overlays[p.index] !== undefined) return;
    setOverlays((all) => ({ ...all, [p.index]: "loading" }));
    fetch(overlayUrl(p), { cache: "no-store" })
      .then((response) => (response.ok ? response.text() : Promise.reject(new Error(`overlay returned ${response.status}`))))
      .then((text) => setOverlays((all) => ({ ...all, [p.index]: parseOverlayTrack(text) })))
      .catch((error) => {
        console.error("Coaching overlay failed to load:", error);
        setOverlays((all) => ({ ...all, [p.index]: "error" }));
      });
  };

  const setOverlayShown = (on: boolean) => {
    setShowOverlay(on);
    if (on) loadOverlay(part);
  };

  // The part's own start and end are the timeline's scale; a recorder that
  // stopped without closing its part falls back to the file's duration.
  const durationMs = part.endWallMs !== null ? part.endWallMs - part.startWallMs : mediaDurationMs ?? 0;
  const timeline = useMemo(() => buildVideoTimeline(part, durationMs, source), [part, durationMs, source]);

  const seek = (ms: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, ms) / 1000;
    setCurrentMs(Math.max(0, ms));
  };

  // While shown, the overlay follows the video frame by frame: the recorded
  // pose and cue for the moment on screen, or for videos without a track,
  // the cue label from the coaching record. Past the end of a partly saved
  // track, a note says so, so lost data is not mistaken for no cue.
  const { source: overlaySource, savedThroughMs } = playback;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!showOverlay || !canvas) return;
    let raf = 0;
    const draw = () => {
      const video = videoRef.current;
      const ctx = canvas.getContext("2d");
      if (video && ctx) {
        const width = video.videoWidth || 1280;
        const height = video.videoHeight || 720;
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        ctx.clearRect(0, 0, width, height);
        const ms = video.currentTime * 1000;
        if (overlaySource === "track") {
          if (savedThroughMs !== null && ms > savedThroughMs) {
            drawCueLabel(ctx, OVERLAY_NOT_SAVED_LABEL, width, "note");
          } else if (frames) {
            const frame = overlayFrameAt(frames, ms);
            if (frame) drawOverlayFrame(ctx, frame, width, height);
          }
        } else {
          const cue = timeline.cues.find((c) => ms >= c.startMs && ms <= Math.max(c.endMs, c.startMs + 500));
          if (cue) drawCueLabel(ctx, `${cue.label}: "${cue.text}"`, width);
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [showOverlay, frames, overlaySource, savedThroughMs, timeline]);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-gray-800">Session video</p>
        <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
          <input type="checkbox" checked={showOverlay} onChange={(event) => setOverlayShown(event.target.checked)} />
          Show coaching overlays
        </label>
        <button
          type="button"
          onClick={toggleFullscreen}
          className="px-2 py-1 text-xs rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
        >
          Full screen
        </button>
        {parts.length > 1 && (
          <div className="flex flex-wrap gap-1">
            {parts.map((p, i) => (
              <button
                key={p.index}
                type="button"
                onClick={() => {
                  setPartIndex(i);
                  setCurrentMs(0);
                  setMediaDurationMs(null);
                  if (showOverlay) loadOverlay(p);
                }}
                className={`px-2 py-1 text-xs rounded border ${i === partIndex ? "border-green-700 bg-green-50 text-green-800" : "border-gray-200 text-gray-600"}`}
              >
                Part {p.index}
              </button>
            ))}
          </div>
        )}
      </div>
      <div ref={frameRef} className={fullscreen ? "relative bg-black" : "relative"}>
      <video
        key={part.index}
        ref={videoRef}
        src={partUrl(part)}
        controls
        controlsList="nofullscreen"
        disablePictureInPicture
        preload="metadata"
        playsInline
        className={`block w-full bg-black object-contain ${fullscreen ? "h-full" : "rounded"}`}
        onLoadedMetadata={(event) => {
          // Browser recordings often carry no duration; seeking far ahead makes
          // the browser find it, after which the native scrubber works.
          const video = event.currentTarget;
          if (Number.isFinite(video.duration)) {
            setMediaDurationMs(video.duration * 1000);
            return;
          }
          const settle = () => {
            if (!Number.isFinite(video.duration)) return;
            video.removeEventListener("durationchange", settle);
            setMediaDurationMs(video.duration * 1000);
            video.currentTime = 0;
          };
          video.addEventListener("durationchange", settle);
          video.currentTime = 1e101;
        }}
        onTimeUpdate={(event) => setCurrentMs(event.currentTarget.currentTime * 1000)}
      />
      {/* Sized like the video and letterboxed the same way, so the drawing stays aligned in full screen. */}
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className={`absolute inset-0 w-full h-full object-contain pointer-events-none ${fullscreen ? "" : "rounded"}`}
        style={{ display: showOverlay ? "block" : "none" }}
      />
      {fullscreen && (
        <div className="absolute right-3 top-3 flex items-center gap-2">
          <label className="flex items-center gap-2 rounded bg-black/60 px-3 py-1.5 text-sm text-white cursor-pointer">
            <input type="checkbox" checked={showOverlay} onChange={(event) => setOverlayShown(event.target.checked)} />
            Coaching overlays
          </label>
          <button
            type="button"
            onClick={toggleFullscreen}
            className="rounded bg-black/60 px-3 py-1.5 text-sm text-white hover:bg-black/80"
          >
            Exit full screen
          </button>
        </div>
      )}
      </div>
      {showOverlay && (
        <p className="text-xs text-gray-500">
          {overlayState === "loading"
            ? "Loading the coaching overlays…"
            : overlayState === "error"
              ? "The coaching overlays could not be loaded."
              : playback.note}
        </p>
      )}
      {durationMs > 0 && <VideoTimelineBar timeline={timeline} currentMs={currentMs} onSeek={seek} />}
      <VideoChapters timeline={timeline} onSeek={seek} />
      <div className="text-xs text-gray-500 space-y-1">
        <p>
          <span className="inline-block w-3 h-2 align-middle rounded-sm bg-amber-400 mr-1" />
          A coaching cue was on screen. Taken from each set&apos;s coaching record, which covers
          the observed part of the set only, so rest and unobserved stretches have no marks.
        </p>
        {timeline.cappedSets.length > 0 && (
          <p>
            The coaching record of set {timeline.cappedSets.join(", ")} reached its limit, so its
            earliest cues are not marked.
          </p>
        )}
        {part.status !== "complete" && (
          <p>Part of this recording could not be saved, so it may end early.</p>
        )}
        <p>Stored on this clinic&apos;s computer. This prototype does not encrypt videos.</p>
      </div>
      {onDelete && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={deleting}
            onClick={async () => {
              if (!window.confirm("Delete this session video? This cannot be undone.")) return;
              setDeleting(true);
              setDeleteError(false);
              try {
                await onDelete();
              } catch (error) {
                console.error("Video delete failed:", error);
                setDeleteError(true);
              } finally {
                setDeleting(false);
              }
            }}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-60"
          >
            {deleting ? "Deleting…" : "Delete video"}
          </button>
          {deleteError && <span role="alert" className="text-xs text-red-600">The video could not be deleted.</span>}
        </div>
      )}
    </div>
  );
}

/** Sets as blocks, repetitions as ticks, cues in yellow; click or use the arrow keys to seek. */
export function VideoTimelineBar({
  timeline,
  currentMs,
  onSeek,
}: {
  timeline: VideoTimeline;
  currentMs: number;
  onSeek: (ms: number) => void;
}) {
  const { durationMs } = timeline;
  const pct = (ms: number) => `${Math.min(100, Math.max(0, (ms / durationMs) * 100))}%`;
  const width = (from: number, to: number) => `${Math.max(0.4, ((to - from) / durationMs) * 100)}%`;
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    onSeek(((event.clientX - box.left) / box.width) * durationMs);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowRight") onSeek(Math.min(durationMs, currentMs + 5000));
    else if (event.key === "ArrowLeft") onSeek(Math.max(0, currentMs - 5000));
    else return;
    event.preventDefault();
  };
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="Session timeline"
      aria-valuemin={0}
      aria-valuemax={Math.round(durationMs / 1000)}
      aria-valuenow={Math.round(currentMs / 1000)}
      aria-valuetext={formatVideoTime(currentMs)}
      onClick={onClick}
      onKeyDown={onKeyDown}
      className="relative h-12 rounded bg-gray-100 cursor-pointer select-none"
    >
      {timeline.sets.map((set) => (
        <div
          key={`set-${set.setIndex}`}
          className="absolute top-0 h-5 rounded-sm bg-green-100 border-l-2 border-green-600 text-[10px] font-semibold text-green-800 pl-1 overflow-hidden"
          style={{ left: pct(set.startMs), width: width(set.startMs, set.endMs) }}
          title={`Set ${set.setIndex}: ${formatVideoTime(set.startMs)}–${formatVideoTime(set.endMs)}`}
        >
          S{set.setIndex}
        </div>
      ))}
      {timeline.reps.map((rep) => (
        <div
          key={`rep-${rep.setIndex}-${rep.side}-${rep.number}`}
          className={`absolute top-6 h-3 w-0.5 ${rep.complete ? "bg-green-700" : "bg-gray-400"}`}
          style={{ left: pct(rep.startMs) }}
          title={`Set ${rep.setIndex} · ${rep.side} rep ${rep.number}${rep.complete ? "" : " (partial)"}`}
        />
      ))}
      {timeline.cues.map((cue, i) => (
        <div
          key={`cue-${i}`}
          className="absolute bottom-1 h-2.5 rounded-sm bg-amber-400"
          style={{ left: pct(cue.startMs), width: width(cue.startMs, cue.endMs) }}
          title={`${cue.label} ("${cue.text}") at ${formatVideoTime(cue.startMs)}${cue.uncredited ? ", attempt that credited no movement" : ""}`}
        />
      ))}
      <div className="absolute top-0 bottom-0 w-0.5 bg-gray-900" style={{ left: pct(currentMs) }} />
    </div>
  );
}

/** Jump points: each set, each repetition by side and number, and each cue moment. */
export function VideoChapters({ timeline, onSeek }: { timeline: VideoTimeline; onSeek: (ms: number) => void }) {
  if (timeline.sets.length === 0 && timeline.reps.length === 0 && timeline.cues.length === 0) return null;
  const setIndexes = [...new Set([...timeline.sets.map((s) => s.setIndex), ...timeline.reps.map((r) => r.setIndex)])].sort((a, b) => a - b);
  return (
    <div className="space-y-2">
      {setIndexes.map((setIndex) => {
        const set = timeline.sets.find((s) => s.setIndex === setIndex);
        const reps = timeline.reps.filter((r) => r.setIndex === setIndex);
        return (
          <div key={setIndex} className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={() => onSeek(set?.startMs ?? reps[0]?.startMs ?? 0)}
              className="px-2 py-1 text-xs font-semibold rounded bg-green-700 text-white hover:bg-green-800"
            >
              Set {setIndex}{set ? ` · ${formatVideoTime(set.startMs)}` : ""}
            </button>
            {reps.map((rep) => (
              <button
                key={`${rep.side}-${rep.number}`}
                type="button"
                onClick={() => onSeek(Math.max(0, rep.startMs - 500))}
                title={`Set ${setIndex}, ${rep.side} repetition ${rep.number} at ${formatVideoTime(rep.startMs)}${rep.complete ? "" : " (partial)"}`}
                className={`px-1.5 py-0.5 text-[11px] rounded border ${rep.complete ? "border-green-300 text-green-800" : "border-gray-300 text-gray-500"}`}
              >
                {rep.side === "left" ? "L" : rep.side === "right" ? "R" : ""}{rep.number}
              </button>
            ))}
          </div>
        );
      })}
      {timeline.cues.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-xs text-gray-500 mr-1">Cues:</span>
          {timeline.cues.slice(0, 40).map((cue, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onSeek(Math.max(0, cue.startMs - 1000))}
              className="px-1.5 py-0.5 text-[11px] rounded bg-amber-100 text-amber-900 hover:bg-amber-200"
            >
              {cue.label} · {formatVideoTime(cue.startMs)}
            </button>
          ))}
          {timeline.cues.length > 40 && <span className="text-xs text-gray-500">+{timeline.cues.length - 40} more</span>}
        </div>
      )}
    </div>
  );
}
