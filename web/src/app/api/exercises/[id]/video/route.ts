import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import {
  canViewExerciseVideo,
  getExerciseById,
  isMissingColumnError,
  setExerciseVideoFile,
} from "@/lib/db";
import {
  MAX_EXERCISE_VIDEO_BYTES,
  exerciseVideoFromRow,
  exerciseVideoFileFromRow,
  isExerciseVideoMimeType,
} from "@/lib/exercises/customVideo";
import { deleteExerciseVideoFile, openExerciseVideo, saveExerciseVideo } from "@/lib/exercises/customVideoStorage";
import { parseRange } from "@/lib/recording/http";

type Context = { params: Promise<{ id: string }> };

// GET /api/exercises/[id]/video — a custom exercise's uploaded video, with
// byte ranges so the player can seek.
export async function GET(request: NextRequest, { params }: Context) {
  const user = await getAuthenticatedUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const exercise = await getExerciseById(id, true);
  const video = exercise ? exerciseVideoFromRow(exercise) : null;
  if (!exercise || video?.kind !== "file" || !(await canViewExerciseVideo(user, exercise))) {
    return NextResponse.json({ error: "Video not found" }, { status: 404 });
  }
  const file = await openExerciseVideo(id, video.mimeType, exerciseVideoFileFromRow(exercise)?.fileName);
  if (!file) return NextResponse.json({ error: "Video not found" }, { status: 404 });

  const headers: Record<string, string> = {
    "Content-Type": video.mimeType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
  };
  const range = parseRange(request.headers.get("range"), file.size);
  if (range === "unsatisfiable") {
    return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${file.size}` } });
  }
  const body = Readable.toWeb(file.stream(range ?? undefined)) as unknown as ReadableStream<Uint8Array>;
  if (!range) {
    return new Response(body, { status: 200, headers: { ...headers, "Content-Length": String(file.size) } });
  }
  return new Response(body, {
    status: 206,
    headers: {
      ...headers,
      "Content-Length": String(range.end - range.start + 1),
      "Content-Range": `bytes ${range.start}-${range.end}/${file.size}`,
    },
  });
}

// PUT /api/exercises/[id]/video — uploads the file itself as the body, with
// Content-Type video/mp4 or video/webm, up to 100 MB. It replaces any video
// the custom exercise had.
export async function PUT(request: NextRequest, { params }: Context) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "admin" && user.role !== "therapist") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await params;
    const exercise = await getExerciseById(id);
    if (!exercise) return NextResponse.json({ error: "Exercise not found" }, { status: 404 });
    if (exercise.is_custom !== true || (user.role === "therapist" && exercise.owner_therapist_id !== user.id)) {
      return NextResponse.json({ error: "Only custom exercises can have an uploaded video." }, { status: 403 });
    }

    const mimeType = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!isExerciseVideoMimeType(mimeType)) {
      return NextResponse.json({ error: "Only MP4 and WebM videos can be uploaded." }, { status: 415 });
    }
    const declaredLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_EXERCISE_VIDEO_BYTES) {
      return NextResponse.json({ error: "The video must be 100 MB or smaller." }, { status: 413 });
    }
    if (!request.body) return NextResponse.json({ error: "No video was sent." }, { status: 400 });

    const saved = await saveExerciseVideo(id, mimeType, request.body);
    if (saved === "too-large") {
      return NextResponse.json({ error: "The video must be 100 MB or smaller." }, { status: 413 });
    }
    if (saved === "bad-signature") {
      return NextResponse.json({ error: "The file is not a valid MP4 or WebM video." }, { status: 415 });
    }
    if (saved === "empty") return NextResponse.json({ error: "No video was sent." }, { status: 400 });

    let updated;
    try {
      updated = await setExerciseVideoFile(id, mimeType, saved.fileName, user.id);
    } catch (error) {
      // A lost connection can leave commit outcome unknown. Retain the staged
      // file in that case: it might already be the metadata-selected guide.
      // A missing-column error definitely did not publish the new reference.
      if (isMissingColumnError(error)) {
        await deleteExerciseVideoFile(id, mimeType, saved.fileName).catch(() => undefined);
      }
      throw error;
    }
    if (!updated) {
      await deleteExerciseVideoFile(id, mimeType, saved.fileName).catch(() => undefined);
      return NextResponse.json({ error: "Exercise not found" }, { status: 404 });
    }
    // The superseded video, captured under the row lock, went to Recently
    // Deleted with its file kept, so an admin can restore it.
    return NextResponse.json({ exercise: updated.exercise });
  } catch (error) {
    if (isMissingColumnError(error)) {
      return NextResponse.json(
        { error: "Exercise videos need scripts/exercises_pg.sql to be run on the database first." },
        { status: 503 },
      );
    }
    console.error("PUT /api/exercises/[id]/video error:", error);
    return NextResponse.json({ error: "Failed to upload the video" }, { status: 500 });
  }
}
