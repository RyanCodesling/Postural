import type { PrescribedSide } from "@/lib/prescriptionContext";

export type OutcomeSide = Exclude<PrescribedSide, "both">;

/**
 * Outcome summaries follow the prescription. A unilateral prescription shows
 * only its treated side; the opposite side may still be stored for audit, but
 * it is not presented as an equivalent treatment outcome.
 */
export function prescribedOutcomeSides(
  prescribedSide: PrescribedSide,
): OutcomeSide[] {
  return prescribedSide === "both"
    ? ["left", "right"]
    : [prescribedSide];
}

export function shouldShowOutcomeAsymmetry(
  prescribedSide: PrescribedSide,
): boolean {
  return prescribedSide === "both";
}

export function sideLabel(side: OutcomeSide): "Left" | "Right" {
  return side === "left" ? "Left" : "Right";
}

export function fullRomOutcomeText(complete: number, attempted: number): string {
  return `${complete}/${attempted} met full-ROM target`;
}

export function prescribedValue<T>(
  prescribedSide: PrescribedSide,
  values: { left: T; right: T },
  bothValue: T,
): T {
  return prescribedSide === "both" ? bothValue : values[prescribedSide];
}
