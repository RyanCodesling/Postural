import { NextRequest, NextResponse } from "next/server";
import { getTherapistRoster, getPrograms } from "@/lib/db";

function getSessionUser(request: NextRequest) {
  const authToken = request.cookies.get("auth_token");
  if (!authToken) return null;
  try {
    return JSON.parse(authToken.value);
  } catch {
    return null;
  }
}

// GET /api/therapist/overview — home-dashboard rollup for the signed-in
// therapist: a per-patient activity roster + the therapist's program count.
// Therapist-only.
export async function GET(request: NextRequest) {
  try {
    const user = getSessionUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "therapist") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const [patients, programs] = await Promise.all([
      getTherapistRoster(user.id),
      getPrograms(user.id),
    ]);

    return NextResponse.json({ patients, programCount: programs.length });
  } catch (error) {
    console.error("GET /api/therapist/overview error:", error);
    return NextResponse.json({ error: "Failed to load overview" }, { status: 500 });
  }
}
