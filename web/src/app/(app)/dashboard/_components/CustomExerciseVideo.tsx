"use client";

import { useEffect, useRef, useState } from "react";
import { exerciseVideoFileUrl, youTubeCommand, youTubeEmbedUrl, type ExerciseVideo } from "@/lib/exercises/customVideo";

const YOUTUBE_ORIGIN = "https://www.youtube-nocookie.com";

/**
 * A custom exercise's uploaded video or YouTube video, in a 16:9 frame.
 * `playing` (the camera page, while a session runs) plays it on a loop; when
 * it turns off, the video stops.
 */
export default function CustomExerciseVideo({ exerciseId, exerciseName, video, playing = false }: {
  exerciseId: string;
  exerciseName: string;
  video: ExerciseVideo;
  playing?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const unmuteTimerRef = useRef<number | null>(null);
  const [origin, setOrigin] = useState<string | undefined>(undefined);
  useEffect(() => setOrigin(window.location.origin), []);

  // A YouTube video autoplays muted; once its player loads, ask it to turn the
  // sound on. The player takes commands only once ready, so they are repeated
  // for a few seconds. A browser that refuses keeps it playing muted.
  const unmuteYouTube = () => {
    if (!playing) return;
    if (unmuteTimerRef.current !== null) window.clearInterval(unmuteTimerRef.current);
    let tries = 0;
    unmuteTimerRef.current = window.setInterval(() => {
      const player = frameRef.current?.contentWindow;
      tries += 1;
      if (!player || tries > 12) {
        if (unmuteTimerRef.current !== null) window.clearInterval(unmuteTimerRef.current);
        unmuteTimerRef.current = null;
        return;
      }
      player.postMessage(JSON.stringify({ event: "listening" }), YOUTUBE_ORIGIN);
      player.postMessage(youTubeCommand("unMute"), YOUTUBE_ORIGIN);
      player.postMessage(youTubeCommand("setVolume", [100]), YOUTUBE_ORIGIN);
      player.postMessage(youTubeCommand("playVideo"), YOUTUBE_ORIGIN);
    }, 500);
  };
  useEffect(() => () => {
    if (unmuteTimerRef.current !== null) window.clearInterval(unmuteTimerRef.current);
  }, []);

  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    if (!playing) {
      element.pause();
      return;
    }
    element.loop = true;
    // With sound when the browser allows it; otherwise muted, which every
    // browser allows. The player's controls turn the sound back on.
    element.play().catch(() => {
      element.muted = true;
      void element.play().catch(() => {});
    });
  }, [playing]);

  if (failed) {
    return (
      <div className="p-1">
        <p className="text-sm font-semibold text-gray-700">Video could not load</p>
        <p className="mt-1 text-xs text-gray-500">Use the written instructions. Try reopening the exercise or reloading the page.</p>
      </div>
    );
  }

  return (
    <div className="relative w-full overflow-hidden rounded-lg bg-black" style={{ aspectRatio: "16 / 9" }}>
      {video.kind === "file" ? (
        <video
          ref={videoRef}
          className="absolute inset-0 h-full w-full"
          src={exerciseVideoFileUrl(exerciseId)}
          controls
          playsInline
          loop={playing}
          preload="metadata"
          onError={() => setFailed(true)}
          aria-label={`Guide video for ${exerciseName}`}
        />
      ) : (
        <iframe
          ref={frameRef}
          onLoad={unmuteYouTube}
          className="absolute inset-0 h-full w-full"
          src={youTubeEmbedUrl(video.youtubeId, { autoplayLoop: playing, origin })}
          title={`Guide video for ${exerciseName}`}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          loading="lazy"
        />
      )}
    </div>
  );
}
