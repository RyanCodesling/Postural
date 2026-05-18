import { NextRequest, NextResponse } from "next/server";
import { updateExercise, deleteExercise } from "@/lib/db";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { name, description } = body;

    if (!name?.trim() || !description?.trim()) {
      return NextResponse.json({ error: "name and description are required" }, { status: 400 });
    }

    const exercise = await updateExercise(id, { name: name.trim(), description: description.trim() });
    if (!exercise) {
      return NextResponse.json({ error: "Exercise not found" }, { status: 404 });
    }
    return NextResponse.json({ exercise });
  } catch (error) {
    console.error("PUT /api/exercises/[id] error:", error);
    return NextResponse.json({ error: "Failed to update exercise" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await deleteExercise(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/exercises/[id] error:", error);
    return NextResponse.json({ error: "Failed to delete exercise" }, { status: 500 });
  }
}
