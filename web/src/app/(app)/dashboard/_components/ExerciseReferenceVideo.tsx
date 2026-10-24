"use client";

import { useState } from "react";
import { demoClipFor } from "@/lib/exercises/demoClips";
import DemoClipPlayer from "../../camera/DemoClipPlayer";

/** Staff catalog previews use the same accepted guides as the camera page. */
export default function ExerciseReferenceVideo({ exerciseId, isCustom }: {
  exerciseId: string;
  isCustom: boolean;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const clip = isCustom ? null : demoClipFor(exerciseId);

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
              : "Use the written instructions below. No animated guide is published for this exercise."}
          </p>
        </div>
      )}
    </section>
  );
}
