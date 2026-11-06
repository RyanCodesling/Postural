import type { CompensationMetricSpec } from "@/lib/exercises/registry";
import type { PrescribedSide } from "@/lib/prescriptionContext";
import type { CompensationWarningSignal } from "./compensationSignals";
import { cueTriggerLevel } from "./compensationWarningState";
import { compensationDeviation } from "./poseMetrics";

/**
 * Rep-window warnings: judge a compensation once per repetition, inside a
 * window of the movement, instead of continuously.
 *
 * WHY
 * A shoulder shrug used to lift the arm is a recognised compensation, observed
 * early in the rise. In the pilot recordings the coupled shrug deviation of a
 * shrugging repetition rose above its line only near the start and end of the
 * raise (around 30°) and was masked at the top, where the expected shoulder
 * rise is large. A continuous warning therefore never held for its debounce.
 *
 * HOW
 * Per limb, while that limb's counter is ascending and its primary is inside
 * the window, the deviation is tested against the cue's switch-on level. Once
 * it has stayed at or above that level for `persistMs`, the repetition is
 * flagged and its largest such deviation is held as the warning value until
 * the repetition ends. Before a flag, the live in-window deviation is passed
 * through; outside the window, and between repetitions, there is no value.
 * The warning latch and cue selector then work as for any other warning.
 *
 * Warnings only: scores, stored measurements and thresholds are unchanged.
 */

export type RepCounterPhase = "WAITING_FOR_REP_START" | "ASCENDING" | "DESCENDING";

export type RepWindowSideState = {
  /** Largest flagged deviation of the current repetition, or null. */
  heldValue: number | null;
  /** Start of the present run at or above the switch-on level, or null. */
  overSinceMs: number | null;
};

export type RepWindowState = { left: RepWindowSideState; right: RepWindowSideState };

export type RepWindow = {
  /** Lower bound of the window in primary units (the repetition start). */
  from: number;
  /** Upper bound of the window in primary units. */
  upTo: number;
  /** How long the deviation must stay at or above the switch-on level. */
  persistMs: number;
};

const EMPTY_SIDE: RepWindowSideState = { heldValue: null, overSinceMs: null };

export function newRepWindowState(): RepWindowState {
  return { left: EMPTY_SIDE, right: EMPTY_SIDE };
}

/** One limb, one frame. Pure: the input state is not mutated. */
export function updateRepWindowSide(
  state: RepWindowSideState,
  input: { phase: RepCounterPhase | null; primary: number | null; deviation: number | null; nowMs: number },
  window: RepWindow,
  level: number,
): { state: RepWindowSideState; value: number | null } {
  // The camera updates the counter after the warnings, so a repetition's first
  // frame still reads WAITING. A primary already at the window start on that
  // frame is the repetition starting, and that frame counts as rising.
  const starting =
    input.phase === "WAITING_FOR_REP_START" &&
    typeof input.primary === "number" &&
    Math.abs(input.primary) >= window.from;
  if ((input.phase === null || input.phase === "WAITING_FOR_REP_START") && !starting) {
    return { state: EMPTY_SIDE, value: null };
  }
  const inWindow =
    (input.phase === "ASCENDING" || starting) &&
    typeof input.primary === "number" &&
    Math.abs(input.primary) >= window.from &&
    Math.abs(input.primary) <= window.upTo &&
    typeof input.deviation === "number";
  let { heldValue, overSinceMs } = state;
  if (inWindow && (input.deviation as number) >= level) {
    overSinceMs ??= input.nowMs;
    if (input.nowMs - overSinceMs >= window.persistMs) {
      heldValue = Math.max(heldValue ?? -Infinity, input.deviation as number);
    }
  } else {
    overSinceMs = null;
  }
  const value = heldValue ?? (inWindow ? (input.deviation as number) : null);
  return { state: { heldValue, overSinceMs }, value };
}

/**
 * The rep-window warning for a per-limb exercise. Each limb is judged against
 * its own primary and counter; a unilateral prescription reads only its limb,
 * and a bilateral one surfaces the larger value.
 */
export function repWindowCompensationWarningSignal(
  spec: CompensationMetricSpec,
  prescribedSide: PrescribedSide,
  input: {
    left: { value: number | null | undefined; primary: number | null; phase: RepCounterPhase | null };
    right: { value: number | null | undefined; primary: number | null; phase: RepCounterPhase | null };
  },
  state: RepWindowState,
  nowMs: number,
  window: RepWindow,
): { signal: CompensationWarningSignal; state: RepWindowState } {
  const level = cueTriggerLevel(spec);
  const side = (s: "left" | "right") => updateRepWindowSide(
    state[s],
    {
      phase: input[s].phase,
      primary: input[s].primary,
      deviation: compensationDeviation(spec, input[s].value, input[s].primary),
      nowMs,
    },
    window,
    level,
  );
  const left = side("left");
  const right = side("right");
  const next: RepWindowState = { left: left.state, right: right.state };
  if (prescribedSide === "left") return { signal: { name: spec.name, value: left.value, side: "left" }, state: next };
  if (prescribedSide === "right") return { signal: { name: spec.name, value: right.value, side: "right" }, state: next };
  if (left.value === null) {
    return { signal: { name: spec.name, value: right.value, side: right.value === null ? null : "right" }, state: next };
  }
  if (right.value === null || left.value >= right.value) {
    return { signal: { name: spec.name, value: left.value, side: "left" }, state: next };
  }
  return { signal: { name: spec.name, value: right.value, side: "right" }, state: next };
}
