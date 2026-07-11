import { NextRequest, NextResponse } from "next/server";
import { deleteExercise, getExercises, updateExercise } from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth-server";

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

    if (authenticatedUser.role === "therapist") {
      const existing = (await getExercises()).find((exercise) => exercise.id === id);
      if (!existing) {
        return NextResponse.json({ error: "Exercise not found" }, { status: 404 });
      }
      if (existing.is_custom !== true) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

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

    if (authenticatedUser.role === "therapist") {
      const existing = (await getExercises()).find((exercise) => exercise.id === id);
      if (!existing) {
        return NextResponse.json({ error: "Exercise not found" }, { status: 404 });
      }
      if (existing.is_custom !== true) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    await deleteExercise(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/exercises/[id] error:", error);
    return NextResponse.json({ error: "Failed to delete exercise" }, { status: 500 });
  }
}
