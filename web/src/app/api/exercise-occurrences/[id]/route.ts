import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import {
  completeManualOccurrence,
  createNotification,
  ManualOccurrenceNotCompletableError,
} from "@/lib/db";

// PATCH /api/exercise-occurrences/[id] — patient acknowledgement for a custom
// manual task. Camera-monitored exercises must still complete through a session.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "patient") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const occurrenceId = Number(id);
    if (!Number.isInteger(occurrenceId)) {
      return NextResponse.json({ error: "Invalid occurrence id" }, { status: 400 });
    }

    const completed = await completeManualOccurrence(occurrenceId, user.id);
    if (completed.therapistId) {
      await createNotification(
        completed.therapistId,
        "Manual Exercise Completed",
        `${user.name} marked ${completed.exerciseName} complete.`,
        "manual_exercise_completed",
        occurrenceId,
      );
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof ManualOccurrenceNotCompletableError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("PATCH /api/exercise-occurrences/[id] error:", error);
    return NextResponse.json({ error: "Failed to complete manual exercise" }, { status: 500 });
  }
}
