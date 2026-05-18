import { NextRequest, NextResponse } from "next/server";
import { getExercises, createExercise, getNextExerciseId } from "@/lib/db";

export async function GET() {
  try {
    const exercises = await getExercises();
    return NextResponse.json({ exercises });
  } catch (error) {
    console.error("GET /api/exercises error:", error);
    return NextResponse.json({ error: "Failed to fetch exercises" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, description, isCustom } = body;

    if (!name?.trim() || !description?.trim()) {
      return NextResponse.json({ error: "name and description are required" }, { status: 400 });
    }

    const id = await getNextExerciseId();
    const exercise = await createExercise({ id, name: name.trim(), description: description.trim(), isCustom: isCustom ?? false });
    return NextResponse.json({ exercise }, { status: 201 });
  } catch (error) {
    console.error("POST /api/exercises error:", error);
    return NextResponse.json({ error: "Failed to create exercise" }, { status: 500 });
  }
}
