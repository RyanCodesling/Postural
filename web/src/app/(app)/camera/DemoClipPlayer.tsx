"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { demoStatusAtTime, type DemoClip } from "@/lib/exercises/demoClips";

const buttonStyle: CSSProperties = {
  minHeight: 36, padding: "6px 10px", border: "1px solid #c7d4d8", borderRadius: 7,
  background: "#f7fafb", color: "#20383f", fontSize: 12, fontWeight: 600, cursor: "pointer",
};

/** A single decoder stays mounted through detail and full-screen changes. */
export default function DemoClipPlayer({ clip, compact, onError }: {
  clip: DemoClip; compact: boolean; onError: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const openRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const [detail, setDetail] = useState(false);
  const [fullScreen, setFullScreen] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [status, setStatus] = useState(() => demoStatusAtTime(clip, 0));
  const crop = detail ? clip.detail.crop : clip.crop;
  const ratio = crop.w / crop.h;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let callback = 0;
    let stopped = false;
    const update = (seconds: number) => {
      const next = demoStatusAtTime(clip, seconds);
      setStatus(old => old.phase === next.phase && old.view === next.view ? old : next);
    };
    const onTime = () => { if (!video.seeking) update(video.currentTime); };
    const frame = () => {
      if (stopped) return;
      if (typeof video.requestVideoFrameCallback === "function") {
        callback = video.requestVideoFrameCallback((_now, metadata) => {
          update(metadata.mediaTime);
          frame();
        });
      } else {
        callback = requestAnimationFrame(() => { onTime(); frame(); });
      }
    };
    video.addEventListener("seeked", onTime);
    video.addEventListener("timeupdate", onTime);
    frame();
    return () => {
      stopped = true;
      video.removeEventListener("seeked", onTime);
      video.removeEventListener("timeupdate", onTime);
      if (typeof video.cancelVideoFrameCallback === "function") video.cancelVideoFrameCallback(callback);
      else cancelAnimationFrame(callback);
    };
  }, [clip]);

  useEffect(() => {
    if (!fullScreen) {
      if (openerRef.current) {
        // The entry button is remounted when leaving full screen. Restore
        // focus after React has attached its current node.
        (openerRef.current.isConnected ? openerRef.current : openRef.current)?.focus();
        openerRef.current = null;
      }
      return;
    }
    const container = containerRef.current;
    closeRef.current?.focus();
    const close = () => setFullScreen(false);
    const change = () => { if (!document.fullscreenElement) close(); };
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close(); }
      if (event.key === "Tab" && container) {
        const controls = Array.from(container.querySelectorAll<HTMLElement>("button, select"));
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("fullscreenchange", change);
    document.addEventListener("keydown", keys);
    return () => {
      document.removeEventListener("fullscreenchange", change);
      document.removeEventListener("keydown", keys);
      if (document.fullscreenElement === container) void document.exitFullscreen().catch(() => {});
    };
  }, [fullScreen]);

  const enterFullScreen = () => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setFullScreen(true);
    const container = containerRef.current;
    if (container?.requestFullscreen && !document.fullscreenElement) void container.requestFullscreen().catch(() => {});
  };
  const togglePlaying = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => setPlaying(false));
    else video.pause();
  };

  return (
    <div ref={containerRef} role={fullScreen ? "dialog" : undefined}
      aria-modal={fullScreen || undefined} aria-label={fullScreen ? "Demonstration, full screen" : undefined}
      style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 0,
        ...(fullScreen ? { position: "fixed", inset: 0, zIndex: 70, padding: 18, background: "#19252d", color: "#fff", overflowY: "auto" } : {}) }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexShrink: 0 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, fontSize: 12 }}>
          <span data-demo-phase style={{ padding: "4px 9px", borderRadius: 6, background: "#ddf0e8", color: "#174e40", fontWeight: 700 }}>{status.phase}</span>
          <span data-demo-view style={{ opacity: .8 }}>{status.view}</span>
        </div>
        {fullScreen && <button ref={closeRef} type="button" onClick={() => setFullScreen(false)} style={buttonStyle} aria-label="Close full screen">Close</button>}
      </div>
      <div style={{ width: "100%", minHeight: 160, containerType: "size", display: "flex", alignItems: "center", justifyContent: "center",
        ...(fullScreen ? { flex: 1 } : { aspectRatio: `${clip.crop.w} / ${clip.crop.h}`, maxHeight: compact ? 460 : undefined, flex: "0 1 auto" }) }}>
        <div style={{ position: "relative", width: `min(100cqw, calc(100cqh * ${ratio}))`, height: `min(100cqh, calc(100cqw / ${ratio}))`, borderRadius: 10, overflow: "hidden", background: "#252e36" }}>
          <video ref={videoRef} src={clip.src} autoPlay loop muted playsInline preload="metadata"
            aria-label={`Animated guide showing ${clip.subject}${detail ? `, ${clip.detail.label.toLowerCase()} detail` : ""}`}
            onError={onError} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
            onLoadedData={() => { const video = videoRef.current; if (video) setPlaying(!video.paused); }}
            style={{ position: "absolute", left: `${-crop.x / crop.w * 100}%`, top: `${-crop.y / crop.h * 100}%`, width: `${clip.width / crop.w * 100}%`, height: `${clip.height / crop.h * 100}%`, maxWidth: "none", maxHeight: "none", objectFit: "fill" }} />
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", flexShrink: 0 }}>
        <div role="group" aria-label="Demonstration framing" style={{ display: "flex", gap: 4 }}>
          <button type="button" aria-pressed={!detail} onClick={() => setDetail(false)} style={{ ...buttonStyle, background: !detail ? "#ddf0e8" : "#f7fafb" }}>Full body</button>
          <button type="button" aria-pressed={detail} onClick={() => setDetail(true)} style={{ ...buttonStyle, background: detail ? "#ddf0e8" : "#f7fafb" }}>{clip.detail.label}</button>
        </div>
        <button type="button" onClick={togglePlaying} style={buttonStyle} aria-label={playing ? "Pause demonstration" : "Play demonstration"}>{playing ? "Pause" : "Play"}</button>
        <select aria-label="Demonstration playback speed" value={speed} style={buttonStyle} onChange={event => {
          const next = Number(event.target.value);
          setSpeed(next);
          if (videoRef.current) videoRef.current.playbackRate = next;
        }}><option value={1}>1× speed</option><option value={0.5}>0.5× speed</option></select>
        {!fullScreen && <button ref={openRef} type="button" onClick={enterFullScreen} style={buttonStyle} aria-label="View the demonstration full screen">Full screen</button>}
      </div>
      <div style={{ fontSize: 12, lineHeight: 1.4, opacity: .75, flexShrink: 0 }}>
        {detail && <span>Detail view. Use Full body to see the whole movement.<br /></span>}
        Animated guide with illustrative timing. Your therapist&apos;s instructions come first.
      </div>
    </div>
  );
}
