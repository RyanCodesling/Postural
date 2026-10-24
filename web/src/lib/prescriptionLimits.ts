import { isIsometricExercise } from "./exercises/prescriptionDisplay";

// Prototype input limits, not recommended doses or clinical safety thresholds.
// The prescribing therapist chooses the dose within the supported range.
export const MAX_PRESCRIPTION_SETS = 4;
// A hold exercise does one hold per set, with the prescription's rest between
// sets, so a hold repeated with short rests (say 10 holds, 3 s apart) needs
// more sets than a repetition exercise.
export const MAX_HOLD_SETS = 10;
export const MAX_PRESCRIPTION_REPS = 20;

/** The most sets an exercise accepts: 10 for a hold, 4 for anything else. */
export function maxPrescriptionSets(exerciseId: unknown): number {
  return typeof exerciseId === "string" && isIsometricExercise(exerciseId)
    ? MAX_HOLD_SETS
    : MAX_PRESCRIPTION_SETS;
}

export function isPrescriptionCount(value: unknown, maximum: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= maximum;
}

export function prescriptionCountError(
  sets: unknown,
  reps: unknown,
  { allowMissing = false, maxSets = MAX_PRESCRIPTION_SETS }: { allowMissing?: boolean; maxSets?: number } = {},
): string | null {
  for (const [value, label, maximum] of [
    [sets, "Sets", maxSets],
    [reps, "Reps", MAX_PRESCRIPTION_REPS],
  ] as const) {
    if (allowMissing && (value === undefined || value === null)) continue;
    if (!isPrescriptionCount(value, maximum)) {
      return `${label} must be a whole number from 1 to ${maximum}.`;
    }
  }
  return null;
}
