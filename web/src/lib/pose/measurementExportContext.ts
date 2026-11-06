import type { SessionContextSnapshot } from "../prescriptionContext";

/** Export recorded measurement provenance, never today's registry or patient survey. */
export function measurementExportContext(context: SessionContextSnapshot | null | undefined) {
  if (!context) return null;
  const p = context.prescription;
  return {
    version: context.version,
    exercise: context.exercise,
    versions: context.versions,
    prescription: p ? {
      exerciseId: p.exerciseId,
      sets: p.sets,
      reps: p.reps,
      holdSeconds: p.holdSeconds,
      prescribedSide: p.prescribedSide,
    } : null,
  };
}
