import { NextRequest, NextResponse } from "next/server";
import { getExercises, createExercise, getNextExerciseId } from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { DEPRECATED_EXERCISE_IDS } from "@/lib/exercises/deprecated";

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

    const all = await getExercises();
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
    const { name, description, isCustom } = body;

    if (!name?.trim() || !description?.trim()) {
      return NextResponse.json({ error: "name and description are required" }, { status: 400 });
    }

    const id = await getNextExerciseId();
    const exercise = await createExercise({
      id,
      name: name.trim(),
      description: description.trim(),
      isCustom: authenticatedUser.role === "therapist" ? true : isCustom ?? false,
    });
    return NextResponse.json({ exercise }, { status: 201 });
  } catch (error) {
    console.error("POST /api/exercises error:", error);
    return NextResponse.json({ error: "Failed to create exercise" }, { status: 500 });
  }
}
