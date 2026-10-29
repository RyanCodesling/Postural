import { NextRequest, NextResponse } from "next/server";
import { getExercises, createExercise, getNextExerciseId, isMissingColumnError } from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { DEPRECATED_EXERCISE_IDS } from "@/lib/exercises/deprecated";
import { parseYouTubeVideoId } from "@/lib/exercises/customVideo";

/**
 * Exercise IDs that are deprecated and should not appear in catalog-listing
 * surfaces (therapist assignment dropdown, programs builder, patient active
 * exercise flow, staff debug dropdown, etc.). Their rows stay in the
 * `exercises` table for audit/history and can be returned through explicit
 * `includeDeprecated=true` opt-ins.
 *
 * Added 2026-05-21 for the EX_SWAP. See `registry.ts` for the matching
 * `@deprecated` JSDoc on the registry entries themselves.
 */
export async function GET(request: NextRequest) {
  try {
    const authenticatedUser = await getAuthenticatedUser(request);
    if (!authenticatedUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Special-case opt-in for callers that need the full catalog (e.g., a
    // future historical view that wants to render a patient's past
    // assignments including deprecated ones). Defaults to false so the
    // common assignment-flow case gets the filtered list automatically.
    const includeDeprecated =
      request.nextUrl.searchParams.get("includeDeprecated") === "true";

    // With includeArchived, the Archived column's rows come too: every archived
    // exercise for an admin, and a therapist's own archived custom exercises.
    const includeArchived =
      (authenticatedUser.role === "admin" || authenticatedUser.role === "therapist") &&
      request.nextUrl.searchParams.get("includeArchived") === "true";
    const all = (await getExercises({ includeArchived })).filter(
      (e) =>
        !e.archived_at ||
        authenticatedUser.role === "admin" ||
        e.owner_therapist_id === authenticatedUser.id,
    );
    const exercises = includeDeprecated
      ? all
      : all.filter((e) => !DEPRECATED_EXERCISE_IDS.has(e.id));

    return NextResponse.json({ exercises });
  } catch (error) {
    console.error("GET /api/exercises error:", error);
    return NextResponse.json({ error: "Failed to fetch exercises" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const authenticatedUser = await getAuthenticatedUser(request);
    if (!authenticatedUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (authenticatedUser.role !== "admin" && authenticatedUser.role !== "therapist") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const { name, description, isCustom, youtubeEmbed } = body;

    if (!name?.trim() || !description?.trim()) {
      return NextResponse.json({ error: "name and description are required" }, { status: 400 });
    }

    const custom = authenticatedUser.role === "therapist" || isCustom === true;
    let youtubeVideoId: string | null = null;
    if (typeof youtubeEmbed === "string" && youtubeEmbed.trim() !== "") {
      if (!custom) {
        return NextResponse.json({ error: "Only custom exercises can have a video." }, { status: 400 });
      }
      youtubeVideoId = parseYouTubeVideoId(youtubeEmbed);
      if (!youtubeVideoId) {
        return NextResponse.json(
          { error: "Paste a YouTube embed code or a YouTube video link." },
          { status: 400 },
        );
      }
    }

    const id = await getNextExerciseId();
    const exercise = await createExercise({
      id,
      name: name.trim(),
      description: description.trim(),
      isCustom: custom,
      ownerTherapistId: authenticatedUser.role === "therapist" ? authenticatedUser.id : null,
      monitoringMode: custom ? "manual" : "camera",
      youtubeVideoId,
    });
    return NextResponse.json({ exercise }, { status: 201 });
  } catch (error) {
    if (isMissingColumnError(error)) {
      return NextResponse.json(
        { error: "Exercise videos need scripts/exercises_pg.sql to be run on the database first." },
        { status: 503 },
      );
    }
    console.error("POST /api/exercises error:", error);
    return NextResponse.json({ error: "Failed to create exercise" }, { status: 500 });
  }
}
