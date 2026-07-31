import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import {
  createSession,
  getSessionsForPatient,
  getUsers,
  SessionNotScheduledError,
} from "@/lib/db";

// GET /api/sessions — session history summaries.
//   patient   → own sessions.
//   therapist → ?patientId= (must be one of their assigned patients).
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    if (user.role === "patient") {
      const sessions = await getSessionsForPatient(user.id);
      return NextResponse.json({ sessions });
    }

    if (user.role === "therapist") {
      const patientId = request.nextUrl.searchParams.get("patientId");
      if (!patientId) {
        return NextResponse.json({ error: "patientId is required" }, { status: 400 });
      }
      const assignedPatients = await getUsers({ role: "patient", therapistId: user.id });
      if (!assignedPatients.some((p) => p.id === patientId)) {
        return NextResponse.json(
          { error: "Patient not found or not assigned to you" },
          { status: 403 },
        );
      }
      const sessions = await getSessionsForPatient(patientId);
      return NextResponse.json({ sessions });
    }

    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  } catch (error) {
    console.error("GET /api/sessions error:", error);
    return NextResponse.json({ error: "Failed to fetch sessions" }, { status: 500 });
  }
}

// POST /api/sessions — start a session. Patient-only: the session is tied to
// one of the patient's own assigned exercises (patient_exercise_id). The staff
// debug catalog has no patient_exercises row, so it never calls this.
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "patient") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const patientExerciseId = Number(body?.patientExerciseId);
    const occurrenceId = Number(body?.occurrenceId);
    const exerciseId = body?.exerciseId;

    if (
      !Number.isInteger(patientExerciseId) ||
      patientExerciseId < 1 ||
      !Number.isInteger(occurrenceId) ||
      occurrenceId < 1 ||
      typeof exerciseId !== "string"
    ) {
      return NextResponse.json(
        {
          error:
            "patientExerciseId (integer), occurrenceId (integer), and exerciseId (string) are required",
        },
        { status: 400 },
      );
    }

    const session = await createSession({
      patientId: user.id,
      patientExerciseId,
      occurrenceId,
      exerciseId,
      deviceInfo: body?.deviceInfo,
    });
    return NextResponse.json({
      sessionId: session.id,
      startedAt: session.startedAt,
      runtimePrescription: session.runtimePrescription,
      context: session.context,
    });
  } catch (error) {
    // Strict schedule lock: nothing actionable for this exercise today.
    if (error instanceof SessionNotScheduledError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("POST /api/sessions error:", error);
    return NextResponse.json({ error: "Failed to create session" }, { status: 500 });
  }
}
