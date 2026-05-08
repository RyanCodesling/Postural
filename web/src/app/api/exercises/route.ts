import { NextRequest, NextResponse } from "next/server";
import { getExercises, createExercise } from "@/lib/db";

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
    const { name, description } = body;

    if (!name || !description) {
      return NextResponse.json({ error: "name and description are required" }, { status: 400 });
    }

    const id = `ex_${Date.now()}`;
    const exercise = await createExercise({ id, name, description });
    return NextResponse.json({ exercise }, { status: 201 });
  } catch (error) {
    console.error("POST /api/exercises error:", error);
    return NextResponse.json({ error: "Failed to create exercise" }, { status: 500 });
  }
}
