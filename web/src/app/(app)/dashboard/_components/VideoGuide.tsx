"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import TourFlow, { TOUR_FLOW_KEYFRAMES, type FlowFrame } from "./TourFlow";

type GuideStep = { title: string; lines: string[]; frames?: FlowFrame[] };
export type VideoGuideTrack = "file" | "youtube";

/** Attaching a video file: getting the file right, then the form. */
const FILE_STEPS: GuideStep[] = [
  {
    title: "Prepare the video",
    lines: [
      "The file must be MP4 or WebM and 100 MB or smaller.",
      "Film in landscape with the whole body in view, in good light and in front of a plain background.",
      "Show the movement slowly from the starting position to the end and back. 30 seconds to 2 minutes is enough.",
      "Only film people who have agreed to be recorded.",
    ],
    frames: [
      { kind: "heading", text: "Before you upload" },
      { kind: "tick", items: ["MP4 or WebM", "100 MB or smaller", "Whole body in view", "Good light"], ticked: [0, 1, 2, 3] },
    ],
  },
  {
    title: "If the phone saved another format",
    lines: [
      "Android phones usually save MP4. iPhones save MOV files, which cannot be attached.",
      "Convert a MOV file to MP4 first, for example with the Export or Save as option of a video editor on the phone or computer.",
      "If the file is larger than 100 MB, trim it or export it at 720p.",
      "Or upload it to YouTube and use the YouTube embed code steps instead.",
    ],
    frames: [
      { kind: "result", text: "MOV files are refused", tone: "bad" },
      { kind: "result", text: "Export as MP4, then attach it", tone: "ok" },
    ],
  },
  {
    title: "Choose the file",
    lines: [
      "Under Guide video, press Attach video file, then Choose File and pick the video.",
      "Its name and size appear under the button. If it is refused, the message says why.",
      "When editing an exercise, press Replace with video file instead. Keep current video leaves its video as it is.",
    ],
    frames: [
      { kind: "choose", options: ["No video", "Attach video file", "YouTube embed code"], picked: 1 },
      { kind: "shot", src: "video-file-chosen.png", caption: "The chosen file, with its size" },
    ],
  },
  {
    title: "Save the exercise",
    lines: [
      "Press Add Custom Exercise (Add Exercise on the admin's page). The button says Uploading video… until it is done; keep the page open.",
      "If the upload fails, the exercise is still saved without the video. Edit it and choose Replace with video file to try again.",
    ],
    frames: [
      { kind: "click", label: "Add Custom Exercise" },
      { kind: "result", text: "Saved with its guide video" },
    ],
  },
];

/** Using a YouTube video: getting the embed code, then the form. */
const YOUTUBE_STEPS: GuideStep[] = [
  {
    title: "Open the video on YouTube",
    lines: [
      "On a computer, go to youtube.com and open the video you want patients to follow.",
      "Choose a video from a trustworthy source that shows the movement the way you prescribe it.",
      "On the YouTube phone app there is no Embed button: press Share, then Copy link, and paste the link in the form. A link works too.",
    ],
    frames: [{ kind: "result", text: "The video's own page is open", tone: "ok" }],
  },
  {
    title: "Press Share",
    lines: ["Under the video, next to the like buttons, press Share (the arrow)."],
    frames: [{ kind: "shot", src: "yt-share-1.png", caption: "1. Press Share under the video" }],
  },
  {
    title: "Choose Embed",
    lines: [
      "In the Share box, press Embed, the first round button.",
      "If there is no Embed button, the video's owner does not allow it on other sites. Choose another video.",
    ],
    frames: [{ kind: "shot", src: "yt-share-2.png", caption: "2. Press Embed" }],
  },
  {
    title: "Copy the embed code",
    lines: [
      "The Embed Video box shows a code starting with <iframe. Press Copy at its bottom right.",
      "Leave the code as it is; there is no need to change it.",
    ],
    frames: [{ kind: "shot", src: "yt-share-3.png", caption: "3. Press Copy" }],
  },
  {
    title: "Paste it in the form",
    lines: [
      "Under Guide video, press YouTube embed code, click in the box and paste (Ctrl+V, or long-press and Paste on a phone).",
      "\"Video found.\" in green means the code is right. \"No YouTube video found in this code.\" in red means part of it is missing; copy it again.",
      "When editing an exercise, press Replace with YouTube instead.",
    ],
    frames: [
      { kind: "choose", options: ["No video", "Attach video file", "YouTube embed code"], picked: 2 },
      { kind: "shot", src: "video-youtube-found.png", caption: "4. Paste the code: Video found." },
    ],
  },
  {
    title: "Save the exercise",
    lines: [
      "Press Add Custom Exercise (Add Exercise on the admin's page).",
      "The video plays from YouTube. If its owner removes it or makes it private, it stops playing here too; edit the exercise and replace it.",
    ],
    frames: [
      { kind: "click", label: "Add Custom Exercise" },
      { kind: "result", text: "Saved with its YouTube video" },
    ],
  },
];

const TRACKS: Record<VideoGuideTrack, { label: string; steps: GuideStep[] }> = {
  file: { label: "Video file", steps: FILE_STEPS },
  youtube: { label: "YouTube embed code", steps: YOUTUBE_STEPS },
};

/**
 * A step-by-step guide to adding a custom exercise's guide video, by file or
 * by YouTube embed code, in the same card style as How to Use.
 */
export default function VideoGuide({ initialTrack = "file", onClose }: { initialTrack?: VideoGuideTrack; onClose: () => void }) {
  const [track, setTrack] = useState<VideoGuideTrack>(initialTrack);
  const [index, setIndex] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const steps = TRACKS[track].steps;
  const step = steps[index];
  const last = index === steps.length - 1;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => { bodyRef.current?.scrollTo({ top: 0 }); }, [track, index]);

  // Rendered on the body, so a form or card around the field cannot clip or stack over it.
  return createPortal(
    <>
      <style>{TOUR_FLOW_KEYFRAMES}</style>
      <div className="fixed inset-0 z-[60] bg-black/50" onClick={onClose} />
      <div className="fixed inset-0 z-[61] flex items-center justify-center p-3 sm:p-4" onClick={onClose}>
        <div
          role="dialog"
          aria-modal="true"
          aria-label="How to add a reference guide for custom exercise"
          className="flex max-h-[92vh] w-full max-w-xl flex-col rounded-2xl bg-white shadow-xl"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="shrink-0 border-b border-gray-100 px-5 pb-3 pt-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[12px] font-semibold uppercase tracking-[.14em] text-green-700">How to add a guide video</p>
                <h2 className="mt-0.5 text-lg font-bold text-gray-900">{step.title}</h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-gray-500 hover:bg-gray-100 hover:text-gray-800"
              >
                ✕
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2" role="tablist" aria-label="Video source">
              {(Object.keys(TRACKS) as VideoGuideTrack[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={track === key}
                  onClick={() => { setTrack(key); setIndex(0); }}
                  className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
                    track === key ? "border-green-600 bg-green-50 text-green-800" : "border-gray-200 text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {TRACKS[key].label}
                </button>
              ))}
            </div>
          </div>

          <div ref={bodyRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
            <ul className="space-y-2">
              {step.lines.map((line) => (
                <li key={line} className="flex gap-2 text-[15px] leading-snug text-gray-700">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-green-600" aria-hidden />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
            {step.frames && <TourFlow frames={step.frames} wide />}
          </div>

          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-gray-100 px-5 py-3">
            <span className="text-sm text-gray-600">Step {index + 1} of {steps.length}</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setIndex((i) => i - 1)}
                disabled={index === 0}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => (last ? onClose() : setIndex((i) => i + 1))}
                className="rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800"
              >
                {last ? "Done" : "Next"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
