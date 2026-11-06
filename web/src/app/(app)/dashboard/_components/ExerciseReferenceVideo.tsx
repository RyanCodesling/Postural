"use client";

import { useState } from "react";
import { demoClipFor } from "@/lib/exercises/demoClips";
import type { ExerciseVideo } from "@/lib/exercises/customVideo";
import DemoClipPlayer from "../../camera/DemoClipPlayer";
import CustomExerciseVideo from "./CustomExerciseVideo";

/**
 * Staff catalog previews use the same accepted guides as the camera page; a
 * custom exercise shows the video attached to it, when it has one.
 */
export default function ExerciseReferenceVideo({ exerciseId, isCustom, customVideo, exerciseName = "this exercise" }: {
  exerciseId: string;
  isCustom: boolean;
  customVideo?: ExerciseVideo | null;
  exerciseName?: string;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const clip = isCustom ? null : demoClipFor(exerciseId);

  if (isCustom && customVideo) {
    return (
      <section aria-label="Reference video" className="rounded-xl border border-gray-200 bg-gray-50 p-3">
        <CustomExerciseVideo exerciseId={exerciseId} exerciseName={exerciseName} video={customVideo} />
      </section>
    );
  }

  return (
    <section aria-label="Reference video" className="rounded-xl border border-gray-200 bg-gray-50 p-3">
      {clip && clip.src !== failedSrc ? (
        <DemoClipPlayer key={clip.src} clip={clip} compact onError={() => setFailedSrc(clip.src)} />
      ) : (
        <div className="p-1">
          <p className="text-sm font-semibold text-gray-700">
            {clip ? "Reference video could not load" : "Reference video unavailable"}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            {clip
              ? "Use the written instructions below. Try reopening the exercise or reloading the page."
              : "Use the written instructions below. No guide video is attached to this exercise."}
          </p>
        </div>
      )}
    </section>
  );
}
