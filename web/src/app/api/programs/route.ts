import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getPrograms, createProgram, ProgramExerciseNotAllowedError } from "@/lib/db";
import { parseProgramExerciseInputs } from "@/lib/programExerciseInput";

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "therapist") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const programs = await getPrograms(user.id);
    return NextResponse.json({ programs });
  } catch (error) {
    console.error("GET /api/programs error:", error);
    return NextResponse.json({ error: "Failed to fetch programs" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "therapist") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await request.json();
    const { name, exercises } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: "Program name is required" }, { status: 400 });
    }
    if (!Array.isArray(exercises) || exercises.length === 0) {
      return NextResponse.json({ error: "At least one exercise is required" }, { status: 400 });
    }

    let normalizedExercises;
    try {
      normalizedExercises = parseProgramExerciseInputs(exercises);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Invalid program exercises." },
        { status: 400 },
      );
    }

    const id = await createProgram({
      therapistId: user.id,
      name: name.trim(),
      exercises: normalizedExercises,
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    if (error instanceof ProgramExerciseNotAllowedError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("POST /api/programs error:", error);
    return NextResponse.json({ error: "Failed to create program" }, { status: 500 });
  }
}
