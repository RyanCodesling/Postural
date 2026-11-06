import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import {
  DEFAULT_REST_SECONDS,
  DEFAULT_HOLD_SECONDS,
  ExerciseAssignmentNotAllowedError,
  assignExercisesToPatient,
  archivePatientExercises,
  getPatientExercises,
  getPatientOccurrences,
  getUsers,
  getUserById,
  createNotification,
  getEffectiveNow,
} from "@/lib/db";
import {
  sendRemovedExercisesEmail,
  sendAssignedExercisesChangedEmail,
  sendAssignedExercisesEmail,
} from "@/lib/email";
import { diffAssignedExercises, toPrescriptionDetail, type PrescriptionRow } from "@/lib/exercises/prescriptionEmail";
import {
  assignedExercisesMessage,
  changedExercisesMessage,
  removedExercisesMessage,
} from "@/lib/notificationText";
import { DEPRECATED_EXERCISE_IDS } from "@/lib/exercises/deprecated";
import { maxPrescriptionSets, prescriptionCountError } from "@/lib/prescriptionLimits";
import { pastScheduleDate, storedScheduleDates } from "@/lib/exercises/scheduleDates";
import {
  MAX_RECURRENCE_SPAN_DAYS,
  MAX_INTERVAL_DAYS,
  isDateKey,
  spanDays,
  type Recurrence,
} from "@/lib/exercises/occurrences";
import {
  parsePrescribedSide,
  parseResistanceContext,
} from "@/lib/prescriptionContext";

type PatientExerciseAssignmentRequest = {
  exerciseId?: unknown;
  sets?: unknown;
  reps?: unknown;
  restSeconds?: unknown;
  scheduledDate?: unknown;
  holdSeconds?: unknown;
  recurrence?: unknown;
  intervalDays?: unknown;
  weekdays?: unknown;
  endDate?: unknown;
  sequenceIndex?: unknown;
  prescribedSide?: unknown;
  resistanceType?: unknown;
  resistanceValue?: unknown;
  resistanceUnit?: unknown;
  resistanceLabel?: unknown;
};

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
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

      const includeArchived = request.nextUrl.searchParams.get("includeArchived") === "true";
      const [patientExercises, occurrences] = await Promise.all([
        getPatientExercises(patientId, { includeArchived }),
        getPatientOccurrences(patientId),
      ]);
      return NextResponse.json({
        exercises: filterDeprecated(patientExercises),
        occurrences: filterDeprecated(occurrences),
      });
    }

    // Patient: gets only their own exercises
    if (user.role !== "patient") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const [exercises, occurrences] = await Promise.all([
      getPatientExercises(user.id),
      getPatientOccurrences(user.id),
    ]);
    return NextResponse.json({
      exercises: filterDeprecated(exercises),
      occurrences: filterDeprecated(occurrences),
    });
  } catch (error) {
    console.error("GET /api/patient-exercises error:", error);
    return NextResponse.json({ error: "Failed to fetch exercises" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

    const before = await getPatientExercises(patientId);
    await archivePatientExercises(patientId, exerciseIds as string[], user.id);

    // Email the patient and the therapist which prescriptions were actually removed.
    try {
      const remaining = new Set((await getPatientExercises(patientId)).map((row) => row.exercise_id));
      const removed = (before as PrescriptionRow[])
        .filter((row) => (exerciseIds as string[]).includes(row.exercise_id as string) && !remaining.has(row.exercise_id))
        .map(toPrescriptionDetail);
      if (removed.length > 0) {
        await createNotification(
          patientId,
          "Exercises Removed",
          removedExercisesMessage(user.name, removed.map((d) => d.exerciseName)),
          "therapist_removed_exercises",
        ).catch((err) => console.error("Failed to create removed exercises notification:", err));
        const patient = await getUserById(patientId);
        if (patient?.email) {
          sendRemovedExercisesEmail(patient.email as string, patient.name as string, "patient", user.name, removed).catch(console.error);
        }
        if (user.email) {
          sendRemovedExercisesEmail(user.email as string, user.name, "therapist", (patient?.name as string) ?? "your patient", removed).catch(console.error);
        }
      }
    } catch (err) {
      console.error("Failed to send removed exercises emails:", err);
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/patient-exercises error:", error);
    return NextResponse.json({ error: "Failed to delete exercises" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

    let normalizedExercises;
    try {
      normalizedExercises = exercises.map((rawExercise: unknown, index: number) => {
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

      // Recurrence: 'interval' (every N days) or 'weekly' (weekday set). Both
      // carry an inclusive window end. Malformed values are normalized here and
      // rejected below so a bad rule never reaches occurrence generation.
      const recurrence: Recurrence =
        exercise.recurrence === "weekly" ? "weekly" : "interval";
      const intervalDays =
        typeof exercise.intervalDays === "number" && Number.isFinite(exercise.intervalDays)
          ? Math.floor(exercise.intervalDays)
          : undefined;
      const weekdays = Array.isArray(exercise.weekdays)
        ? Array.from(
            new Set(
              exercise.weekdays.filter(
                (d): d is number => Number.isInteger(d) && d >= 0 && d <= 6,
              ),
            ),
          )
        : [];
      const endDate = isDateKey(exercise.endDate) ? exercise.endDate : undefined;
      const sequenceIndex =
        exercise.sequenceIndex === undefined || exercise.sequenceIndex === null
          ? index + 1
          : Number(exercise.sequenceIndex);

      return {
        exerciseId: exercise.exerciseId,
        sets: exercise.sets,
        reps: exercise.reps,
        restSeconds,
        scheduledDate,
        holdSeconds,
        recurrence,
        intervalDays,
        weekdays,
        endDate,
        sequenceIndex,
        prescribedSide: parsePrescribedSide(exercise.prescribedSide),
        resistance: parseResistanceContext(exercise),
      };
      });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Invalid movement context." },
        { status: 400 },
      );
    }

    const invalidCounts = normalizedExercises
      .map((exercise) =>
        prescriptionCountError(exercise.sets, exercise.reps, {
          maxSets: maxPrescriptionSets(exercise.exerciseId),
        }),
      )
      .find((error) => error !== null);
    if (invalidCounts) {
      return NextResponse.json({ error: invalidCounts }, { status: 400 });
    }

    const invalidExercise = normalizedExercises.find(
      (exercise) =>
        typeof exercise.exerciseId !== "string" ||
        exercise.exerciseId.trim().length === 0 ||
        !Number.isInteger(exercise.sequenceIndex) ||
        exercise.sequenceIndex < 1,
    );
    if (invalidExercise) {
      return NextResponse.json(
        { error: "Each exercise requires exerciseId, sets, and reps" },
        { status: 400 },
      );
    }

    const sequenceIndexes = normalizedExercises.map((exercise) => exercise.sequenceIndex);
    if (new Set(sequenceIndexes).size !== sequenceIndexes.length) {
      return NextResponse.json(
        { error: "Exercise order values must be unique." },
        { status: 400 },
      );
    }

    const today = (await getEffectiveNow()).toLocaleDateString("en-CA", {
      timeZone: "Asia/Manila",
    });
    const existingAssignments = await getPatientExercises(patientId);

    // Every schedule needs a start + end within the span cap, and a new or changed date
    // may not be in the past (a running prescription keeps its start). Interval mode
    // needs a valid N (1..cap); weekly mode needs ≥1 weekday.
    const invalidSchedule = normalizedExercises.find((exercise) => {
      if (!exercise.scheduledDate) return true;
      if (!exercise.endDate) return true;
      const existing = existingAssignments.find(
        (assignment) => assignment.exercise_id === exercise.exerciseId,
      );
      if (pastScheduleDate(
        { startDate: exercise.scheduledDate, endDate: exercise.endDate },
        existing ? storedScheduleDates(existing) : null,
        today,
      )) {
        return true;
      }
      const span = spanDays(exercise.scheduledDate, exercise.endDate);
      if (span === null || span > MAX_RECURRENCE_SPAN_DAYS) return true;
      if (exercise.recurrence === "weekly") {
        return exercise.weekdays.length === 0;
      }
      // interval
      return (
        exercise.intervalDays === undefined ||
        exercise.intervalDays < 1 ||
        exercise.intervalDays > MAX_INTERVAL_DAYS
      );
    });
    if (invalidSchedule) {
      return NextResponse.json(
        {
          error:
            `Each schedule needs a start and end date (within ${MAX_RECURRENCE_SPAN_DAYS} days), and a new or changed date can't be in the past. ` +
            `Choose a repeat interval (1–${MAX_INTERVAL_DAYS} days) or at least one weekday.`,
        },
        { status: 400 },
      );
    }

    await assignExercisesToPatient(
      patientId,
      normalizedExercises.map((exercise) => ({
        exerciseId:    exercise.exerciseId    as string,
        sets:          exercise.sets as number,
        reps:          exercise.reps as number,
        restSeconds:   exercise.restSeconds,
        scheduledDate: exercise.scheduledDate as string | undefined,
        holdSeconds: exercise.holdSeconds,
        recurrence:  exercise.recurrence,
        intervalDays: exercise.intervalDays,
        weekdays:    exercise.weekdays,
        endDate:     exercise.endDate as string | undefined,
        sequenceIndex: exercise.sequenceIndex,
        prescribedSide: exercise.prescribedSide,
        resistance: exercise.resistance,
      })),
      user.id,
    );

    // Email the patient and the assigning therapist: new exercises and changed ones
    // are separate templates, and each lists the full prescription. The patient's
    // in-app notifications follow the same split: one for everything newly
    // assigned, one for everything edited, each naming the exercises.
    try {
      const after = await getPatientExercises(patientId);
      const { assigned, changed } = diffAssignedExercises(
        existingAssignments as PrescriptionRow[],
        after as PrescriptionRow[],
        normalizedExercises.map((exercise) => exercise.exerciseId as string),
      );
      try {
        if (assigned.length > 0) {
          await createNotification(
            patientId,
            "Exercises Assigned",
            assignedExercisesMessage(user.name, assigned.map((d) => d.exerciseName)),
            "therapist_assigned_exercises",
          );
        }
        if (changed.length > 0) {
          await createNotification(
            patientId,
            "Exercises Edited",
            changedExercisesMessage(user.name, changed),
            "therapist_edited_exercises",
          );
        }
      } catch (err) {
        console.error("Failed to create assigned exercises notifications:", err);
      }
      const patient = await getUserById(patientId);
      const therapistEmail = user.email as string | undefined;
      const sends: Array<[typeof sendAssignedExercisesEmail, typeof assigned]> = [
        [sendAssignedExercisesEmail, assigned],
        [sendAssignedExercisesChangedEmail, changed],
      ];
      for (const [send, details] of sends) {
        if (details.length === 0) continue;
        if (patient?.email) {
          send(patient.email as string, patient.name as string, "patient", user.name, details).catch(console.error);
        }
        if (therapistEmail) {
          send(therapistEmail, user.name, "therapist", (patient?.name as string) ?? "your patient", details).catch(console.error);
        }
      }
    } catch (err) {
      console.error("Failed to send assigned exercises emails:", err);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof ExerciseAssignmentNotAllowedError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("POST /api/patient-exercises error:", error);
    return NextResponse.json({ error: "Failed to assign exercises" }, { status: 500 });
  }
}
