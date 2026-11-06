"use client";

import { useState } from "react";
import { exerciseVideoFileUrl, youTubeEmbedUrl, type ExerciseVideo } from "@/lib/exercises/customVideo";

/** A custom exercise's uploaded video or YouTube video, in a 16:9 frame. */
export default function CustomExerciseVideo({ exerciseId, exerciseName, video }: {
  exerciseId: string;
  exerciseName: string;
  video: ExerciseVideo;
}) {
  const [failed, setFailed] = useState(false);

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
          className="absolute inset-0 h-full w-full"
          src={exerciseVideoFileUrl(exerciseId)}
          controls
          playsInline
          preload="metadata"
          onError={() => setFailed(true)}
          aria-label={`Guide video for ${exerciseName}`}
        />
      ) : (
        <iframe
          className="absolute inset-0 h-full w-full"
          src={youTubeEmbedUrl(video.youtubeId)}
          title={`Guide video for ${exerciseName}`}
          allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          loading="lazy"
        />
      )}
    </div>
  );
}
