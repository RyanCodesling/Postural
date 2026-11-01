/**
 * Session videos on this deployment's disk. A patient who opts in records the
 * session in parts (one per page load, since a reload and Resume start a new
 * recorder); each part is appended chunk by chunk as the browser uploads it.
 * Only the owning patient and their assigned therapist may read a recording,
 * and only the patient may delete it: the API routes enforce that. Videos are
 * for their review only and must never be used to train or tune the system.
 *
 * Files live under RECORDINGS_DIR (default: `.recordings` in the working
 * directory), one folder per session holding `manifest.json` and the parts.
 */
import { createReadStream } from "node:fs";
import { appendFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export const MAX_CHUNK_BYTES = 16 * 1024 * 1024;
export const MAX_SESSION_VIDEO_BYTES = 600 * 1024 * 1024;
export const MAX_SESSION_OVERLAY_BYTES = 64 * 1024 * 1024;
export const MAX_PARTS = 20;

export type RecordingPartStatus = "recording" | "complete" | "incomplete";
export type RecordingPart = {
  index: number;
  mimeType: string;
  /** Client wall-clock time when the recorder started; timeline markers use the same clock. */
  startWallMs: number;
  endWallMs: number | null;
  bytes: number;
  chunks: number;
  status: RecordingPartStatus;
  /** The coaching overlay track beside the video; absent in older recordings. */
  overlayBytes?: number;
  overlayChunks?: number;
  /** How far into the part the saved overlay track reaches, from the last batch stored. */
  overlayThroughMs?: number;
  /** Whether the browser saved the whole overlay track, as it reported when closing the part. */
  overlayStatus?: "complete" | "incomplete";
};
export type RecordingManifest = { version: 1; sessionId: number; parts: RecordingPart[] };

/**
 * How much of a part's overlay track was saved: "none" when the part has no
 * track (it was recorded before tracks existed, or nothing was sent), and
 * "partial" when an upload failed or the part was never closed by its browser.
 */
export function overlayCoverage(part: RecordingPart): "complete" | "partial" | "none" {
  if (part.overlayStatus === "complete") return "complete";
  if (part.overlayStatus === "incomplete" || (part.overlayBytes ?? 0) > 0) return "partial";
  return "none";
}

const MIME_PATTERN = /^video\/(webm|mp4)(;\s*codecs="?[a-z0-9.,]+"?)?$/i;

export function recordingsRoot(): string {
  return process.env.RECORDINGS_DIR || path.join(process.cwd(), ".recordings");
}

const sessionDir = (sessionId: number) => path.join(recordingsRoot(), `session-${sessionId}`);
const manifestPath = (sessionId: number) => path.join(sessionDir(sessionId), "manifest.json");
const partPath = (sessionId: number, part: RecordingPart) =>
  path.join(sessionDir(sessionId), `part-${part.index}.${/mp4/i.test(part.mimeType) ? "mp4" : "webm"}`);
const overlayPath = (sessionId: number, part: RecordingPart) =>
  path.join(sessionDir(sessionId), `part-${part.index}.overlay.jsonl`);

// Requests for one session are serialized within this process, so a retried
// chunk can never interleave with the original.
const locks = new Map<number, Promise<unknown>>();
function withLock<T>(sessionId: number, task: () => Promise<T>): Promise<T> {
  const previous = locks.get(sessionId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  locks.set(sessionId, next);
  void next.finally(() => { if (locks.get(sessionId) === next) locks.delete(sessionId); }).catch(() => undefined);
  return next;
}

export async function readManifest(sessionId: number): Promise<RecordingManifest | null> {
  try {
    const manifest = JSON.parse(await readFile(manifestPath(sessionId), "utf8")) as RecordingManifest;
    return manifest.version === 1 && Array.isArray(manifest.parts) ? manifest : null;
  } catch {
    return null;
  }
}

async function writeManifest(manifest: RecordingManifest) {
  const target = manifestPath(manifest.sessionId);
  const temporary = `${target}.tmp`;
  await writeFile(temporary, JSON.stringify(manifest, null, 2));
  await rename(temporary, target);
}

export function validRecordingMimeType(value: unknown): value is string {
  return typeof value === "string" && value.length <= 80 && MIME_PATTERN.test(value);
}

export async function hasRecording(sessionId: number): Promise<boolean> {
  const manifest = await readManifest(sessionId);
  return !!manifest && manifest.parts.some((p) => p.bytes > 0);
}

/** Opens the next part. Returns null when the session already has the maximum. */
export function startPart(sessionId: number, mimeType: string, startWallMs: number): Promise<RecordingPart | null> {
  return withLock(sessionId, async () => {
    await mkdir(sessionDir(sessionId), { recursive: true });
    const manifest = (await readManifest(sessionId)) ?? { version: 1 as const, sessionId, parts: [] };
    if (manifest.parts.length >= MAX_PARTS) return null;
    // A part left open by a reload can no longer grow.
    for (const part of manifest.parts) if (part.status === "recording") part.status = "incomplete";
    const part: RecordingPart = {
      index: manifest.parts.length + 1, mimeType, startWallMs, endWallMs: null, bytes: 0, chunks: 0, status: "recording",
    };
    manifest.parts.push(part);
    await writeFile(partPath(sessionId, part), new Uint8Array());
    await writeManifest(manifest);
    return part;
  });
}

export type AppendResult = "appended" | "duplicate" | "gap" | "missing" | "closed" | "too-large";

/**
 * Appends chunk `seq` (1-based) to a part. A chunk already stored reports
 * "duplicate", so a retry is harmless; a skipped chunk is refused as "gap"
 * because the file must stay a contiguous stream.
 */
export function appendChunk(sessionId: number, index: number, seq: number, bytes: Uint8Array): Promise<AppendResult> {
  return withLock(sessionId, async () => {
    const manifest = await readManifest(sessionId);
    const part = manifest?.parts.find((p) => p.index === index);
    if (!manifest || !part) return "missing";
    if (seq <= part.chunks) return "duplicate";
    if (part.status !== "recording") return "closed";
    if (seq !== part.chunks + 1) return "gap";
    const total = manifest.parts.reduce((sum, p) => sum + p.bytes, 0);
    if (bytes.byteLength > MAX_CHUNK_BYTES || total + bytes.byteLength > MAX_SESSION_VIDEO_BYTES) return "too-large";
    await appendFile(partPath(sessionId, part), bytes);
    part.bytes += bytes.byteLength;
    part.chunks = seq;
    await writeManifest(manifest);
    return "appended";
  });
}

/**
 * Appends overlay chunk `seq` to a part's overlay track, with the same ordering
 * rules as video chunks. `throughMs` is how far into the part the chunk covers.
 */
export function appendOverlayChunk(
  sessionId: number, index: number, seq: number, bytes: Uint8Array, throughMs?: number,
): Promise<AppendResult> {
  return withLock(sessionId, async () => {
    const manifest = await readManifest(sessionId);
    const part = manifest?.parts.find((p) => p.index === index);
    if (!manifest || !part) return "missing";
    const chunks = part.overlayChunks ?? 0;
    if (seq <= chunks) return "duplicate";
    if (part.status !== "recording") return "closed";
    if (seq !== chunks + 1) return "gap";
    const total = manifest.parts.reduce((sum, p) => sum + (p.overlayBytes ?? 0), 0);
    if (bytes.byteLength > MAX_CHUNK_BYTES || total + bytes.byteLength > MAX_SESSION_OVERLAY_BYTES) return "too-large";
    await appendFile(overlayPath(sessionId, part), bytes);
    part.overlayBytes = (part.overlayBytes ?? 0) + bytes.byteLength;
    part.overlayChunks = seq;
    if (throughMs !== undefined) part.overlayThroughMs = Math.max(part.overlayThroughMs ?? 0, throughMs);
    await writeManifest(manifest);
    return "appended";
  });
}

/** A part's overlay track as text, or null when it has none. */
export async function readOverlay(sessionId: number, index: number): Promise<string | null> {
  const manifest = await readManifest(sessionId);
  const part = manifest?.parts.find((p) => p.index === index);
  if (!part || !part.overlayBytes) return null;
  try {
    return await readFile(overlayPath(sessionId, part), "utf8");
  } catch {
    return null;
  }
}

/**
 * Closes a part. `complete` is false when the browser could not upload the
 * whole video, and `overlayComplete` likewise for the overlay track.
 */
export function finishPart(
  sessionId: number, index: number, endWallMs: number, complete: boolean, overlayComplete?: boolean,
): Promise<boolean> {
  return withLock(sessionId, async () => {
    const manifest = await readManifest(sessionId);
    const part = manifest?.parts.find((p) => p.index === index);
    if (!manifest || !part) return false;
    if (part.status === "recording") {
      part.status = complete ? "complete" : "incomplete";
      if (overlayComplete !== undefined) part.overlayStatus = overlayComplete ? "complete" : "incomplete";
    }
    if (Number.isFinite(endWallMs) && endWallMs >= part.startWallMs) part.endWallMs = endWallMs;
    await writeManifest(manifest);
    return true;
  });
}

export function deleteRecording(sessionId: number): Promise<void> {
  return withLock(sessionId, () => rm(sessionDir(sessionId), { recursive: true, force: true }));
}

// Recently Deleted: a deleted video's folder is renamed, beside the live ones,
// so an admin can put it back. Only these folder names are ever restored or
// erased, never a path taken from elsewhere.
const BIN_FOLDER = /^deleted-session-(\d+)-(\d+)$/;

/** Moves a session's video aside for Recently Deleted; null when it has none. */
export function moveRecordingToBin(sessionId: number): Promise<string | null> {
  return withLock(sessionId, async () => {
    if (!(await readManifest(sessionId))) return null;
    const folder = `deleted-session-${sessionId}-${Date.now()}`;
    await rename(sessionDir(sessionId), path.join(recordingsRoot(), folder));
    return folder;
  });
}

/** Puts a binned video back; "occupied" when the session has a video again. */
export function restoreRecordingFromBin(sessionId: number, folder: string): Promise<"restored" | "occupied" | "missing"> {
  const match = BIN_FOLDER.exec(folder);
  if (!match || Number(match[1]) !== sessionId) return Promise.resolve("missing");
  return withLock(sessionId, async () => {
    if (await readManifest(sessionId)) return "occupied";
    try {
      await stat(path.join(recordingsRoot(), folder));
    } catch {
      return "missing";
    }
    await rm(sessionDir(sessionId), { recursive: true, force: true });
    await rename(path.join(recordingsRoot(), folder), sessionDir(sessionId));
    return "restored";
  });
}

/** Erases a binned video for good. */
export async function eraseBinnedRecording(folder: string): Promise<void> {
  if (!BIN_FOLDER.test(folder)) throw new Error("Invalid deleted recording folder");
  await rm(path.join(recordingsRoot(), folder), { recursive: true, force: true });
}

/** The stored file of one part, for streaming. */
export async function openPart(sessionId: number, index: number) {
  const manifest = await readManifest(sessionId);
  const part = manifest?.parts.find((p) => p.index === index);
  if (!part) return null;
  const file = partPath(sessionId, part);
  try {
    const { size } = await stat(file);
    return {
      part,
      size,
      stream: (range?: { start: number; end: number }) => createReadStream(file, range),
    };
  } catch {
    return null;
  }
}
