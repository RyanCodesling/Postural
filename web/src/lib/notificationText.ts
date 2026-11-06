import type { PrescriptionDetail } from "@/lib/email";

/** "A", "A and B", "A, B, and C". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** One notification for every exercise assigned in the same request. */
export function assignedExercisesMessage(therapistName: string, names: string[]): string {
  return `${therapistName} assigned you ${plural(names.length, "exercise")}: ${joinNames(names)}.`;
}

export function removedExercisesMessage(therapistName: string, names: string[]): string {
  return `${therapistName} removed ${plural(names.length, "exercise")} from your program: ${joinNames(names)}.`;
}

/** The new value of each changed field, keyed by the label changedPrescriptionFields uses. */
function currentValue(d: PrescriptionDetail, label: string): string {
  if (label === "Sets") return String(d.sets);
  if (label === d.metricLabel) return d.metricValue;
  if (label === "Rest") return `${d.restSeconds}s`;
  if (label === "Order") return String(d.order);
  if (label === "Side") return d.side;
  if (label === "Resistance") return d.resistance;
  if (label === "Repeat") return d.repeat;
  if (label === "Schedule") return `${d.startLabel} to ${d.endLabel}`;
  return "";
}

/** "Shoulder Raise: Sets 3 → 4, Reps 10 → 12" for one changed exercise. */
export function changedExerciseLine(d: PrescriptionDetail): string {
  const fields = Object.entries(d.changed ?? {}).map(
    ([label, before]) => `${label} ${before} → ${currentValue(d, label)}`,
  );
  return `${d.exerciseName}: ${fields.join(", ")}`;
}

export function changedExercisesMessage(therapistName: string, details: PrescriptionDetail[]): string {
  return `${therapistName} edited ${plural(details.length, "exercise")}:\n${details
    .map((d) => `• ${changedExerciseLine(d)}`)
    .join("\n")}`;
}
