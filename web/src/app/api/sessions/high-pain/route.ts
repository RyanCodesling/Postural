import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { parsePreSessionPain, PRE_SESSION_PAIN_BLOCK_SCORE } from "@/lib/prescriptionContext";
import { recordHighPainNoStart, SessionNotScheduledError } from "@/lib/db";

// POST /api/sessions/high-pain — the patient's pain score before starting was
// PRE_SESSION_PAIN_BLOCK_SCORE or higher and they pressed Okay on the warning.
// Today's exercise is recorded as not started because of pain, and the
// assigned therapist is notified in the app and by email.
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "patient") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await request.json().catch(() => null);
    const patientExerciseId = Number(body?.patientExerciseId);
    const occurrenceId = Number(body?.occurrenceId);
    const exerciseId = body?.exerciseId;
    if (
      !Number.isInteger(patientExerciseId) || patientExerciseId < 1 ||
      !Number.isInteger(occurrenceId) || occurrenceId < 1 ||
      typeof exerciseId !== "string"
    ) {
      return NextResponse.json(
        { error: "patientExerciseId (integer), occurrenceId (integer), and exerciseId (string) are required" },
        { status: 400 },
      );
    }
    const pain = parsePreSessionPain(body?.preSessionPain);
    if (!pain.ok) return NextResponse.json({ error: pain.error }, { status: 400 });
    if (pain.value?.status !== "reported" || pain.value.score < PRE_SESSION_PAIN_BLOCK_SCORE) {
      return NextResponse.json(
        { error: `A pain score of ${PRE_SESSION_PAIN_BLOCK_SCORE} or higher is required.` },
        { status: 400 },
      );
    }

    const result = await recordHighPainNoStart({
      patientId: user.id,
      patientExerciseId,
      occurrenceId,
      exerciseId,
      pain: { score: pain.value.score, bodyArea: pain.value.bodyArea },
      deviceInfo: body?.deviceInfo,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof SessionNotScheduledError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("POST /api/sessions/high-pain error:", error);
    return NextResponse.json({ error: "The exercise could not be recorded. Please try again." }, { status: 500 });
  }
}
