import { getExerciseDefinition } from "./registry";

export const DEFAULT_DISPLAY_HOLD_SECONDS = 30;

export function isIsometricExercise(exerciseId: string | null | undefined): boolean {
  return typeof exerciseId === "string" && getExerciseDefinition(exerciseId)?.kind === "isometric";
}

export function getDisplayHoldSeconds(holdSeconds: number | null | undefined): number {
  if (
    typeof holdSeconds !== "number" ||
    !Number.isFinite(holdSeconds) ||
    holdSeconds < 1
  ) {
    return DEFAULT_DISPLAY_HOLD_SECONDS;
  }
  return Math.floor(holdSeconds);
}

export function prescriptionTargetText({
  exerciseId,
  reps,
  holdSeconds,
}: {
  exerciseId: string | null | undefined;
  reps?: number | null;
  holdSeconds?: number | null;
}): string {
  if (isIsometricExercise(exerciseId)) {
    return `${getDisplayHoldSeconds(holdSeconds)}s hold`;
  }
  return `${reps ?? "?"} reps`;
}

export function prescriptionMetricLabel(exerciseId: string | null | undefined): "Hold" | "Reps" {
  return isIsometricExercise(exerciseId) ? "Hold" : "Reps";
}

export function prescriptionMetricValue({
  exerciseId,
  reps,
  holdSeconds,
}: {
  exerciseId: string | null | undefined;
  reps?: number | null;
  holdSeconds?: number | null;
}): string {
  if (isIsometricExercise(exerciseId)) {
    return `${getDisplayHoldSeconds(holdSeconds)}s`;
  }
  return `${reps ?? "?"}`;
}
