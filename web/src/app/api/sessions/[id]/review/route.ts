import { NextRequest, NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth-server";
import {
  SessionReviewUnavailableError,
  appendSessionReview,
} from "@/lib/db";
import type { TherapistReviewLabel } from "@/lib/prescriptionContext";

const REVIEW_LABELS = new Set<TherapistReviewLabel>([
  "agree",
  "worse_than_score",
  "better_than_score",
]);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const sessionId = Number(id);
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "therapist") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (!Number.isInteger(sessionId)) {
      return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
    }
    const body = await request.json().catch(() => null);
    const label = body?.label as TherapistReviewLabel | undefined;
    if (!label || !REVIEW_LABELS.has(label)) {
      return NextResponse.json({ error: "Invalid review label." }, { status: 400 });
    }

    const review = await appendSessionReview(sessionId, user.id, label);
    return NextResponse.json({ review }, { status: review.idempotent ? 200 : 201 });
  } catch (error) {
    if (error instanceof SessionReviewUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    const message = error instanceof Error ? error.message : "";
    if (message === "Session not found or forbidden.") {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    console.error("POST /api/sessions/[id]/review error:", error);
    return NextResponse.json({ error: "Failed to save review" }, { status: 500 });
  }
}
