/**
 * coachingCue.test.ts
 *
 * Tests the single-cue arbitration that sits downstream of the compensation
 * warning latches: priority resolution, the normalized-excess tiebreak, the
 * minimum-active promote gate, the minimum-display switch gate, the per-cue
 * post-clear cooldown, and the empty/no-latch paths.
 *
 * USAGE
 *   npx tsx web/src/lib/pose/coachingCue.test.ts
 */

import type { CompensationMetricSpec, MetricName } from "@/lib/exercises/registry";
import {
  COACHING_CUE_COOLDOWN_MS,
  COACHING_CUE_MIN_ACTIVE_MS,
  COACHING_CUE_MIN_DISPLAY_MS,
  coachingCueExcess,
  newCoachingCueState,
  normalizedCoachingCueExcess,
  resolveCoachingCue,
  selectCoachingCue,
  type CoachingCueState,
} from "./coachingCue";

let testsPassed = 0;
let testsFailed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  PASS ${name}`);
    testsPassed += 1;
  } catch (err) {
    console.log(`  FAIL ${name}`);
    console.log(`      ${err instanceof Error ? err.message : String(err)}`);
    testsFailed += 1;
  }
}

function assertEq(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertClose(actual: number, expected: number, label: string): void {
  if (Math.abs(actual - expected) > 1e-9) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

// ── Fixtures ────────────────────────────────────────────────────────────────
// Shaped like the real registry entries but with local ids, so the tests pin
// the selector's behaviour rather than the current cue table.

const trunkLean: CompensationMetricSpec = {
  name: "trunkLean",
  warningThreshold: 5,
  cue: { id: "t.trunk-lean", message: "Keep your torso upright.", priority: 10 },
};

const scapularElevation: CompensationMetricSpec = {
  name: "scapularElevation",
  warningThreshold: 0.04,
  cue: { id: "t.scapular-elevation", message: "Relax your shoulders down.", priority: 20 },
};

/** Same priority as trunkLean, so the pair exercises the magnitude tiebreak. */
const shoulderSymmetry: CompensationMetricSpec = {
  name: "shoulderSymmetry",
  warningThreshold: 5,
  cue: { id: "t.shoulder-symmetry", message: "Level your shoulders.", priority: 10 },
};

const elbowFlexion: CompensationMetricSpec = {
  name: "elbowFlexion",
  warningThreshold: 150,
  compareDirection: "below",
  peakRelevant: true,
  cue: {
    id: "t.elbow-flexion",
    message: "Straighten your arms at the top.",
    priority: 20,
    minActiveMs: 100,
    minDisplayMs: 200,
    cooldownMs: 400,
  },
};

/** No `cue` — exercises the synthesized fallback. */
const uncued: CompensationMetricSpec = { name: "neckTilt", warningThreshold: 5 };

const ALL = [trunkLean, scapularElevation, shoulderSymmetry] as const;

function active(...names: MetricName[]): Set<MetricName> {
  return new Set(names);
}

/**
 * Runs one tick and threads the successor state, mirroring how CameraClient
 * stores the decision's state back into its ref.
 */
function tick(
  state: CoachingCueState,
  specs: readonly CompensationMetricSpec[],
  activeNames: Set<MetricName>,
  values: Partial<Record<MetricName, number | null>>,
  nowMs: number,
) {
  const decision = selectCoachingCue(state, specs, activeNames, values, nowMs);
  return { decision, state: decision.state };
}

/** Holds `activeNames` steady until `untilMs`, so a min-active window elapses. */
function hold(
  state: CoachingCueState,
  specs: readonly CompensationMetricSpec[],
  activeNames: Set<MetricName>,
  values: Partial<Record<MetricName, number | null>>,
  fromMs: number,
  untilMs: number,
  stepMs = 150,
) {
  let s = state;
  let last = selectCoachingCue(s, specs, activeNames, values, fromMs);
  s = last.state;
  for (let t = fromMs + stepMs; t <= untilMs; t += stepMs) {
    last = selectCoachingCue(s, specs, activeNames, values, t);
    s = last.state;
  }
  return { decision: last, state: s };
}

// ── Excess math ─────────────────────────────────────────────────────────────

test("excess follows the compare direction and normalizes by the threshold", () => {
  assertClose(coachingCueExcess(trunkLean, 8), 3, "above: |8| - 5");
  assertClose(coachingCueExcess(trunkLean, -8), 3, "above uses magnitude");
  assertClose(coachingCueExcess(trunkLean, 4), 0, "under threshold clamps to 0");
  assertClose(coachingCueExcess(elbowFlexion, 120), 30, "below: 150 - 120");
  assertClose(coachingCueExcess(elbowFlexion, 170), 0, "straight arm clamps to 0");
  assertClose(coachingCueExcess(trunkLean, null), 0, "null value has no excess");

  assertClose(normalizedCoachingCueExcess(trunkLean, 8), 0.6, "3/5");
  assertClose(normalizedCoachingCueExcess(scapularElevation, 0.06), 0.5, "0.02/0.04");
});

// ── Priority resolution ─────────────────────────────────────────────────────

test("lowest priority number wins when several warnings are latched", () => {
  const values = { trunkLean: 9, scapularElevation: 0.9 };
  const { decision } = hold(
    newCoachingCueState(),
    ALL,
    active("trunkLean", "scapularElevation"),
    values,
    0,
    COACHING_CUE_MIN_ACTIVE_MS,
  );

  assertEq(decision.cueId, "t.trunk-lean", "priority 10 beats priority 20");
  assertEq(decision.metric, "trunkLean", "selected metric");
  assertEq(decision.message, "Keep your torso upright.", "registry message is carried");
  assertEq(decision.reason, "promoted", "reason");
  assertEq(decision.candidates.length, 2, "both latches were considered");
  assertEq(decision.candidates[0].cueId, "t.trunk-lean", "ranked order");
  // The far larger normalized excess on the lower-priority metric must NOT
  // override priority — magnitude is only a tiebreak.
  assertEq(
    decision.candidates[1].normalizedExcess > decision.candidates[0].normalizedExcess,
    true,
    "loser had the larger excess",
  );
});

test("a metric with no cue still warns, at the fallback priority", () => {
  const fallback = resolveCoachingCue(uncued);
  assertEq(fallback.id, "auto:neckTilt", "synthesized id is prefixed");
  assertEq(fallback.priority > trunkLean.cue!.priority, true, "ranks below declared cues");

  const { decision } = hold(
    newCoachingCueState(),
    [uncued],
    active("neckTilt"),
    { neckTilt: 9 },
    0,
    COACHING_CUE_MIN_ACTIVE_MS,
  );
  assertEq(decision.cueId, "auto:neckTilt", "fallback cue is selectable");

  const both = hold(
    newCoachingCueState(),
    [uncued, trunkLean],
    active("neckTilt", "trunkLean"),
    { neckTilt: 40, trunkLean: 6 },
    0,
    COACHING_CUE_MIN_ACTIVE_MS,
  );
  assertEq(both.decision.cueId, "t.trunk-lean", "declared cue outranks the fallback");
});

// ── Magnitude tiebreak ──────────────────────────────────────────────────────

test("equal priority falls to the larger threshold-normalized excess", () => {
  const worseSymmetry = hold(
    newCoachingCueState(),
    ALL,
    active("trunkLean", "shoulderSymmetry"),
    { trunkLean: 6, shoulderSymmetry: 12 },
    0,
    COACHING_CUE_MIN_ACTIVE_MS,
  );
  assertEq(worseSymmetry.decision.cueId, "t.shoulder-symmetry", "7/5 beats 1/5");

  const worseLean = hold(
    newCoachingCueState(),
    ALL,
    active("trunkLean", "shoulderSymmetry"),
    { trunkLean: 12, shoulderSymmetry: 6 },
    0,
    COACHING_CUE_MIN_ACTIVE_MS,
  );
  assertEq(worseLean.decision.cueId, "t.trunk-lean", "tiebreak follows the magnitude");
});

test("normalization lets a small-unit metric out-rank a degree metric", () => {
  // Same priority via a local override, so only the scale differs: the
  // scapular metric is 0.02 over a 0.04 threshold, the trunk metric 1° over 5°.
  const scapularAtSamePriority: CompensationMetricSpec = {
    ...scapularElevation,
    cue: { ...scapularElevation.cue!, priority: 10 },
  };
  const { decision } = hold(
    newCoachingCueState(),
    [trunkLean, scapularAtSamePriority],
    active("trunkLean", "scapularElevation"),
    { trunkLean: 6, scapularElevation: 0.06 },
    0,
    COACHING_CUE_MIN_ACTIVE_MS,
  );
  assertEq(decision.cueId, "t.scapular-elevation", "0.5 normalized beats 0.2 normalized");
});

// ── Minimum-active suppression ──────────────────────────────────────────────

test("a latched warning is not promoted until the minimum-active window passes", () => {
  const specs = [trunkLean];
  const names = active("trunkLean");
  const values = { trunkLean: 9 };

  let s = newCoachingCueState();
  let r = tick(s, specs, names, values, 0);
  s = r.state;
  assertEq(r.decision.cueId, null, "not promoted on the first tick");
  assertEq(r.decision.reason, "min-active", "reason names the gate");
  assertEq(r.decision.candidates[0].blockedBy, "min-active", "candidate is blocked");

  r = tick(s, specs, names, values, COACHING_CUE_MIN_ACTIVE_MS - 1);
  s = r.state;
  assertEq(r.decision.cueId, null, "still blocked one ms short");

  r = tick(s, specs, names, values, COACHING_CUE_MIN_ACTIVE_MS);
  assertEq(r.decision.cueId, "t.trunk-lean", "promoted exactly at the boundary");
  assertEq(r.decision.reason, "promoted", "reason");
  assertEq(r.decision.candidates[0].blockedBy, null, "candidate is no longer blocked");
});

test("a warning that flickers off restarts its minimum-active window", () => {
  const specs = [trunkLean];
  let s = newCoachingCueState();

  s = tick(s, specs, active("trunkLean"), { trunkLean: 9 }, 0).state;
  s = tick(s, specs, active("trunkLean"), { trunkLean: 9 }, 400).state;
  // One tick with the latch dropped clears the run.
  s = tick(s, specs, active(), {}, 450).state;

  const resumed = tick(s, specs, active("trunkLean"), { trunkLean: 9 }, 500);
  assertEq(resumed.decision.cueId, null, "the earlier 400 ms does not carry over");
  assertEq(resumed.decision.candidates[0].activeForMs, 0, "active clock restarted");
});

test("a per-cue minActiveMs override replaces the default", () => {
  const specs = [elbowFlexion];
  const names = active("elbowFlexion");
  const values = { elbowFlexion: 120 };

  let s = newCoachingCueState();
  s = tick(s, specs, names, values, 0).state;
  const early = tick(s, specs, names, values, 100);
  assertEq(early.decision.cueId, "t.elbow-flexion", "promoted at the 100 ms override");
  assertEq(
    100 < COACHING_CUE_MIN_ACTIVE_MS,
    true,
    "the override is genuinely shorter than the default",
  );
});

// ── Minimum-display switching ───────────────────────────────────────────────

test("a higher-priority cue cannot take the slot inside the minimum-display window", () => {
  // Promote the lower-priority scapular cue on its own first.
  const promoted = hold(
    newCoachingCueState(),
    ALL,
    active("scapularElevation"),
    { scapularElevation: 0.06 },
    0,
    COACHING_CUE_MIN_ACTIVE_MS,
  );
  assertEq(promoted.decision.cueId, "t.scapular-elevation", "setup: scapular holds the slot");
  const promotedAt = COACHING_CUE_MIN_ACTIVE_MS;

  // Trunk lean (priority 10) now latches and completes its own min-active
  // window, but the displayed cue is still inside its min-display window.
  const contended = hold(
    promoted.state,
    ALL,
    active("scapularElevation", "trunkLean"),
    { scapularElevation: 0.06, trunkLean: 9 },
    promotedAt + 150,
    promotedAt + COACHING_CUE_MIN_DISPLAY_MS - 150,
  );
  assertEq(contended.decision.cueId, "t.scapular-elevation", "slot is held");
  assertEq(contended.decision.reason, "held-min-display", "reason names the gate");
  assertEq(
    contended.decision.candidates[0].cueId,
    "t.trunk-lean",
    "the better candidate was ranked first and was unblocked",
  );
  assertEq(contended.decision.candidates[0].blockedBy, null, "candidate itself is eligible");

  // Once the window closes the switch goes through.
  const switched = tick(
    contended.state,
    ALL,
    active("scapularElevation", "trunkLean"),
    { scapularElevation: 0.06, trunkLean: 9 },
    promotedAt + COACHING_CUE_MIN_DISPLAY_MS,
  );
  assertEq(switched.decision.cueId, "t.trunk-lean", "switched after the window");
  assertEq(switched.decision.reason, "switched", "reason");
  assertEq(switched.decision.displayedForMs, 0, "display clock restarts on a switch");
  assertEq(switched.decision.clearedCueId, null, "a switch is not a clear");
});

test("the displayed cue keeps the slot while it stays the best candidate", () => {
  const promoted = hold(
    newCoachingCueState(),
    ALL,
    active("trunkLean", "scapularElevation"),
    { trunkLean: 9, scapularElevation: 0.06 },
    0,
    COACHING_CUE_MIN_ACTIVE_MS,
  );
  const later = tick(
    promoted.state,
    ALL,
    active("trunkLean", "scapularElevation"),
    { trunkLean: 9, scapularElevation: 0.06 },
    20_000,
  );
  assertEq(later.decision.cueId, "t.trunk-lean", "still displayed long after min-display");
  assertEq(later.decision.reason, "held", "reason");
  assertEq(later.decision.displayedForMs, 20_000 - COACHING_CUE_MIN_ACTIVE_MS, "display clock runs");
});

// ── Cooldown ────────────────────────────────────────────────────────────────

test("a cue that clears enters cooldown and cannot immediately return", () => {
  const specs = [trunkLean];
  const promoted = hold(
    newCoachingCueState(),
    specs,
    active("trunkLean"),
    { trunkLean: 9 },
    0,
    COACHING_CUE_MIN_ACTIVE_MS,
  );
  assertEq(promoted.decision.cueId, "t.trunk-lean", "setup");

  const clearedAt = COACHING_CUE_MIN_ACTIVE_MS + 100;
  const cleared = tick(promoted.state, specs, active(), { trunkLean: 2 }, clearedAt);
  assertEq(cleared.decision.cueId, null, "released as soon as the latch drops");
  assertEq(cleared.decision.reason, "cleared", "reason");
  assertEq(cleared.decision.clearedCueId, "t.trunk-lean", "the cleared cue is reported");

  // Re-latch immediately and satisfy min-active: the cooldown still blocks it.
  const reLatched = hold(
    cleared.state,
    specs,
    active("trunkLean"),
    { trunkLean: 9 },
    clearedAt + 50,
    clearedAt + COACHING_CUE_COOLDOWN_MS - 100,
  );
  assertEq(reLatched.decision.cueId, null, "blocked by cooldown");
  assertEq(reLatched.decision.reason, "cooldown", "reason");
  assertEq(reLatched.decision.candidates[0].blockedBy, "cooldown", "candidate is blocked");

  const afterCooldown = tick(
    reLatched.state,
    specs,
    active("trunkLean"),
    { trunkLean: 9 },
    clearedAt + COACHING_CUE_COOLDOWN_MS,
  );
  assertEq(afterCooldown.decision.cueId, "t.trunk-lean", "returns once the cooldown expires");
  assertEq(afterCooldown.decision.reason, "promoted", "reason");
});

test("a cue in cooldown yields the slot to a lower-priority cue that is ready", () => {
  const specs = ALL;
  const promoted = hold(
    newCoachingCueState(),
    specs,
    active("trunkLean"),
    { trunkLean: 9 },
    0,
    COACHING_CUE_MIN_ACTIVE_MS,
  );

  // Trunk clears; scapular has been latched all along, so it is already past
  // its own min-active window and takes the slot on the same tick.
  const clearedAt = COACHING_CUE_MIN_ACTIVE_MS + 50;
  let s = promoted.state;
  s = tick(s, specs, active("trunkLean", "scapularElevation"), { trunkLean: 9, scapularElevation: 0.06 }, clearedAt - 25).state;
  const handover = hold(
    s,
    specs,
    active("scapularElevation"),
    { trunkLean: 2, scapularElevation: 0.06 },
    clearedAt,
    clearedAt + COACHING_CUE_MIN_ACTIVE_MS,
  );
  assertEq(handover.decision.cueId, "t.scapular-elevation", "lower priority takes over");

  // Trunk re-latches inside its cooldown: the scapular cue keeps the slot.
  const contested = tick(
    handover.state,
    specs,
    active("trunkLean", "scapularElevation"),
    { trunkLean: 9, scapularElevation: 0.06 },
    clearedAt + COACHING_CUE_COOLDOWN_MS - 100,
  );
  assertEq(contested.decision.cueId, "t.scapular-elevation", "cooled-down cue does not preempt");
  assertEq(
    contested.decision.candidates.find((c) => c.cueId === "t.trunk-lean")?.blockedBy,
    "cooldown",
    "trunk is blocked by cooldown, not by priority",
  );
});

test("a per-cue cooldownMs override replaces the default", () => {
  const specs = [elbowFlexion];
  const promoted = hold(
    newCoachingCueState(),
    specs,
    active("elbowFlexion"),
    { elbowFlexion: 120 },
    0,
    100,
    50,
  );
  assertEq(promoted.decision.cueId, "t.elbow-flexion", "setup");

  const cleared = tick(promoted.state, specs, active(), { elbowFlexion: 175 }, 200);
  const backAt = 200 + 400; // the cue's own 400 ms cooldown, not the 3 s default
  const back = hold(cleared.state, specs, active("elbowFlexion"), { elbowFlexion: 120 }, 250, backAt, 50);
  assertEq(back.decision.cueId, "t.elbow-flexion", "returns after the shorter override");
  assertEq(
    backAt < 200 + COACHING_CUE_COOLDOWN_MS,
    true,
    "the override is genuinely shorter than the default",
  );
});

test("a cooldown override LONGER than the default survives inactive ticks", () => {
  // Regression: cooldown pruning once resolved timing from the ACTIVE cue set.
  // A cue in cooldown is by definition inactive, so a longer registry override
  // was pruned at the 3 s module default and the cue returned early.
  const longCooldown: CompensationMetricSpec = {
    name: "trunkLean",
    warningThreshold: 5,
    cue: {
      id: "t.long-cooldown",
      message: "Keep your torso upright.",
      priority: 10,
      minActiveMs: 50,
      cooldownMs: COACHING_CUE_COOLDOWN_MS + 2000,
    },
  };
  const specs = [longCooldown];
  const values = { trunkLean: 9 };

  let s = newCoachingCueState();
  s = tick(s, specs, active("trunkLean"), values, 0).state;
  const promoted = tick(s, specs, active("trunkLean"), values, 50);
  assertEq(promoted.decision.cueId, "t.long-cooldown", "setup: promoted");

  const cleared = tick(promoted.state, specs, active(), values, 100);
  assertEq(cleared.decision.clearedCueId, "t.long-cooldown", "setup: cleared");

  // An inactive tick past the DEFAULT but inside the override must not drop it.
  const idle = tick(cleared.state, specs, active(), values, 100 + COACHING_CUE_COOLDOWN_MS + 100);
  assertEq(idle.decision.state.clearedAtMs.size, 1, "cooldown retained past the default");

  const stillBlocked = hold(
    idle.state,
    specs,
    active("trunkLean"),
    values,
    100 + COACHING_CUE_COOLDOWN_MS + 150,
    100 + COACHING_CUE_COOLDOWN_MS + 400,
    50,
  );
  assertEq(stillBlocked.decision.cueId, null, "still blocked inside the override");
  assertEq(stillBlocked.decision.candidates[0].blockedBy, "cooldown", "blocked by cooldown");

  const expired = tick(
    stillBlocked.state,
    specs,
    active("trunkLean"),
    values,
    100 + COACHING_CUE_COOLDOWN_MS + 2000,
  );
  assertEq(expired.decision.cueId, "t.long-cooldown", "returns when the override expires");
});

// ── Clear reset ─────────────────────────────────────────────────────────────

test("a resolved cue is released at once rather than held for its display window", () => {
  const specs = [trunkLean];
  const promoted = hold(
    newCoachingCueState(),
    specs,
    active("trunkLean"),
    { trunkLean: 9 },
    0,
    COACHING_CUE_MIN_ACTIVE_MS,
  );
  // One millisecond into the display window, far short of minDisplayMs.
  const cleared = tick(promoted.state, specs, active(), { trunkLean: 1 }, COACHING_CUE_MIN_ACTIVE_MS + 1);
  assertEq(cleared.decision.cueId, null, "not held on a corrected compensation");
  assertEq(cleared.decision.state.currentCueId, null, "slot is empty in the successor state");
  assertEq(cleared.decision.displayedForMs, null, "no display clock while empty");
});

test("dropping a metric from the spec list clears its cue", () => {
  const promoted = hold(
    newCoachingCueState(),
    ALL,
    active("trunkLean"),
    { trunkLean: 9 },
    0,
    COACHING_CUE_MIN_ACTIVE_MS,
  );
  // Exercise change: trunkLean is no longer declared, but a stale active name
  // is still passed in. The spec list is the authority.
  const swapped = tick(
    promoted.state,
    [scapularElevation],
    active("trunkLean", "scapularElevation"),
    { trunkLean: 9, scapularElevation: 0.06 },
    COACHING_CUE_MIN_ACTIVE_MS + 50,
  );
  assertEq(swapped.decision.clearedCueId, "t.trunk-lean", "the dropped cue cleared");
  assertEq(swapped.decision.cueId, null, "the new metric still owes its min-active window");
  assertEq(swapped.decision.candidates.length, 1, "only declared specs are candidates");
});

// ── Empty input ─────────────────────────────────────────────────────────────

test("no latched warnings yields no cue and no candidates", () => {
  const empty = tick(newCoachingCueState(), ALL, active(), {}, 1_000);
  assertEq(empty.decision.cueId, null, "no cue");
  assertEq(empty.decision.metric, null, "no metric");
  assertEq(empty.decision.message, null, "no message");
  assertEq(empty.decision.reason, "none-active", "reason");
  assertEq(empty.decision.clearedCueId, null, "nothing to clear");
  assertEq(empty.decision.candidates.length, 0, "no candidates");

  const noSpecs = tick(newCoachingCueState(), [], active("trunkLean"), { trunkLean: 9 }, 1_000);
  assertEq(noSpecs.decision.reason, "none-active", "an exercise with no compensations is quiet");
});

test("the input state is not mutated", () => {
  const before = newCoachingCueState();
  const decision = selectCoachingCue(before, ALL, active("trunkLean"), { trunkLean: 9 }, 500);
  assertEq(before.activeSinceMs.size, 0, "caller's active map untouched");
  assertEq(before.currentCueId, null, "caller's slot untouched");
  assertEq(decision.state.activeSinceMs.get("t.trunk-lean"), 500, "successor carries the clock");
});

console.log(`\n  ${testsPassed} passed, ${testsFailed} failed\n`);
process.exit(testsFailed === 0 ? 0 : 1);
