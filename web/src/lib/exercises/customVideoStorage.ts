/**
 * Uploaded custom-exercise videos on this deployment's disk, one file per
 * exercise named by its id. The exercise row's `video_mime_type` says which
 * file is current; archiving leaves the file in place and only a permanent
 * delete removes it.
 *
 * Files live under EXERCISE_VIDEOS_DIR (default: `.exercise-videos` in the
 * working directory).
 */
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import {
  MAX_EXERCISE_VIDEO_BYTES,
  hasExerciseVideoSignature,
  type ExerciseVideoMimeType,
} from "./customVideo";

const EXERCISE_ID = /^[A-Za-z0-9_-]{1,50}$/;

export function exerciseVideosRoot(): string {
  return process.env.EXERCISE_VIDEOS_DIR || path.join(process.cwd(), ".exercise-videos");
}

function videoPath(exerciseId: string, mimeType: ExerciseVideoMimeType): string {
  if (!EXERCISE_ID.test(exerciseId)) throw new Error("Invalid exercise id");
  return path.join(exerciseVideosRoot(), `${exerciseId}.${mimeType === "video/mp4" ? "mp4" : "webm"}`);
}

export type SaveVideoResult = "saved" | "too-large" | "bad-signature" | "empty";

/**
 * Streams an upload to a temporary file, refusing it once it passes the size
 * limit or when its first bytes are not the declared format, then replaces the
 * exercise's file. A refused or failed upload leaves the previous file alone.
 */
export async function saveExerciseVideo(
  exerciseId: string,
  mimeType: ExerciseVideoMimeType,
  body: ReadableStream<Uint8Array>,
): Promise<SaveVideoResult> {
  const target = videoPath(exerciseId, mimeType);
  await mkdir(exerciseVideosRoot(), { recursive: true });
  const temporary = `${target}.${randomBytes(6).toString("hex")}.upload`;
  const out = createWriteStream(temporary);
  const finished = new Promise<void>((resolve, reject) => {
    out.on("finish", resolve);
    out.on("error", reject);
  });
  const reader = body.getReader();
  let total = 0;
  let head = new Uint8Array(0);
  let result: SaveVideoResult = "saved";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_EXERCISE_VIDEO_BYTES) { result = "too-large"; break; }
      if (head.length < 16) {
        const joined = new Uint8Array(head.length + value.byteLength);
        joined.set(head);
        joined.set(value, head.length);
        head = joined.subarray(0, 16);
        if (head.length >= 8 && !hasExerciseVideoSignature(head, mimeType)) { result = "bad-signature"; break; }
      }
      if (!out.write(value)) await new Promise<void>((resolve) => out.once("drain", () => resolve()));
    }
    if (result === "saved" && total === 0) result = "empty";
    if (result === "saved" && !hasExerciseVideoSignature(head, mimeType)) result = "bad-signature";
  } catch (error) {
    out.destroy();
    await rm(temporary, { force: true });
    throw error;
  } finally {
    if (result !== "saved") await reader.cancel().catch(() => undefined);
  }
  out.end();
  await finished;
  if (result !== "saved") {
    await rm(temporary, { force: true });
    return result;
  }
  await rename(temporary, target);
  return "saved";
}

/** Removes the exercise's video files, of either type. */
export async function deleteExerciseVideo(exerciseId: string, keep?: ExerciseVideoMimeType): Promise<void> {
  for (const mimeType of ["video/mp4", "video/webm"] as const) {
    if (mimeType !== keep) await rm(videoPath(exerciseId, mimeType), { force: true });
  }
}

/** The stored file, for streaming, or null when it is missing. */
export async function openExerciseVideo(exerciseId: string, mimeType: ExerciseVideoMimeType) {
  const file = videoPath(exerciseId, mimeType);
  try {
    const { size } = await stat(file);
    return { size, stream: (range?: { start: number; end: number }) => createReadStream(file, range) };
  } catch {
    return null;
  }
}
