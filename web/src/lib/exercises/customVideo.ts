/**
 * A custom exercise's optional guide video: an uploaded MP4 or WebM file, or a
 * YouTube video. Shared by the admin form, the API routes and the players.
 *
 * Only a YouTube video id is stored, never pasted HTML: the player builds its
 * own privacy-enhanced embed URL from the id, so pasted embed code cannot add
 * scripts or attributes to the page.
 */

export const MAX_EXERCISE_VIDEO_BYTES = 100 * 1024 * 1024;

export const EXERCISE_VIDEO_ACCEPT = "video/mp4,video/webm,.mp4,.webm";

export type ExerciseVideoMimeType = "video/mp4" | "video/webm";

/** Server-side reference to one immutable upload, or a legacy id-based file. */
export type ExerciseVideoFile = { mimeType: ExerciseVideoMimeType; fileName: string | null };

export function exerciseVideoFileFromRow(row: {
  video_mime_type?: unknown;
  video_file_name?: unknown;
}): ExerciseVideoFile | null {
  return isExerciseVideoMimeType(row.video_mime_type)
    ? { mimeType: row.video_mime_type, fileName: typeof row.video_file_name === "string" ? row.video_file_name : null }
    : null;
}

export type ExerciseVideo =
  | { kind: "file"; mimeType: ExerciseVideoMimeType }
  | { kind: "youtube"; youtubeId: string };

/** The stored type of a chosen file, or null when it is not an MP4 or WebM. */
export function exerciseVideoMimeType(file: { name: string; type: string }): ExerciseVideoMimeType | null {
  const extension = file.name.split(".").pop()?.toLowerCase();
  const declared = file.type.toLowerCase();
  const unknownType = declared === "" || declared === "application/octet-stream";
  if (extension === "mp4" && (unknownType || declared === "video/mp4")) return "video/mp4";
  if (extension === "webm" && (unknownType || declared === "video/webm")) return "video/webm";
  return null;
}

export function isExerciseVideoMimeType(value: unknown): value is ExerciseVideoMimeType {
  return value === "video/mp4" || value === "video/webm";
}

/**
 * Whether the file's first bytes match its type: an MP4 has an `ftyp` box at
 * byte 4 and a WebM starts with the EBML header.
 */
export function hasExerciseVideoSignature(head: Uint8Array, mimeType: ExerciseVideoMimeType): boolean {
  if (mimeType === "video/mp4") {
    return head.length >= 8 && String.fromCharCode(head[4], head[5], head[6], head[7]) === "ftyp";
  }
  return head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3;
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_URL =
  /(?:youtube(?:-nocookie)?\.com\/(?:embed\/|watch\?(?:[^"'\s]*&)?v=|shorts\/|live\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/i;

/**
 * The video id in pasted YouTube embed code, a YouTube link, or a bare id.
 * Returns null when no YouTube video can be found.
 */
export function parseYouTubeVideoId(input: string): string | null {
  const text = input.trim();
  if (YOUTUBE_ID.test(text)) return text;
  return YOUTUBE_URL.exec(text.replace(/&amp;/g, "&"))?.[1] ?? null;
}

export function youTubeEmbedUrl(videoId: string): string {
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?rel=0`;
}

/** The video stored on an exercise row, or null when it has none. */
export function exerciseVideoFromRow(row: {
  video_mime_type?: unknown;
  youtube_video_id?: unknown;
}): ExerciseVideo | null {
  if (isExerciseVideoMimeType(row.video_mime_type)) return { kind: "file", mimeType: row.video_mime_type };
  if (typeof row.youtube_video_id === "string" && YOUTUBE_ID.test(row.youtube_video_id)) {
    return { kind: "youtube", youtubeId: row.youtube_video_id };
  }
  return null;
}

export function exerciseVideoFileUrl(exerciseId: string): string {
  return `/api/exercises/${encodeURIComponent(exerciseId)}/video`;
}
