"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { demoCueIndexAtTime, demoStatusAtTime, type DemoClip } from "@/lib/exercises/demoClips";

const buttonStyle: CSSProperties = {
  minHeight: 36, padding: "6px 10px", border: "1px solid #c7d4d8", borderRadius: 7,
  background: "#f7fafb", color: "#20383f", fontSize: 12, fontWeight: 600, cursor: "pointer",
};

/** Per-browser memory of the voice toggle; off until the viewer turns it on. */
const VOICE_KEY = "postural.demoVoice";

/** Extra time a subtitle stays up after its line's last word. */
const SUBTITLE_LINGER_SECONDS = 0.35;

/**
 * During a session the voice speaks the guide's loop this many times per set;
 * after that only the subtitles carry on. Full screen loops the voice freely.
 */
const SESSION_VOICE_LOOPS = 3;

/** The refs the voice cues share between the frame loop and the controls. */
type VoiceState = {
  clip: DemoClip;
  onCue: { current: ((text: string | null) => void) | undefined };
  /** One decoder per recorded line, created once the voice is turned on. */
  audio: { current: Map<string, HTMLAudioElement> };
  playing: { current: HTMLAudioElement | null };
  timer: { current: number };
};

function audioFor(state: VoiceState, src: string): HTMLAudioElement {
  let audio = state.audio.current.get(src);
  if (!audio) {
    audio = new Audio(src);
    audio.preload = "auto";
    state.audio.current.set(src, audio);
  }
  return audio;
}

function stopVoice(state: VoiceState): void {
  state.playing.current?.pause();
  state.playing.current = null;
  window.clearTimeout(state.timer.current);
  state.onCue.current?.(null);
}

/**
 * Show a cue's subtitle and, with `withAudio`, play its recorded line from the
 * start. The cue frames are placed so each line ends before the next begins at
 * 1×, so starting a line can only cut off the silent tail of the previous
 * file. The subtitle lasts as long as the words, spoken or not.
 */
function playCue(state: VoiceState, index: number, withAudio: boolean): void {
  const cue = state.clip.cues[index];
  if (!cue) return;
  stopVoice(state);
  if (withAudio) {
    const audio = audioFor(state, cue.audio);
    audio.currentTime = 0;
    state.playing.current = audio;
    void audio.play().catch(() => {});
  }
  state.onCue.current?.(cue.text);
  state.timer.current = window.setTimeout(() => state.onCue.current?.(null), (cue.speech + SUBTITLE_LINGER_SECONDS) * 1000);
}

/** A single decoder stays mounted through detail and full-screen changes. */
export default function DemoClipPlayer({ clip, compact, onError, onCue, voiceAllowed = true, voiceRound }: {
  clip: DemoClip; compact: boolean; onError: () => void;
  /** The line being spoken for subtitles, or null while the voice is off or paused. */
  onCue?: (text: string | null) => void;
  /**
   * Whether lines may play now. The camera page allows them only once a
   * session is running and its baseline is captured; the toggle still sets
   * the viewer's preference meanwhile.
   */
  voiceAllowed?: boolean;
  /**
   * Set by the camera page; each new value (a new set or session) lets the
   * voice speak again for SESSION_VOICE_LOOPS loops. Without it the voice is
   * not limited.
   */
  voiceRound?: string;
}) {
  /** The line on screen in full screen, where the page's subtitle is covered. */
  const [subtitle, setSubtitle] = useState<string | null>(null);
  const onCueRef = useRef<((text: string | null) => void) | undefined>(undefined);
  useEffect(() => {
    onCueRef.current = text => { setSubtitle(text); onCue?.(text); };
  }, [onCue]);
  const allowedRef = useRef(voiceAllowed);
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const openRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const [detail, setDetail] = useState(false);
  const [fullScreen, setFullScreen] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<number>(clip.defaultSpeed ?? 1);
  const [status, setStatus] = useState(() => demoStatusAtTime(clip, 0));
  const [voice, setVoice] = useState(false);
  const voiceRef = useRef(false);
  /** Cue whose window the video is in; -1 means "take the next one silently". */
  const cueRef = useRef(-1);
  const audioRef = useRef(new Map<string, HTMLAudioElement>());
  const playingRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef(0);
  const crop = detail ? clip.detail.crop : clip.crop;
  const ratio = crop.w / crop.h;
  const voiceState = (): VoiceState => ({ clip, onCue: onCueRef, audio: audioRef, playing: playingRef, timer: timerRef });

  useEffect(() => {
    const state: VoiceState = { clip, onCue: onCueRef, audio: audioRef, playing: playingRef, timer: timerRef };
    let saved = false;
    try { saved = window.localStorage.getItem(VOICE_KEY) === "on"; } catch { /* storage blocked: stay off */ }
    voiceRef.current = saved;
    setVoice(saved);
    if (saved) for (const cue of clip.cues) audioFor(state, cue.audio);
    return () => stopVoice(state);
  }, [clip]);

  // Full screen is a deliberate look at the guide, so its voice and subtitles
  // play whenever the voice is on, whatever the session is doing.
  const allowed = voiceAllowed || fullScreen;
  /** Lines spoken aloud this round outside full screen. */
  const spokenRef = useRef(0);
  const limitedRef = useRef(voiceRound !== undefined);
  const fullScreenRef = useRef(fullScreen);
  useEffect(() => { fullScreenRef.current = fullScreen; }, [fullScreen]);
  useEffect(() => {
    spokenRef.current = 0;
    limitedRef.current = voiceRound !== undefined;
  }, [voiceRound]);
  useEffect(() => {
    allowedRef.current = allowed;
    // Silence a line in progress when the gate closes; when it opens, start at
    // the next cue rather than joining one midway.
    if (!allowed) stopVoice({ clip, onCue: onCueRef, audio: audioRef, playing: playingRef, timer: timerRef });
    else cueRef.current = -1;
  }, [allowed, clip]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const state: VoiceState = { clip, onCue: onCueRef, audio: audioRef, playing: playingRef, timer: timerRef };
    let callback = 0;
    let stopped = false;
    const update = (seconds: number) => {
      const next = demoStatusAtTime(clip, seconds);
      setStatus(old => old.phase === next.phase && old.view === next.view ? old : next);
      const cue = demoCueIndexAtTime(clip, seconds);
      if (cue !== cueRef.current) {
        // A line only plays from its own start frame, never joined midway.
        const joined = cueRef.current === -1;
        cueRef.current = cue;
        if (!joined && voiceRef.current && allowedRef.current && !video.paused) {
          const free = fullScreenRef.current || !limitedRef.current;
          const withAudio = free || spokenRef.current < clip.cues.length * SESSION_VOICE_LOOPS;
          if (!free && withAudio) spokenRef.current += 1;
          playCue(state, cue, withAudio);
        }
      }
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
  const toggleVoice = () => {
    const next = !voice;
    voiceRef.current = next;
    setVoice(next);
    try { window.localStorage.setItem(VOICE_KEY, next ? "on" : "off"); } catch { /* not remembered */ }
    const state = voiceState();
    stopVoice(state);
    // Load every line now, while this click allows audio, so the first cue
    // starts on its frame. Speaking begins at the next cue.
    if (next) for (const cue of clip.cues) audioFor(state, cue.audio).load();
  };
  const onPause = () => {
    setPlaying(false);
    stopVoice(voiceState());
    // On resume, wait for the next cue rather than joining a line midway.
    cueRef.current = -1;
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
            onError={onError} onPlay={() => setPlaying(true)} onPause={onPause}
            onLoadedMetadata={() => {
              // Loading media resets the rate, so apply the chosen speed here.
              const video = videoRef.current;
              if (video) { video.defaultPlaybackRate = speed; video.playbackRate = speed; }
            }}
            onLoadedData={() => { const video = videoRef.current; if (video) setPlaying(!video.paused); }}
            style={{ position: "absolute", left: `${-crop.x / crop.w * 100}%`, top: `${-crop.y / crop.h * 100}%`, width: `${clip.width / crop.w * 100}%`, height: `${clip.height / crop.h * 100}%`, maxWidth: "none", maxHeight: "none", objectFit: "fill" }} />
          {fullScreen && voice && subtitle && (
            <div role="status" aria-live="polite" style={{ position: "absolute", left: 12, right: 12, bottom: 16, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
              <span style={{ maxWidth: 760, padding: "10px 20px", borderRadius: 10, background: "oklch(0.12 0.005 240 / 0.82)",
                color: "#fff", fontSize: "clamp(18px, 3vw, 28px)", fontWeight: 600, lineHeight: 1.3, textAlign: "center",
                textShadow: "0 1px 2px oklch(0 0 0 / 0.6)" }}>{subtitle}</span>
            </div>
          )}
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
          if (videoRef.current) { videoRef.current.defaultPlaybackRate = next; videoRef.current.playbackRate = next; }
        }}><option value={1}>1× speed</option><option value={0.5}>0.5× speed</option></select>
        <button type="button" onClick={toggleVoice} aria-pressed={voice}
          aria-label="Spoken instructions"
          style={{ ...buttonStyle, background: voice ? "#ddf0e8" : "#f7fafb" }}>{voice ? "Voice on" : "Voice off"}</button>
        {!fullScreen && <button ref={openRef} type="button" onClick={enterFullScreen} style={buttonStyle} aria-label="View the demonstration full screen">Full screen</button>}
      </div>
      <div style={{ fontSize: 12, lineHeight: 1.4, opacity: .75, flexShrink: 0 }}>
        {detail && <span>Detail view. Use Full body to see the whole movement.<br /></span>}
        Animated guide with illustrative timing. Your therapist&apos;s instructions come first.
      </div>
    </div>
  );
}
