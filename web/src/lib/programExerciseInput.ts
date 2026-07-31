import type { ProgramExerciseInput } from "@/lib/db";
import {
  parsePrescribedSide,
  parseResistanceContext,
} from "@/lib/prescriptionContext";

export function nextExerciseSequenceIndex(
  values: Iterable<number | null | undefined>,
): number {
  let highest = 0;
  for (const value of values) {
    if (Number.isInteger(value) && (value as number) > highest) {
      highest = value as number;
    }
  }
  return highest + 1;
}

export function parseProgramExerciseInputs(values: unknown[]): ProgramExerciseInput[] {
  const parsed = values.map((value, index) => {
    if (!value || typeof value !== "object") {
      throw new Error("Every program exercise must be an object.");
    }
    const exercise = value as Record<string, unknown>;
    if (typeof exercise.name !== "string" || exercise.name.trim() === "") {
      throw new Error("Every program exercise requires a name.");
    }
    if (
      exercise.exerciseId !== undefined &&
      exercise.exerciseId !== null &&
      typeof exercise.exerciseId !== "string"
    ) {
      throw new Error("Invalid program exercise id.");
    }
    const sequenceIndex =
      exercise.sequenceIndex === undefined || exercise.sequenceIndex === null
        ? index + 1
        : Number(exercise.sequenceIndex);
    if (!Number.isInteger(sequenceIndex) || sequenceIndex < 1) {
      throw new Error("Every program exercise requires a positive whole-number order.");
    }

    return {
      exerciseId:
        typeof exercise.exerciseId === "string" ? exercise.exerciseId : undefined,
      name: exercise.name.trim(),
      description:
        typeof exercise.description === "string"
          ? exercise.description
          : undefined,
      isCustom: exercise.isCustom === true,
      sets: typeof exercise.sets === "number" ? exercise.sets : undefined,
      reps: typeof exercise.reps === "number" ? exercise.reps : undefined,
      restSeconds:
        typeof exercise.restSeconds === "number"
          ? exercise.restSeconds
          : undefined,
      holdSeconds:
        typeof exercise.holdSeconds === "number"
          ? exercise.holdSeconds
          : undefined,
      sequenceIndex,
      prescribedSide: parsePrescribedSide(exercise.prescribedSide),
      resistance: parseResistanceContext(exercise),
    };
  });

  const sequenceIndexes = parsed.map((exercise) => exercise.sequenceIndex);
  if (new Set(sequenceIndexes).size !== sequenceIndexes.length) {
    throw new Error("Program exercise order values must be unique.");
  }
  return parsed;
}
