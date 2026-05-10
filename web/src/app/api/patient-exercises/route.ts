import { NextRequest, NextResponse } from "next/server";
import { getPatientExercises } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const authToken = request.cookies.get("auth_token");
    if (!authToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = JSON.parse(authToken.value);
    if (user.role !== "patient") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const exercises = await getPatientExercises(user.id);
    return NextResponse.json({ exercises });
  } catch (error) {
    console.error("GET /api/patient-exercises error:", error);
    return NextResponse.json({ error: "Failed to fetch exercises" }, { status: 500 });
  }
}
