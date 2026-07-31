import { NextRequest, NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth-server";
import {
  PainReportConflictError,
  getSessionOwner,
  putPainReport,
} from "@/lib/db";
import type { PainTiming } from "@/lib/prescriptionContext";

export async function PUT(
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
    if ((await getSessionOwner(sessionId)) !== user.id) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const body = await request.json().catch(() => null);
    if (!body || (body.status !== "declined" && body.status !== "reported")) {
      return NextResponse.json(
        { error: "status must be reported or declined" },
        { status: 400 },
      );
    }

    if (body.status === "declined") {
      await putPainReport(sessionId, user.id, { status: "declined" });
    } else {
      const score = Number(body.score);
      const timing: PainTiming | null =
        body.timing === null || body.timing === undefined || body.timing === ""
          ? null
          : body.timing;
      const bodyArea =
        typeof body.bodyArea === "string" && body.bodyArea.trim()
          ? body.bodyArea.trim()
          : null;
      if (!Number.isInteger(score) || score < 0 || score > 10) {
        return NextResponse.json(
          { error: "Pain score must be a whole number from 0 to 10." },
          { status: 400 },
        );
      }
      if (
        timing !== null &&
        timing !== "during" &&
        timing !== "after" &&
        timing !== "both"
      ) {
        return NextResponse.json({ error: "Invalid pain timing." }, { status: 400 });
      }
      if (bodyArea !== null && bodyArea.length > 80) {
        return NextResponse.json(
          { error: "Body area must be 80 characters or fewer." },
          { status: 400 },
        );
      }
      await putPainReport(sessionId, user.id, {
        status: "reported",
        score,
        timing,
        bodyArea,
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof PainReportConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("PUT /api/sessions/[id]/pain-report error:", error);
    return NextResponse.json({ error: "Failed to save pain report" }, { status: 500 });
  }
}
