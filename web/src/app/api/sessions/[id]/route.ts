import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import {
  endSession,
  getSessionOwner,
  getSessionDetail,
  getUsers,
} from "@/lib/db";

// GET /api/sessions/[id] — full drill-down (sets + reps) for one session.
//   patient   → only their own session.
//   therapist → only if the owning patient is assigned to them.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const sessionId = Number(id);
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!Number.isInteger(sessionId)) {
      return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
    }

    const owner = await getSessionOwner(sessionId);
    if (owner === null) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    if (user.role === "patient") {
      if (owner !== user.id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    } else if (user.role === "therapist") {
      const assignedPatients = await getUsers({ role: "patient", therapistId: user.id });
      if (!assignedPatients.some((p) => p.id === owner)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    } else {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const session = await getSessionDetail(sessionId);
    return NextResponse.json({ session });
  } catch (error) {
    console.error("GET /api/sessions/[id] error:", error);
    return NextResponse.json({ error: "Failed to fetch session" }, { status: 500 });
  }
}

// PATCH /api/sessions/[id] — mark a session ended (stamps ended_at). Patient-only
// and only for the patient's own sessions.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const sessionId = Number(id);
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "patient") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (!Number.isInteger(sessionId)) {
      return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
    }

    const owner = await getSessionOwner(sessionId);
    if (owner === null) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    if (owner !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const allowedKeys = new Set([
      "captureQualitySummary",
      "notes",
      "completed",
      "endReason",
    ]);
    const unknownKeys = Object.keys(body).filter((key) => !allowedKeys.has(key));
    if (unknownKeys.length > 0) {
      return NextResponse.json(
        { error: `Unsupported fields: ${unknownKeys.join(", ")}` },
        { status: 400 },
      );
    }
    if (body.completed !== true && body.endReason !== "user" && body.endReason !== "pain") {
      return NextResponse.json(
        { error: "Incomplete sessions require endReason user or pain." },
        { status: 400 },
      );
    }
    if (
      body.completed === true &&
      body.endReason !== undefined &&
      body.endReason !== "completed"
    ) {
      return NextResponse.json(
        { error: "Completed sessions cannot use another end reason." },
        { status: 400 },
      );
    }
    const transitioned = await endSession(sessionId, {
      captureQualitySummary: body?.captureQualitySummary,
      notes: typeof body?.notes === "string" ? body.notes : undefined,
      completed: body?.completed === true,
      endReason:
        body?.endReason === "user" || body?.endReason === "pain"
          ? body.endReason
          : undefined,
    });
    return NextResponse.json({ success: true, transitioned });
  } catch (error) {
    console.error("PATCH /api/sessions/[id] error:", error);
    return NextResponse.json({ error: "Failed to end session" }, { status: 500 });
  }
}
