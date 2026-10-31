import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { parsePreSessionPain, SESSION_VIDEO_NOTICE_VERSION } from "@/lib/prescriptionContext";
import { createCustomExerciseSession, SessionNotScheduledError } from "@/lib/db";

// POST /api/sessions/manual — a patient starts today's custom exercise. The
// session holds the pain answer given before starting and, with consent, the
// video. It is ended through PATCH /api/sessions/[id] like a camera session
// (completed, ended early, or stopped for pain) and takes a pain report after.
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
    const preSessionPain = parsePreSessionPain(body?.preSessionPain);
    if (!preSessionPain.ok) return NextResponse.json({ error: preSessionPain.error }, { status: 400 });
    // Recording is opt-in per session; only an explicit true records consent.
    if (body?.videoConsent !== undefined && typeof body.videoConsent !== "boolean") {
      return NextResponse.json({ error: "videoConsent must be true or false" }, { status: 400 });
    }
    if (body?.videoConsentRemembered !== undefined && typeof body.videoConsentRemembered !== "boolean") {
      return NextResponse.json({ error: "videoConsentRemembered must be true or false" }, { status: 400 });
    }
    // Consent counts only for the notice the patient was shown, as for camera sessions.
    if (body?.videoConsent === true && body?.videoNotice !== SESSION_VIDEO_NOTICE_VERSION) {
      return NextResponse.json(
        {
          error: "The video notice has been updated. Reload this page to read it, then start again.",
          code: "video_notice_changed",
        },
        { status: 409 },
      );
    }

    const session = await createCustomExerciseSession({
      patientId: user.id,
      patientExerciseId,
      occurrenceId,
      exerciseId,
      deviceInfo: body?.deviceInfo,
      preSessionPain: preSessionPain.value,
      videoConsent: body?.videoConsent === true
        ? {
            consentedAt: new Date().toISOString(),
            notice: SESSION_VIDEO_NOTICE_VERSION,
            remembered: body.videoConsentRemembered === true,
          }
        : undefined,
    });
    return NextResponse.json({ sessionId: session.id, startedAt: session.startedAt });
  } catch (error) {
    if (error instanceof SessionNotScheduledError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("POST /api/sessions/manual error:", error);
    return NextResponse.json({ error: "Failed to start the session" }, { status: 500 });
  }
}
