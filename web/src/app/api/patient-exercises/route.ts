import { NextRequest, NextResponse } from "next/server";
import {
  DEFAULT_REST_SECONDS,
  DEFAULT_HOLD_SECONDS,
  assignExercisesToPatient,
  deletePatientExercises,
  getPatientExercises,
  getUsers,
} from "@/lib/db";
import { DEPRECATED_EXERCISE_IDS } from "@/lib/exercises/deprecated";

type PatientExerciseAssignmentRequest = {
  exerciseId?: unknown;
  sets?: unknown;
  reps?: unknown;
  restSeconds?: unknown;
  scheduledDate?: unknown;
  holdSeconds?: unknown;
};

export async function GET(request: NextRequest) {
  try {
    const authToken = request.cookies.get("auth_token");
    if (!authToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = JSON.parse(authToken.value);
    const includeDeprecated =
      request.nextUrl.searchParams.get("includeDeprecated") === "true";
    const filterDeprecated = <T extends { exercise_id: string }>(exercises: T[]) =>
      includeDeprecated
        ? exercises
        : exercises.filter((exercise) => !DEPRECATED_EXERCISE_IDS.has(exercise.exercise_id));

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

      const exercises = filterDeprecated(await getPatientExercises(patientId));
      return NextResponse.json({ exercises });
    }

    // Patient: gets only their own exercises
    if (user.role !== "patient") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const exercises = filterDeprecated(await getPatientExercises(user.id));
    return NextResponse.json({ exercises });
  } catch (error) {
    console.error("GET /api/patient-exercises error:", error);
    return NextResponse.json({ error: "Failed to fetch exercises" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const authToken = request.cookies.get("auth_token");
    if (!authToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const user = JSON.parse(authToken.value);
    if (user.role !== "therapist") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const { patientId, exerciseIds } = body;

    if (!patientId || !Array.isArray(exerciseIds) || exerciseIds.length === 0) {
      return NextResponse.json({ error: "patientId and exerciseIds are required" }, { status: 400 });
    }

    // Verify the patient belongs to this therapist
    const assignedPatients = await getUsers({ role: "patient", therapistId: user.id });
    const isAssigned = assignedPatients.some((p) => p.id === patientId);
    if (!isAssigned) {
      return NextResponse.json({ error: "Patient not assigned to you" }, { status: 403 });
    }

    await deletePatientExercises(patientId, exerciseIds as string[]);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/patient-exercises error:", error);
    return NextResponse.json({ error: "Failed to delete exercises" }, { status: 500 });
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

    const normalizedExercises = exercises.map((rawExercise: unknown) => {
      const exercise =
        rawExercise !== null && typeof rawExercise === "object"
          ? (rawExercise as PatientExerciseAssignmentRequest)
          : {};
      const restSeconds =
        typeof exercise.restSeconds === "number" &&
        Number.isFinite(exercise.restSeconds) &&
        exercise.restSeconds >= 0
          ? Math.floor(exercise.restSeconds)
          : DEFAULT_REST_SECONDS;
      const holdSeconds =
        typeof exercise.holdSeconds === "number" &&
        Number.isFinite(exercise.holdSeconds) &&
        exercise.holdSeconds >= 1
          ? Math.floor(exercise.holdSeconds)
          : DEFAULT_HOLD_SECONDS;

      const scheduledDate =
        typeof exercise.scheduledDate === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(exercise.scheduledDate)
          ? exercise.scheduledDate
          : undefined;

      return {
        exerciseId: exercise.exerciseId,
        sets: exercise.sets,
        reps: exercise.reps,
        restSeconds,
        scheduledDate,
        holdSeconds,
      };
    });

    const invalidExercise = normalizedExercises.find(
      (exercise) =>
        typeof exercise.exerciseId !== "string" ||
        exercise.exerciseId.trim().length === 0 ||
        typeof exercise.sets !== "number" ||
        !Number.isFinite(exercise.sets) ||
        exercise.sets < 1 ||
        typeof exercise.reps !== "number" ||
        !Number.isFinite(exercise.reps) ||
        exercise.reps < 1,
    );
    if (invalidExercise) {
      return NextResponse.json(
        { error: "Each exercise requires exerciseId, sets, and reps" },
        { status: 400 },
      );
    }

    await assignExercisesToPatient(
      patientId,
      normalizedExercises.map((exercise) => ({
        exerciseId:    exercise.exerciseId    as string,
        sets:          Math.floor(exercise.sets as number),
        reps:          Math.floor(exercise.reps as number),
        restSeconds:   exercise.restSeconds,
        scheduledDate: exercise.scheduledDate as string | undefined,
        holdSeconds: exercise.holdSeconds,
      })),
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("POST /api/patient-exercises error:", error);
    return NextResponse.json({ error: "Failed to assign exercises" }, { status: 500 });
  }
}
