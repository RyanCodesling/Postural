import { NextRequest, NextResponse } from "next/server";
import { getPatientExercises, getUsers, assignExercisesToPatient } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const authToken = request.cookies.get("auth_token");
    if (!authToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = JSON.parse(authToken.value);

    // Therapist: must supply ?patientId= and the patient must be assigned to them
    if (user.role === "therapist") {
      const patientId = request.nextUrl.searchParams.get("patientId");
      if (!patientId) {
        return NextResponse.json({ error: "patientId is required" }, { status: 400 });
      }

      // Verify the id belongs to a patient assigned to this therapist
      const assignedPatients = await getUsers({ role: "patient", therapistId: user.id });
      const isAssigned = assignedPatients.some((p) => p.id === patientId);
      if (!isAssigned) {
        return NextResponse.json({ error: "Patient not found or not assigned to you" }, { status: 403 });
      }

      const exercises = await getPatientExercises(patientId);
      return NextResponse.json({ exercises });
    }

    // Patient: gets only their own exercises
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

export async function POST(request: NextRequest) {
  try {
    const authToken = request.cookies.get("auth_token");
    if (!authToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const user = JSON.parse(authToken.value);
    if (user.role !== "therapist") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const { patientId, exercises } = body;

    if (!patientId || !Array.isArray(exercises) || exercises.length === 0) {
      return NextResponse.json({ error: "patientId and exercises are required" }, { status: 400 });
    }

    const assignedPatients = await getUsers({ role: "patient", therapistId: user.id });
    const isAssigned = assignedPatients.some((p) => p.id === patientId);
    if (!isAssigned) {
      return NextResponse.json({ error: "Patient not assigned to you" }, { status: 403 });
    }

    await assignExercisesToPatient(patientId, exercises);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("POST /api/patient-exercises error:", error);
    return NextResponse.json({ error: "Failed to assign exercises" }, { status: 500 });
  }
}
