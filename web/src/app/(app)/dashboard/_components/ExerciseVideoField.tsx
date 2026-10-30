"use client";

import { useState } from "react";
import {
  EXERCISE_VIDEO_ACCEPT,
  MAX_EXERCISE_VIDEO_BYTES,
  exerciseVideoMimeType,
  parseYouTubeVideoId,
} from "@/lib/exercises/customVideo";

export type ExerciseVideoChoice =
  | { source: "none" }
  | { source: "file"; file: File | null }
  | { source: "youtube"; embed: string };

export const NO_EXERCISE_VIDEO: ExerciseVideoChoice = { source: "none" };

/** Why the choice cannot be submitted yet, or null when it can. */
export function exerciseVideoChoiceError(choice: ExerciseVideoChoice): string | null {
  if (choice.source === "file" && (!choice.file || !exerciseVideoMimeType(choice.file))) {
    return "Choose an MP4 or WebM video to attach, or pick No video.";
  }
  if (choice.source === "youtube" && !parseYouTubeVideoId(choice.embed)) {
    return "Paste a YouTube embed code or a YouTube video link.";
  }
  return null;
}

/**
 * Adds a custom exercise with its optional guide video: the exercise with any
 * YouTube video first, then the uploaded file. An exercise whose upload fails
 * is discarded only if it is still unused; cleanup refusal is reported.
 */
export async function createCustomExercise<T extends { id: string }>(
  data: { name: string; description: string },
  choice: ExerciseVideoChoice,
): Promise<{ exercise: T } | { error: string }> {
  const res = await fetch("/api/exercises", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...data,
      isCustom: true,
      youtubeEmbed: choice.source === "youtube" ? choice.embed : undefined,
    }),
  });
  const created = await res.json().catch(() => ({}));
  if (!res.ok) return { error: created.error || "Unable to add the exercise. Please try again." };

  const file = choice.source === "file" ? choice.file : null;
  const mimeType = file ? exerciseVideoMimeType(file) : null;
  if (!file || !mimeType) return { exercise: created.exercise as T };

  const id = encodeURIComponent(created.exercise.id);
  const upload = await fetch(`/api/exercises/${id}/video`, {
    method: "PUT",
    headers: { "Content-Type": mimeType },
    body: file,
  }).catch(() => null);
  const uploaded = upload ? await upload.json().catch(() => ({})) : {};
  if (!upload?.ok) {
    const cleanup = await fetch(`/api/exercises/${id}?discardNew=true`, { method: "DELETE" }).catch(() => null);
    const uploadError = uploaded.error || "The video could not be uploaded.";
    if (cleanup?.ok) return { error: `${uploadError} The exercise was not added.` };
    const reason = cleanup ? await cleanup.json().catch(() => ({})) : {};
    return {
      error: `${uploadError} ${cleanup?.status === 409 ? "The exercise was kept." : "Its removal could not be confirmed."} Reload the exercise list before retrying.${reason.error ? ` ${reason.error}` : ""}`,
    };
  }
  return { exercise: uploaded.exercise as T };
}

/**
 * The optional guide video of a new custom exercise: no video, an MP4 or WebM
 * file up to 100 MB, or a YouTube embed code or link.
 */
export default function ExerciseVideoField({ value, onChange, onError, name = "exercise-video-source" }: {
  value: ExerciseVideoChoice;
  onChange: (choice: ExerciseVideoChoice) => void;
  /** A file the field refused, or null when the error is cleared. */
  onError: (message: string | null) => void;
  name?: string;
}) {
  const [inputKey, setInputKey] = useState(0);

  const chooseFile = (file: File | null) => {
    onError(null);
    if (file && (!exerciseVideoMimeType(file) || file.size > MAX_EXERCISE_VIDEO_BYTES)) {
      setInputKey((key) => key + 1);
      onChange({ source: "file", file: null });
      onError(exerciseVideoMimeType(file) ? "The video must be 100 MB or smaller." : "Only MP4 and WebM videos can be attached.");
      return;
    }
    onChange({ source: "file", file });
  };

  return (
    <fieldset>
      <legend className="block text-sm font-medium text-gray-700 mb-1">
        Guide video <span className="font-normal text-gray-400">(optional)</span>
      </legend>
      <div className="flex flex-wrap gap-2">
        {([
          ["none", "No video"],
          ["file", "Attach video file"],
          ["youtube", "YouTube embed code"],
        ] as const).map(([source, label]) => (
          <label
            key={source}
            className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm transition ${
              value.source === source
                ? "border-green-600 bg-green-50 text-green-800"
                : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            <input
              type="radio"
              name={name}
              value={source}
              checked={value.source === source}
              onChange={() => {
                onError(null);
                onChange(source === "file" ? { source, file: null } : source === "youtube" ? { source, embed: "" } : { source });
              }}
              className="sr-only"
            />
            {label}
          </label>
        ))}
      </div>

      {value.source === "file" && (
        <div className="mt-3">
          <input
            key={inputKey}
            type="file"
            accept={EXERCISE_VIDEO_ACCEPT}
            onChange={(e) => chooseFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-gray-700 file:mr-3 file:rounded-lg file:border-0 file:bg-green-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-green-800 hover:file:bg-green-100"
          />
          <p className="mt-1 text-xs text-gray-500">
            {value.file
              ? `${value.file.name} · ${(value.file.size / (1024 * 1024)).toFixed(1)} MB`
              : "MP4 or WebM, up to 100 MB."}
          </p>
        </div>
      )}

      {value.source === "youtube" && (
        <div className="mt-3">
          <textarea
            value={value.embed}
            onChange={(e) => { onError(null); onChange({ source: "youtube", embed: e.target.value }); }}
            placeholder={'<iframe src="https://www.youtube.com/embed/..." ...></iframe>'}
            className="w-full border border-green-200 rounded-lg px-3 py-2 font-mono text-xs focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-100 bg-white text-black"
            rows={3}
          />
          <p className="mt-1 text-xs text-gray-500">
            On YouTube, choose Share → Embed and paste the code here. A YouTube link also works.
            {value.embed.trim() !== "" && (
              parseYouTubeVideoId(value.embed)
                ? <span className="ml-1 font-medium text-green-700">Video found.</span>
                : <span className="ml-1 font-medium text-red-600">No YouTube video found in this code.</span>
            )}
          </p>
        </div>
      )}
    </fieldset>
  );
}
