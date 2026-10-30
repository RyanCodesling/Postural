/** Uploaded guides on this deployment's disk. Metadata selects one immutable
 * file; replacing a guide never overwrites or deletes another request's upload.
 * Files without video_file_name keep their legacy <exercise-id>.mp4/webm path.
 */
import { createReadStream } from "node:fs";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import {
  MAX_EXERCISE_VIDEO_BYTES,
  hasExerciseVideoSignature,
  type ExerciseVideoMimeType,
} from "./customVideo";

const EXERCISE_ID = /^[A-Za-z0-9_-]{1,50}$/;
const VIDEO_FILE = /^[A-Za-z0-9_-]{1,50}\.[a-f0-9]{32}\.(mp4|webm)$/;

export function exerciseVideosRoot(): string {
  return process.env.EXERCISE_VIDEOS_DIR || path.join(process.cwd(), ".exercise-videos");
}

function videoPath(exerciseId: string, mimeType: ExerciseVideoMimeType, fileName?: string | null): string {
  if (!EXERCISE_ID.test(exerciseId)) throw new Error("Invalid exercise id");
  const extension = mimeType === "video/mp4" ? "mp4" : "webm";
  if (fileName != null && (!VIDEO_FILE.test(fileName) || !fileName.startsWith(`${exerciseId}.`) || !fileName.endsWith(`.${extension}`))) {
    throw new Error("Invalid exercise video filename");
  }
  return path.join(exerciseVideosRoot(), fileName ?? `${exerciseId}.${extension}`);
}

export type SaveVideoResult = { status: "saved"; fileName: string } | "too-large" | "bad-signature" | "empty";

/** Stage a complete, validated upload at its own name. Metadata publication is
 * separate, so a rejected or failed replacement leaves the current guide alone.
 */
export async function saveExerciseVideo(
  exerciseId: string,
  mimeType: ExerciseVideoMimeType,
  body: ReadableStream<Uint8Array>,
): Promise<SaveVideoResult> {
  const extension = mimeType === "video/mp4" ? "mp4" : "webm";
  const fileName = `${exerciseId}.${randomBytes(16).toString("hex")}.${extension}`;
  const target = videoPath(exerciseId, mimeType, fileName);
  await mkdir(exerciseVideosRoot(), { recursive: true });
  const temporary = `${target}.upload`;
  const out = await open(temporary, "wx");
  const reader = body.getReader();
  let total = 0;
  let head = new Uint8Array(0);
  let result: SaveVideoResult = { status: "saved", fileName };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_EXERCISE_VIDEO_BYTES) { result = "too-large"; break; }
      if (head.length < 16) {
        const joined = new Uint8Array(Math.min(16, head.length + value.byteLength));
        joined.set(head);
        joined.set(value.subarray(0, joined.length - head.length), head.length);
        head = joined;
        if (head.length >= 8 && !hasExerciseVideoSignature(head, mimeType)) { result = "bad-signature"; break; }
      }
      let offset = 0;
      while (offset < value.byteLength) {
        const { bytesWritten } = await out.write(value, offset, value.byteLength - offset);
        if (bytesWritten === 0) throw new Error("Could not write the video");
        offset += bytesWritten;
      }
    }
    if (typeof result !== "string" && total === 0) result = "empty";
    if (typeof result !== "string" && !hasExerciseVideoSignature(head, mimeType)) result = "bad-signature";
    await out.close();
    if (typeof result === "string") {
      await reader.cancel().catch(() => undefined);
      await rm(temporary, { force: true });
      return result;
    }
    await rename(temporary, target);
    return result;
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    await out.close().catch(() => undefined);
    await rm(temporary, { force: true });
    throw error;
  } finally {
    reader.releaseLock();
  }
}

/** Delete exactly one known upload, never another concurrent request's file. */
export async function deleteExerciseVideoFile(exerciseId: string, mimeType: ExerciseVideoMimeType, fileName?: string | null): Promise<void> {
  await rm(videoPath(exerciseId, mimeType, fileName), { force: true });
}

/** The metadata-selected file, for streaming, or null when it is missing. */
export async function openExerciseVideo(exerciseId: string, mimeType: ExerciseVideoMimeType, fileName?: string | null) {
  const file = videoPath(exerciseId, mimeType, fileName);
  try {
    const { size } = await stat(file);
    return { size, stream: (range?: { start: number; end: number }) => createReadStream(file, range) };
  } catch {
    return null;
  }
}
