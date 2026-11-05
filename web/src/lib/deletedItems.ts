/**
 * Recently Deleted: session videos a patient deleted, attached files the admin
 * or a therapist deleted, and guide videos taken off a custom exercise. They
 * stay until an admin restores them or deletes them for good; nothing is
 * removed automatically. The admin sees what each item is and who deleted it,
 * never its contents.
 */
import pool, {
  DeletedItemsBinUnavailableError,
  createNotification,
  getUserById,
  hasDeletedItemsBin,
  setExerciseVideoFile,
  setExerciseYouTubeVideo,
} from "@/lib/db";
import type { PoolClient } from "pg";
import { eraseBinnedRecording, moveRecordingToBin, restoreRecordingFromBin } from "@/lib/recording/storage";
import { deleteExerciseVideoFile, openExerciseVideo } from "@/lib/exercises/customVideoStorage";
import { isExerciseVideoMimeType } from "@/lib/exercises/customVideo";

export type DeletedItemKind = "session_video" | "patient_file" | "exercise_video";

export interface DeletedItem {
  id: number;
  kind: DeletedItemKind;
  label: string;
  details: Record<string, unknown>;
  patientId: string | null;
  patientName: string | null;
  exerciseId: string | null;
  exerciseName: string | null;
  exerciseArchived: boolean;
  deletedByName: string | null;
  deletedByRole: string | null;
  deletedAt: string;
}

export async function listDeletedItems(): Promise<DeletedItem[]> {
  const result = await pool.query(
    `SELECT d.id, d.kind, d.label, d.details, d.patient_id, p.name AS patient_name,
            d.exercise_id, e.name AS exercise_name, e.archived_at IS NOT NULL AS exercise_archived,
            b.name AS deleted_by_name, b.role AS deleted_by_role, d.deleted_at
       FROM deleted_items d
       LEFT JOIN users p ON p.id = d.patient_id
       LEFT JOIN exercises e ON e.id = d.exercise_id
       LEFT JOIN users b ON b.id = d.deleted_by
      ORDER BY d.deleted_at DESC, d.id DESC`,
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    kind: row.kind,
    label: String(row.label),
    details: row.details ?? {},
    patientId: row.patient_id ?? null,
    patientName: row.patient_name ?? null,
    exerciseId: row.exercise_id ?? null,
    exerciseName: row.exercise_name ?? null,
    exerciseArchived: row.exercise_archived === true,
    deletedByName: row.deleted_by_name ?? null,
    deletedByRole: row.deleted_by_role ?? null,
    deletedAt: new Date(row.deleted_at).toISOString(),
  }));
}

/**
 * Moves a session's video to Recently Deleted for the patient who owns it.
 * False when the session has no video. Refuses, rather than losing the video,
 * until scripts/deleted_items_pg.sql has been run.
 */
export async function binSessionVideo(sessionId: number, patientId: string, deletedBy: string): Promise<boolean> {
  if (!(await hasDeletedItemsBin())) throw new DeletedItemsBinUnavailableError();
  const session = await pool.query(
    `SELECT s.started_at, COALESCE(e.name, s.exercise_id) AS exercise_name
       FROM sessions s LEFT JOIN exercises e ON e.id = s.exercise_id
      WHERE s.id = $1`,
    [sessionId],
  );
  const folder = await moveRecordingToBin(sessionId);
  if (!folder) return false;
  try {
    await pool.query(
      `INSERT INTO deleted_items (kind, patient_id, session_id, label, details, deleted_by)
       VALUES ('session_video', $1, $2, $3, $4, $5)`,
      [
        patientId,
        sessionId,
        String(session.rows[0]?.exercise_name ?? "Session"),
        JSON.stringify({ folder, startedAt: session.rows[0]?.started_at ?? null }),
        deletedBy,
      ],
    );
  } catch (error) {
    // Unrecorded, the video would be unreachable: put it back.
    await restoreRecordingFromBin(sessionId, folder).catch(() => undefined);
    throw error;
  }
  return true;
}

export type RestoreResult =
  | { ok: true; message: string }
  | { ok: false; status: 404 | 409; error: string };

function sessionDay(details: Record<string, unknown>): string {
  const startedAt = typeof details.startedAt === "string" ? new Date(details.startedAt) : null;
  return startedAt && !Number.isNaN(startedAt.getTime())
    ? startedAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "Asia/Manila" })
    : "";
}

async function notifyPatientAndTherapist(patientId: string, title: string, message: string, type: string) {
  const patient = await getUserById(patientId);
  await createNotification(patientId, title, message, type);
  if (patient?.therapistId) {
    await createNotification(String(patient.therapistId), title, `${patient.name}: ${message}`, type);
  }
}

type HeldRestore = { result: RestoreResult; notify?: () => Promise<unknown> };

/**
 * Puts an item back where it was deleted from and takes it out of the bin, in
 * one transaction that keeps the bin entry locked: a second restore or a
 * permanent delete of the same item waits for it, then finds the item gone.
 */
export async function restoreDeletedItem(id: number, restoredBy: string): Promise<RestoreResult> {
  const client = await pool.connect();
  let restore: HeldRestore;
  try {
    await client.query("BEGIN");
    restore = await restoreHeldItem(client, id, restoredBy);
    await client.query(restore.result.ok ? "COMMIT" : "ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  // Sent once the restore is saved; a failed notice does not undo it.
  await restore.notify?.().catch((error) => console.error("Failed to send the restore notification:", error));
  return restore.result;
}

async function restoreHeldItem(client: PoolClient, id: number, restoredBy: string): Promise<HeldRestore> {
  const found = await client.query(
    `SELECT d.*, e.archived_at AS exercise_archived_at, e.owner_therapist_id
       FROM deleted_items d LEFT JOIN exercises e ON e.id = d.exercise_id
      WHERE d.id = $1 FOR UPDATE OF d`,
    [id],
  );
  const item = found.rows[0];
  if (!item) return { result: { ok: false, status: 404, error: "This item is no longer in Recently Deleted." } };
  const details = (item.details ?? {}) as Record<string, unknown>;

  if (item.kind === "session_video") {
    const restored = await restoreRecordingFromBin(Number(item.session_id), String(details.folder ?? ""));
    if (restored === "occupied") {
      return { result: { ok: false, status: 409, error: "That session has a video again, so this one cannot be put back." } };
    }
    if (restored === "missing") {
      return { result: { ok: false, status: 409, error: "The video's files are missing from the server, so it cannot be restored." } };
    }
    await client.query("DELETE FROM deleted_items WHERE id = $1", [id]);
    const day = sessionDay(details);
    return {
      result: { ok: true, message: `The ${item.label} session video was restored.` },
      notify: () => notifyPatientAndTherapist(
        item.patient_id,
        "Session Video Restored",
        `The clinic restored the video of the ${item.label} session${day ? ` on ${day}` : ""}.`,
        "session_video_restored",
      ),
    };
  }

  if (item.kind === "patient_file") {
    await client.query(
      "UPDATE patient_image_attachments SET deleted_at = NULL, deleted_by = NULL WHERE id = $1",
      [item.attachment_id],
    );
    await client.query("DELETE FROM deleted_items WHERE id = $1", [id]);
    return {
      result: { ok: true, message: `${item.label} was restored to the patient's attached files.` },
      notify: () => notifyPatientAndTherapist(
        item.patient_id,
        "Attached File Restored",
        `The clinic restored the attached file ${item.label}.`,
        "patient_file_restored",
      ),
    };
  }

  // exercise_video: it becomes the exercise's video again; the one it
  // replaces goes to Recently Deleted in the same transaction.
  if (item.exercise_archived_at) {
    return { result: { ok: false, status: 409, error: `Restore the ${item.label} exercise from Archived first.` } };
  }
  let changed;
  if (details.source === "file" && isExerciseVideoMimeType(details.mimeType) &&
      (typeof details.fileName === "string" || details.fileName === null)) {
    // A permanent delete keeps a file while another entry names it, so a file
    // found here is still on disk when it is published.
    if (!(await openExerciseVideo(item.exercise_id, details.mimeType, details.fileName).catch(() => null))) {
      return { result: { ok: false, status: 409, error: "The guide video's file is missing from the server, so it cannot be restored." } };
    }
    changed = await setExerciseVideoFile(item.exercise_id, details.mimeType, details.fileName, restoredBy, client);
    // An older duplicate entry can name the guide already in use; publishing it
    // again would only put that guide in Recently Deleted once more.
    if (changed?.previousVideo && changed.previousVideo.mimeType === details.mimeType &&
        changed.previousVideo.fileName === details.fileName) {
      return { result: { ok: false, status: 409, error: "This video is already the exercise's guide video." } };
    }
  } else if (details.source === "youtube" && typeof details.youtubeVideoId === "string") {
    changed = await setExerciseYouTubeVideo(item.exercise_id, details.youtubeVideoId, restoredBy, client);
  } else {
    return { result: { ok: false, status: 409, error: "This guide video's details are incomplete, so it cannot be restored." } };
  }
  if (!changed) return { result: { ok: false, status: 404, error: "The exercise no longer exists." } };
  await client.query("DELETE FROM deleted_items WHERE id = $1", [id]);
  const ownerId = item.owner_therapist_id;
  return {
    result: { ok: true, message: `The earlier guide video of ${item.label} is back in use.` },
    notify: ownerId
      ? () => createNotification(
        ownerId,
        "Guide Video Restored",
        `The clinic restored an earlier guide video of ${item.label}.`,
        "exercise_video_restored",
      )
      : undefined,
  };
}

/** Removes the stored file or folder behind a bin entry. */
async function eraseContents(item: { kind: string; exercise_id: string | null; details: Record<string, unknown> | null }) {
  const details = item.details ?? {};
  if (item.kind === "session_video" && typeof details.folder === "string") {
    await eraseBinnedRecording(details.folder);
  }
  if (item.kind === "exercise_video" && details.source === "file" && item.exercise_id && isExerciseVideoMimeType(details.mimeType)) {
    await deleteExerciseVideoFile(item.exercise_id, details.mimeType, typeof details.fileName === "string" ? details.fileName : null);
  }
}

type GuideFile = { exerciseId: string; mimeType: unknown; fileName: string | null };

/** The uploaded guide file a bin entry names, or null for any other entry. */
function binnedGuideFile(
  item: { kind: string; exercise_id: string | null; details: Record<string, unknown> | null },
): GuideFile | null {
  const details = item.details ?? {};
  if (item.kind !== "exercise_video" || details.source !== "file" || !item.exercise_id) return null;
  return { exerciseId: item.exercise_id, mimeType: details.mimeType, fileName: typeof details.fileName === "string" ? details.fileName : null };
}

/** Whether the exercise is showing the guide file. */
async function guideVideoInUse(client: PoolClient, file: GuideFile): Promise<boolean> {
  const found = await client.query(
    "SELECT 1 FROM exercises WHERE id = $1 AND video_mime_type = $2 AND video_file_name IS NOT DISTINCT FROM $3",
    [file.exerciseId, file.mimeType, file.fileName],
  );
  return found.rows.length > 0;
}

/** Whether a bin entry other than this one names the same guide file. */
async function guideFileNamedElsewhere(client: PoolClient, id: number, file: GuideFile): Promise<boolean> {
  const found = await client.query(
    `SELECT 1 FROM deleted_items
      WHERE id <> $1 AND kind = 'exercise_video' AND exercise_id = $2 AND details->>'source' = 'file'
        AND details->>'mimeType' = $3 AND details->>'fileName' IS NOT DISTINCT FROM $4`,
    [id, file.exerciseId, file.mimeType, file.fileName],
  );
  return found.rows.length > 0;
}

export type PurgeResult = "deleted" | "missing" | "in-use";

/**
 * Deletes an item for good: its stored contents, then its bin entry. The
 * entry stays locked meanwhile, so a restore of the same item cannot run
 * alongside. A guide file its exercise is showing is never erased, and one
 * that another entry still names is kept for that entry.
 */
export async function purgeDeletedItem(id: number): Promise<PurgeResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query("SELECT * FROM deleted_items WHERE id = $1 FOR UPDATE", [id]);
    const item = found.rows[0];
    const file = item ? binnedGuideFile(item) : null;
    // The exercise's row lock, which a restore takes to publish a guide, orders
    // this with restores and other permanent deletes of its guide videos.
    if (file) await client.query("SELECT 1 FROM exercises WHERE id = $1 FOR UPDATE", [file.exerciseId]);
    const outcome: PurgeResult = !item ? "missing" : file && (await guideVideoInUse(client, file)) ? "in-use" : "deleted";
    if (outcome === "deleted") {
      if (!file || !(await guideFileNamedElsewhere(client, id, file))) await eraseContents(item);
      if (item.kind === "patient_file") {
        // Removing the file's row removes its bin entry with it.
        await client.query("DELETE FROM patient_image_attachments WHERE id = $1 AND deleted_at IS NOT NULL", [item.attachment_id]);
      }
      await client.query("DELETE FROM deleted_items WHERE id = $1", [id]);
    }
    await client.query(outcome === "deleted" ? "COMMIT" : "ROLLBACK");
    return outcome;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * The binned guide videos of an exercise about to be deleted for good. Read
 * them first: their bin entries go with the exercise row. Pass the result to
 * eraseExerciseVideoContents once the exercise is gone.
 */
export async function binnedExerciseVideos(exerciseId: string) {
  if (!(await hasDeletedItemsBin())) return [];
  const found = await pool.query(
    "SELECT kind, exercise_id, details FROM deleted_items WHERE exercise_id = $1 AND kind = 'exercise_video'",
    [exerciseId],
  );
  return found.rows as { kind: string; exercise_id: string; details: Record<string, unknown> | null }[];
}

export async function eraseExerciseVideoContents(items: Awaited<ReturnType<typeof binnedExerciseVideos>>): Promise<void> {
  for (const item of items) await eraseContents(item).catch(() => undefined);
}
