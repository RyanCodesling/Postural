import type { CompensationCueSpec, CompensationMetricSpec, MetricName } from "@/lib/exercises/registry";
import {
  compensationWarningIsOneSided,
  cueTriggerLevel,
  warningValueCleared,
  warningValueShortOfTrigger,
} from "./compensationWarningState";

/**
 * Single-cue arbitration for the patient-facing compensation warnings.
 *
 * WHERE THIS SITS
 *   compensationSignals  → per-metric value + side (already primary-coupled
 *                          and per-limb collapsed)
 *   compensationWarningState → per-metric hysteresis/debounce LATCH
 *   coachingCue (here)   → picks ONE latched warning to surface
 *
 * This module is downstream of the latch layer and owns no thresholds. It
 * never re-tests a raw value against `warningThreshold` to decide whether a
 * compensation is present — that answer arrives as `activeNames`, already
 * debounced and already suppressed for readiness, calibration, peak-relevance
 * and prescribed side by the caller. What this module adds is arbitration and
 * timing: which single cue the patient sees, when it is allowed to appear, how
 * long it must stay before something else may take the slot, and how long it
 * must stay away after it resolves.
 *
 * WHY ONE CUE
 * Three simultaneous yellow boxes ask a patient mid-repetition to correct
 * three things at once, which in practice corrects none of them. Selecting one
 * is the behaviour change; the wording is not. The cue `message` declared in
 * the registry is carried through the decision and the shadow log but is NOT
 * rendered — the canvas keeps its existing labels until the messages have been
 * reviewed by a clinician.
 *
 * HIDDEN CUES
 * A registry cue that declares `hidden` failed the pilot replay check (it fired
 * on correct form, or never on the fault it names). Its warning is still
 * evaluated, latched and logged by the caller, but it never competes for the
 * slot here: it is never drawn, never highlights its metric card, and never
 * blocks a visible lower-priority cue.
 *
 * RECOVERED WARNINGS
 * A latch switches on at its switch-on level, and off only once its value has
 * stayed past its switch-off level for the 300 ms debounce, so a latched
 * warning's value can lie anywhere short of the switch-off level. Two tests,
 * both the latch's own, keep such a warning off screen (`recovered`), so no
 * threshold is added here:
 *   - an empty slot takes a latched warning only once its value is back at
 *     its switch-on level (`warningValueShortOfTrigger`): a cue appears at the
 *     level it would have needed with nothing else on screen. Rehearsal
 *     sessions put LOWER up just after "Raise this arm" went, with the
 *     shoulders back at their usual reading: 246 (2026-10-28) at 1.3, under
 *     its off level of 2.8, for 0.8 s, and 248 (2026-10-29) at 3.1, between
 *     that and its on level of 4, for 2 s.
 *   - a better candidate replaces the displayed cue unless its value is
 *     already back past its switch-off level (`warningValueCleared`). The
 *     screen is already asking for a correction, and the more important fault
 *     the latch still holds should take over: in pilot recording C3's
 *     deliberate trunk lean, the lean became ready while LOWER was shown and
 *     read 7.4-8.4 throughout, between its off level of 4.4 and its on level
 *     of 8.8, so the switch-on test would never have shown it.
 * The displayed cue is exempt: its latch and minimum visible time decide when
 * it goes.
 *
 * NOT CLINICAL VALUES
 * The timing defaults below and the `priority` numbers in the registry are
 * engineering defaults for display behaviour, not clinical parameters. They
 * were chosen to sit either side of the existing 300 ms warning debounce, and
 * they need live tuning and clinician review of the ordering before any of it
 * is described as a coaching protocol.
 */

/**
 * How long a latched warning must stay continuously active before it may be
 * promoted into the cue slot. Sits on top of the latch's own 300 ms debounce,
 * so a compensation must persist roughly 0.9 s from the first threshold
 * crossing before the patient is asked to correct it.
 */
export const COACHING_CUE_MIN_ACTIVE_MS = 600;

/**
 * How long a displayed cue keeps the slot before a higher-priority candidate
 * may replace it. Prevents two competing compensations from swapping the
 * overlay back and forth faster than a patient can read it. This does NOT hold
 * a cue on screen after it resolves; only `COACHING_CUE_MIN_VISIBLE_MS` does.
 */
export const COACHING_CUE_MIN_DISPLAY_MS = 1500;

/**
 * How long a shown cue stays on screen even if its warning clears sooner.
 * Without it, cues on repetitions sometimes vanished 0.2-0.6 s after
 * appearing, too briefly to read. 700 ms (first set at 1 s, shortened at the
 * user's request) bounds how long a corrected cue lingers: in the pilot replay
 * the longest linger was 0.58 s, against 0.96 s at 1 s. Past this window a
 * corrected compensation is released at once, because continuing to ask for a
 * correction the patient already made is worse than showing nothing.
 */
export const COACHING_CUE_MIN_VISIBLE_MS = 700;

/**
 * How long a cue stays out of the running after it clears. Stops a metric
 * hovering at its threshold from re-acquiring the slot on every small
 * excursion.
 */
export const COACHING_CUE_COOLDOWN_MS = 3000;

/** Priority assigned to a compensation metric that declares no `cue`. */
export const COACHING_CUE_FALLBACK_PRIORITY = 100;

/**
 * Schema tag written into every shadow-log export.
 *
 * v2 (2026-08-23) added required per-record `segmentLabel` / `segmentIntent`
 * and an envelope-level `segments` index. A v1 file carries neither, so the
 * tag has to distinguish them — a reader cannot tell the two apart otherwise.
 */
export const COACHING_SHADOW_SCHEMA = "coaching_shadow_v2";

/**
 * Fallback cue wording for a compensation metric that declares no `cue` in the
 * registry. Every metric on every active exercise declares one today, so this
 * table only fires for a metric added later without a cue — in which case the
 * patient keeps a warning instead of silently losing one.
 */
const FALLBACK_CUE_MESSAGE: Partial<Record<MetricName, string>> = {
  trunkLean: "Keep your torso upright.",
  neckTilt: "Keep your head level.",
  shoulderSymmetry: "Level your shoulders.",
  scapularElevation: "Relax your shoulders down.",
  elbowFlexion: "Straighten your arms.",
  shoulderElbowDistance: "Keep your elbows back.",
};

export type CoachingCueTiming = {
  minActiveMs: number;
  minDisplayMs: number;
  cooldownMs: number;
  minVisibleMs: number;
};

/**
 * Why the selector produced the cue it produced. Recorded verbatim in the
 * shadow log so a decision can be replayed without re-running the selector.
 *
 *  - `none-active`      no latched warnings at all
 *  - `min-active`       candidates exist but none has been active long enough
 *  - `cooldown`         every candidate is inside its post-clear cooldown
 *  - `recovered`        no candidate may take the slot, none is waiting out its
 *                       minimum-active time, and at least one is still latched
 *                       with its value short of its switch-on level (for an
 *                       empty slot) or past its switch-off level (to replace
 *                       the displayed cue)
 *  - `promoted`         a cue took an empty slot
 *  - `held`             the displayed cue is still active and still the best
 *  - `held-min-display` a better candidate is ready but the minimum-display
 *                       window blocks the switch
 *  - `held-min-visible` the displayed cue's latch cleared, but it is kept on
 *                       screen until its minimum visible time has passed
 *  - `switched`         a better candidate replaced the displayed cue
 *  - `cleared`          the displayed cue's latch cleared and nothing replaced it
 */
export type CoachingCueReason =
  | "none-active"
  | "min-active"
  | "cooldown"
  | "recovered"
  | "promoted"
  | "held"
  | "held-min-display"
  | "held-min-visible"
  | "switched"
  | "cleared";

export type CoachingCueBlock = "min-active" | "cooldown" | "recovered";

/** One latched warning considered during a single selection tick. */
export type CoachingCueCandidate = {
  metric: MetricName;
  cueId: string;
  priority: number;
  /** The same value the latch layer thresholded. */
  value: number | null;
  /** Raw excess past the metric's warning threshold, in the metric's units. */
  excess: number;
  /** `excess` divided by the threshold, so metrics on different scales sort together. */
  normalizedExcess: number;
  /** How long this cue has been continuously latched at decision time. */
  activeForMs: number;
  /** Null when the candidate was eligible for the slot this tick. */
  blockedBy: CoachingCueBlock | null;
};

export type CoachingCueState = {
  /** Cue id occupying the slot, or null. */
  currentCueId: string | null;
  /** When the current cue was promoted. Null whenever `currentCueId` is null. */
  currentSinceMs: number | null;
  /** Per-cue timestamp of the start of the present continuous active run. */
  activeSinceMs: ReadonlyMap<string, number>;
  /** Per-cue timestamp of the moment the cue last cleared. */
  clearedAtMs: ReadonlyMap<string, number>;
};

export type CoachingCueDecision = {
  /** Successor state. The caller stores this; the input state is not mutated. */
  state: CoachingCueState;
  cueId: string | null;
  metric: MetricName | null;
  /** Registry cue wording. Carried for the shadow log; not rendered today. */
  message: string | null;
  reason: CoachingCueReason;
  /** How long the returned cue has held the slot, or null when there is none. */
  displayedForMs: number | null;
  /** Cue whose latch dropped on this tick and which therefore entered cooldown. */
  clearedCueId: string | null;
  /** Every latched warning considered, in the order they were ranked. */
  candidates: CoachingCueCandidate[];
};

export function newCoachingCueState(): CoachingCueState {
  return {
    currentCueId: null,
    currentSinceMs: null,
    activeSinceMs: new Map(),
    clearedAtMs: new Map(),
  };
}

/**
 * The cue for a compensation metric: its registry declaration, or a synthesized
 * fallback so a metric added without one still reaches the patient. Fallback
 * ids are prefixed `auto:` so a shadow log never confuses one for a reviewed
 * registry cue.
 */
export function resolveCoachingCue(spec: CompensationMetricSpec): CompensationCueSpec {
  if (spec.cue) return spec.cue;
  return {
    id: `auto:${spec.name}`,
    message: FALLBACK_CUE_MESSAGE[spec.name] ?? "Check your form.",
    priority: COACHING_CUE_FALLBACK_PRIORITY,
  };
}

/** Effective timing for one cue: registry override, else the module default. */
export function resolveCoachingCueTiming(cue: CompensationCueSpec): CoachingCueTiming {
  return {
    minActiveMs: cue.minActiveMs ?? COACHING_CUE_MIN_ACTIVE_MS,
    minDisplayMs: cue.minDisplayMs ?? COACHING_CUE_MIN_DISPLAY_MS,
    cooldownMs: cue.cooldownMs ?? COACHING_CUE_COOLDOWN_MS,
    minVisibleMs: cue.minVisibleMs ?? COACHING_CUE_MIN_VISIBLE_MS,
  };
}

/**
 * Excess past the warning threshold, in the metric's own units, matching the
 * roadmap's exposure definition: for an upper-bound rule
 * `max(0, |value| − threshold)`, for a lower-bound rule
 * `max(0, threshold − value)`. A `primary-coupled` residual counts only its
 * excess over the expectation, `max(0, value − threshold)`, matching the
 * one-sided warning latch. The threshold is the cue's own switch-on level
 * (`cueTriggerLevel`), the same one the latch uses.
 *
 * This is a magnitude for ORDERING two simultaneous cues. It is not the
 * persisted effective-exposure quantity, which additionally needs movement
 * phase and frame duration and is out of scope here.
 */
export function coachingCueExcess(
  spec: CompensationMetricSpec,
  value: number | null | undefined,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  const threshold = cueTriggerLevel(spec);
  if ((spec.compareDirection ?? "above") === "below") {
    return Math.max(0, threshold - value);
  }
  return compensationWarningIsOneSided(spec)
    ? Math.max(0, value - threshold)
    : Math.max(0, Math.abs(value) - threshold);
}

/**
 * `coachingCueExcess` divided by the cue's switch-on level, so a 3° trunk lean
 * over a 5° threshold (0.6) ranks against a 0.02 scapular excess over a 0.04
 * threshold (0.5) without the degree-scale metric always winning. A comparison
 * heuristic for tie-breaking only — not a clinical severity measure.
 */
export function normalizedCoachingCueExcess(
  spec: CompensationMetricSpec,
  value: number | null | undefined,
): number {
  const denominator = Math.abs(cueTriggerLevel(spec));
  const excess = coachingCueExcess(spec, value);
  return denominator > 0 ? excess / denominator : excess;
}

/**
 * Picks the single cue to surface from the already-latched warnings.
 *
 * `activeNames` is the latch layer's output — the set this module trusts.
 * `values` are the same display values the latch thresholded, used for the
 * tie-break magnitude and to keep a recovered warning out of the slot. Neither
 * the input state nor any argument is mutated; the successor state is
 * returned on the decision.
 */
export function selectCoachingCue(
  previous: CoachingCueState,
  specs: readonly CompensationMetricSpec[],
  activeNames: ReadonlySet<MetricName>,
  values: Partial<Record<MetricName, number | null>>,
  nowMs: number,
): CoachingCueDecision {
  // Every declared cue, latched or not. Cooldown pruning below needs the
  // timing of cues that are NOT currently active — a cue is in cooldown
  // precisely because it stopped being active — so resolving timing from the
  // active set alone would silently fall back to the module default and expire
  // a longer registry override early.
  const cueBySpec = new Map<string, { spec: CompensationMetricSpec; cue: CompensationCueSpec }>();
  for (const spec of specs) {
    const cue = resolveCoachingCue(spec);
    cueBySpec.set(cue.id, { spec, cue });
  }

  // Cue ids latched right now that may take the slot. A hidden cue stays
  // latched in the caller's warning map and audit, but never competes here.
  const activeByCueId = new Map<string, { spec: CompensationMetricSpec; cue: CompensationCueSpec }>();
  for (const spec of specs) {
    if (!activeNames.has(spec.name)) continue;
    const entry = cueBySpec.get(resolveCoachingCue(spec).id);
    if (entry && !entry.cue.hidden) activeByCueId.set(entry.cue.id, entry);
  }

  // Continuous-active clock. An id absent from the active set loses its run,
  // so a warning that flickers off restarts its minimum-active window.
  const activeSinceMs = new Map<string, number>();
  for (const cueId of activeByCueId.keys()) {
    activeSinceMs.set(cueId, previous.activeSinceMs.get(cueId) ?? nowMs);
  }

  // Carry forward only cooldowns that are still running, so the map stays
  // bounded across a long session. Timing comes from the full declaration set,
  // never from the active set: an entry is here BECAUSE its cue went inactive.
  // A cue id absent from the current specs belongs to a different exercise and
  // can no longer match a candidate, so the module default is a safe bound.
  const clearedAtMs = new Map<string, number>();
  for (const [cueId, clearedAt] of previous.clearedAtMs) {
    const entry = cueBySpec.get(cueId);
    const cooldownMs = entry
      ? resolveCoachingCueTiming(entry.cue).cooldownMs
      : COACHING_CUE_COOLDOWN_MS;
    if (nowMs - clearedAt < cooldownMs) clearedAtMs.set(cueId, clearedAt);
  }

  // A displayed cue whose latch dropped stays on screen until it has been
  // visible for its minimum visible time, so a brief cue can still be read.
  // After that it is released at once and starts its cooldown: holding a
  // resolved correction any longer would ask the patient to fix what they just
  // fixed.
  let currentCueId = previous.currentCueId;
  let currentSinceMs = previous.currentSinceMs;
  let clearedCueId: string | null = null;
  let heldForVisibility = false;
  if (currentCueId !== null && !activeByCueId.has(currentCueId)) {
    const entry = cueBySpec.get(currentCueId);
    const minVisibleMs = entry
      ? resolveCoachingCueTiming(entry.cue).minVisibleMs
      : COACHING_CUE_MIN_VISIBLE_MS;
    if (entry && !entry.cue.hidden && currentSinceMs !== null && nowMs - currentSinceMs < minVisibleMs) {
      heldForVisibility = true;
    } else {
      clearedCueId = currentCueId;
      clearedAtMs.set(currentCueId, nowMs);
      currentCueId = null;
      currentSinceMs = null;
    }
  }

  const candidates: CoachingCueCandidate[] = [];
  for (const [cueId, { spec, cue }] of activeByCueId) {
    const timing = resolveCoachingCueTiming(cue);
    const activeForMs = nowMs - (activeSinceMs.get(cueId) ?? nowMs);
    const clearedAt = clearedAtMs.get(cueId);
    const inCooldown = clearedAt !== undefined && nowMs - clearedAt < timing.cooldownMs;
    candidates.push({
      metric: spec.name,
      cueId,
      priority: cue.priority,
      value: values[spec.name] ?? null,
      excess: coachingCueExcess(spec, values[spec.name]),
      normalizedExcess: normalizedCoachingCueExcess(spec, values[spec.name]),
      activeForMs,
      blockedBy: inCooldown
        ? "cooldown"
        : activeForMs < timing.minActiveMs
          ? "min-active"
          : cueId !== currentCueId && (currentCueId === null
              ? warningValueShortOfTrigger(spec, values[spec.name])
              : warningValueCleared(spec, values[spec.name]))
            ? "recovered"
            : null,
    });
  }

  // Lowest `priority` number wins. Equal priority falls to the larger
  // normalized excess, then to the cue id so the order is deterministic.
  candidates.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (a.normalizedExcess !== b.normalizedExcess) return b.normalizedExcess - a.normalizedExcess;
    return a.cueId < b.cueId ? -1 : a.cueId > b.cueId ? 1 : 0;
  });

  const best = candidates.find((candidate) => candidate.blockedBy === null) ?? null;

  const decide = (): { cueId: string | null; sinceMs: number | null; reason: CoachingCueReason } => {
    if (currentCueId !== null) {
      // Its latch cleared inside the minimum visible window: keep it readable.
      // This window is shorter than the minimum display, so no switch is lost.
      if (heldForVisibility) {
        return { cueId: currentCueId, sinceMs: currentSinceMs, reason: "held-min-visible" };
      }
      // The displayed cue is still latched, so it is always among the
      // candidates and never blocked: its active run predates this tick, a
      // cue only enters cooldown once it has left the slot, and the recovered
      // block leaves it out.
      if (best === null || best.cueId === currentCueId) {
        return { cueId: currentCueId, sinceMs: currentSinceMs, reason: "held" };
      }
      const currentCue = activeByCueId.get(currentCueId)?.cue;
      const minDisplayMs = currentCue
        ? resolveCoachingCueTiming(currentCue).minDisplayMs
        : COACHING_CUE_MIN_DISPLAY_MS;
      if (currentSinceMs !== null && nowMs - currentSinceMs < minDisplayMs) {
        return { cueId: currentCueId, sinceMs: currentSinceMs, reason: "held-min-display" };
      }
      return { cueId: best.cueId, sinceMs: nowMs, reason: "switched" };
    }

    if (best !== null) {
      return { cueId: best.cueId, sinceMs: nowMs, reason: "promoted" };
    }
    if (candidates.length === 0) {
      return { cueId: null, sinceMs: null, reason: clearedCueId !== null ? "cleared" : "none-active" };
    }
    // Every candidate is blocked. Report cooldown only when that is the whole
    // story, so a mixed tick is not mislabelled as a cooldown suppression, and
    // recovered only when no candidate still owes its minimum-active time.
    const blocks = new Set(candidates.map((candidate) => candidate.blockedBy));
    return {
      cueId: null,
      sinceMs: null,
      reason: blocks.has("min-active") ? "min-active" : blocks.has("recovered") ? "recovered" : "cooldown",
    };
  };

  const { cueId, sinceMs, reason } = decide();
  // A cue held for visibility is no longer latched, so look it up among all
  // declared cues.
  const selected = cueId !== null ? activeByCueId.get(cueId) ?? cueBySpec.get(cueId) ?? null : null;

  return {
    state: { currentCueId: cueId, currentSinceMs: sinceMs, activeSinceMs, clearedAtMs },
    cueId,
    metric: selected?.spec.name ?? null,
    message: selected?.cue.message ?? null,
    reason,
    displayedForMs: sinceMs !== null ? nowMs - sinceMs : null,
    clearedCueId,
    candidates,
  };
}
