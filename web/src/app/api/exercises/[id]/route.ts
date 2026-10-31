import { NextRequest, NextResponse } from "next/server";
import {
  archiveExercise,
  deleteArchivedExercise,
  discardNewExercise,
  ExerciseInUseError,
  getExerciseById,
  isMissingColumnError,
  restoreExercise,
  setExerciseYouTubeVideo,
  updateExercise,
} from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { deleteExerciseVideoFile } from "@/lib/exercises/customVideoStorage";
import { exerciseVideoFileFromRow, parseYouTubeVideoId } from "@/lib/exercises/customVideo";

type AuthenticatedUser = NonNullable<Awaited<ReturnType<typeof getAuthenticatedUser>>>;

/** Admins manage every custom exercise; a therapist only their own. */
function canManageCustom(user: AuthenticatedUser, exercise: { is_custom: unknown; owner_therapist_id: unknown }) {
  if (exercise.is_custom !== true) return false;
  return user.role === "admin" || exercise.owner_therapist_id === user.id;
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authenticatedUser = await getAuthenticatedUser(request);
    if (!authenticatedUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (authenticatedUser.role !== "admin" && authenticatedUser.role !== "therapist") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    const existing = await getExerciseById(id);
    if (!existing) {
      return NextResponse.json({ error: "Exercise not found" }, { status: 404 });
    }
    if (authenticatedUser.role === "therapist") {
      if (existing.is_custom !== true || existing.owner_therapist_id !== authenticatedUser.id) {
        return NextResponse.json(
          { error: "Only your own custom exercises can be edited." },
          { status: 403 },
        );
      }
    }

    const body = await request.json().catch(() => null);
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "An exercise object is required" }, { status: 400 });
    }
    const { name, description, video } = body;

    if (typeof name !== "string" || typeof description !== "string" || !name.trim() || !description.trim() || name.trim().length > 255) {
      return NextResponse.json({ error: "name and description are required" }, { status: 400 });
    }
    // A custom exercise's guide video can be removed or replaced by a YouTube
    // video here; a replacement file is uploaded to /api/exercises/[id]/video.
    let youtubeVideoId: string | null | undefined;
    if (video !== undefined) {
      if (existing.is_custom !== true) {
        return NextResponse.json({ error: "Only custom exercises have a guide video." }, { status: 400 });
      }
      if (video?.source === "none") youtubeVideoId = null;
      else if (video?.source === "youtube" && typeof video.embed === "string") {
        youtubeVideoId = parseYouTubeVideoId(video.embed);
        if (!youtubeVideoId) {
          return NextResponse.json({ error: "Paste a YouTube embed code or a YouTube video link." }, { status: 400 });
        }
      } else {
        return NextResponse.json({ error: 'video must be { source: "none" } or { source: "youtube", embed }' }, { status: 400 });
      }
    }

    // A system exercise keeps its name: only its description can be edited.
    const exercise = await updateExercise(id, {
      name: existing.is_custom === true ? name.trim() : undefined,
      description: description.trim(),
    });
    if (!exercise) {
      return NextResponse.json({ error: "Exercise not found" }, { status: 404 });
    }
    if (youtubeVideoId === undefined) return NextResponse.json({ exercise });

    const changed = await setExerciseYouTubeVideo(id, youtubeVideoId);
    if (!changed) return NextResponse.json({ error: "Exercise not found" }, { status: 404 });
    // The replaced upload, captured under the row lock, is no longer used.
    if (changed.previousVideo) {
      await deleteExerciseVideoFile(id, changed.previousVideo.mimeType, changed.previousVideo.fileName).catch((error) =>
        console.error(`Could not remove a replaced exercise video for ${id}:`, error),
      );
    }
    return NextResponse.json({ exercise: changed.exercise });
  } catch (error) {
    if (isMissingColumnError(error)) {
      return NextResponse.json(
        { error: "Exercise videos need scripts/exercises_pg.sql to be run on the database first." },
        { status: 503 },
      );
    }
    console.error("PUT /api/exercises/[id] error:", error);
    return NextResponse.json({ error: "Failed to update exercise" }, { status: 500 });
  }
}

// PATCH — restore an archived custom exercise
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authenticatedUser = await getAuthenticatedUser(request);
    if (!authenticatedUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    if (body.action !== "restore") {
      return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
    }

    const { id } = await params;
    const existing = await getExerciseById(id, true);
    if (!existing || !existing.archived_at) {
      return NextResponse.json({ error: "Archived exercise not found" }, { status: 404 });
    }
    if (!canManageCustom(authenticatedUser, existing)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const exercise = await restoreExercise(id);
    if (!exercise) {
      return NextResponse.json({ error: "Archived exercise not found" }, { status: 404 });
    }
    return NextResponse.json({ exercise });
  } catch (error) {
    console.error("PATCH /api/exercises/[id] error:", error);
    return NextResponse.json({ error: "Failed to restore exercise" }, { status: 500 });
  }
}

// DELETE — archive a custom exercise; with ?permanent=true, permanently delete
// one that is already archived.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authenticatedUser = await getAuthenticatedUser(request);
    if (!authenticatedUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (authenticatedUser.role !== "admin" && authenticatedUser.role !== "therapist") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const permanent = request.nextUrl.searchParams.get("permanent") === "true";

    const existing = await getExerciseById(id, permanent);
    if (!existing) {
      return NextResponse.json({ error: "Exercise not found" }, { status: 404 });
    }
    if (existing.is_custom !== true) {
      return NextResponse.json(
        { error: "Built-in exercises cannot be archived or deleted." },
        { status: 403 },
      );
    }
    if (!canManageCustom(authenticatedUser, existing)) {
      return NextResponse.json(
        { error: "Only your own custom exercises can be archived or deleted." },
        { status: 403 },
      );
    }

    // ?discardNew=true — the add form takes back an exercise it made moments
    // ago when its video upload failed. Only a never-archived exercise from
    // the last ten minutes with no history qualifies, so this is not a way for
    // a therapist to permanently delete an established exercise.
    if (request.nextUrl.searchParams.get("discardNew") === "true") {
      const result = await discardNewExercise(id);
      if (result === "not-new") {
        return NextResponse.json({ error: "Only a just-added exercise can be discarded." }, { status: 409 });
      }
      if (result === "not-found") {
        return NextResponse.json({ error: "Exercise not found" }, { status: 404 });
      }
      if (result === "has-history") {
        return NextResponse.json({ error: "The exercise is already in use and was kept." }, { status: 409 });
      }
      const video = exerciseVideoFileFromRow(existing);
      if (video) await deleteExerciseVideoFile(id, video.mimeType, video.fileName).catch(() => undefined);
      return NextResponse.json({ success: true });
    }

    if (permanent) {
      // Therapists archive and restore their own; only an admin deletes for good.
      if (authenticatedUser.role !== "admin") {
        return NextResponse.json(
          { error: "Only an admin can permanently delete a custom exercise." },
          { status: 403 },
        );
      }
      if (!existing.archived_at) {
        return NextResponse.json(
          { error: "Archive the exercise before deleting it permanently." },
          { status: 409 },
        );
      }
      const result = await deleteArchivedExercise(id);
      if (result === "not-found") {
        return NextResponse.json({ error: "Exercise not found" }, { status: 404 });
      }
      if (result === "has-history") {
        return NextResponse.json(
          {
            error:
              "This exercise was prescribed to patients, so it stays archived to keep their history. It can still be restored.",
          },
          { status: 409 },
        );
      }
      const video = exerciseVideoFileFromRow(existing);
      if (video) await deleteExerciseVideoFile(id, video.mimeType, video.fileName).catch((error) =>
        console.error(`Could not remove the video file of deleted exercise ${id}:`, error),
      );
      return NextResponse.json({ success: true });
    }

    const archived = await archiveExercise(id, authenticatedUser.id);
    if (!archived) {
      return NextResponse.json({ error: "Exercise not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof ExerciseInUseError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("DELETE /api/exercises/[id] error:", error);
    return NextResponse.json({ error: "Failed to delete exercise" }, { status: 500 });
  }
}
