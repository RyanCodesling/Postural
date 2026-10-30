/**
 * Tests for the display-only past-shoulder-height check on lateral arm raises (overRaiseWarning.ts).
 * Run with: npx tsx src/lib/pose/overRaiseWarning.test.ts
 */

import { getExerciseDefinition, type CoachingCheckSpec } from "../exercises/registry";
import { exerciseVersionPayload } from "../exercises/versionPayload";
import { newOverRaiseState, updateOverRaise, type OverRaiseCheck, type OverRaiseState } from "./overRaiseWarning";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`      ${error instanceof Error ? error.message : String(error)}`);
    failed += 1;
  }
}

function assertEq(actual: unknown, expected: unknown, label: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const CHECK: OverRaiseCheck = { persistMs: 100, clearBelow: 112.5 };
const LINE = 115;

/** Feeds one arm's readings (one every 50 ms) and returns each frame's warning value and side. */
function run(readings: (number | null)[], sides: ("left" | "right")[] = ["left", "right"], arm: "left" | "right" = "left") {
  let state: OverRaiseState = newOverRaiseState();
  return readings.map((r, i) => {
    const result = updateOverRaise(
      state,
      { left: arm === "left" ? r : 20, right: arm === "right" ? r : 20, sides, nowMs: i * 50 },
      CHECK,
      LINE,
    );
    state = result.state;
    return { value: result.value, side: result.side };
  });
}

console.log("\noverRaiseWarning - past shoulder height on lateral arm raises\n");

test("a raise to shoulder height never reaches the line", () => {
  const out = run([20, 40, 70, 90, 100, 102, 95, 60, 30, 20]);
  for (const f of out) if (f.value !== null && f.value >= LINE) throw new Error(`value ${f.value} reached the line`);
});

test("a reading held at the line for 100 ms flags the arm, and correction clears the live warning", () => {
  const out = run([40, 90, 116, 120, 130, 125, 100, 80, 50, 31, 20]);
  // 116 at 100 ms, 120 at 150 ms (50 ms over), 130 at 200 ms (100 ms over): flagged from here.
  assertEq(out[3].value, null, "not yet flagged at 50 ms");
  assertEq(out[4].value, 130, "flagged at 100 ms");
  assertEq(out.slice(5, 9).map((f) => f.value), [125, null, null, null], "live value then clear on correction");
  assertEq(out[9].value, null, "back below the repetition start: the flag ends");
});

test("a brief spike over the line does not flag the arm", () => {
  const out = run([40, 90, 118, 100, 95, 100, 30]);
  assertEq(out.map((f) => f.value), [null, null, null, null, null, null, null], "a brief spike is not confirmed");
});

test("a frame without a reading clears a live warning and breaks a pending run", () => {
  const flagged = run([40, 120, 121, 125, null, null, 90]);
  assertEq(flagged.slice(4).map((f) => f.value), [null, null, null], "a live instruction cannot survive a missing reading");
  const pending = run([40, 120, null, 121, 122, 90]);
  // The run restarts at 121 (150 ms) and is only 50 ms old at 122: no flag.
  assertEq(pending.map((f) => f.value), [null, null, null, null, null, null], "the gap broke the run");
});

test("a confirmed over-raise clears when corrected to shoulder height without returning to rest", () => {
  const out = run([40, 120, 121, 125, 90, 90]);
  assertEq(out[3].value, 125, "warning confirmed");
  assertEq(out[4].value, null, "corrected at shoulder height");
});

test("the existing clear-level deadband tolerates a small dip but requires a fresh wait after correction", () => {
  const out = run([120, 121, 125, 114, 113, 112.5, 114, 120, 121, 125]);
  assertEq(out.slice(2, 5).map((f) => f.value), [125, 115, 115], "the existing hysteresis band keeps a confirmed warning");
  assertEq(out.slice(5, 9).map((f) => f.value), [null, null, null, null], "correction clears it and restarts confirmation");
  assertEq(out[9].value, 125, "new run confirmed after 100 ms");
});

test("only prescribed arms raise the warning, and with both flagged the higher arm is the warning", () => {
  const unprescribed = run([40, 120, 125, 130, 60], ["left"], "right");
  for (const f of unprescribed) if (f.side === "right") throw new Error("the unprescribed right arm raised the warning");
  let state = newOverRaiseState();
  let last: ReturnType<typeof updateOverRaise> | null = null;
  for (const [i, [l, r]] of [[120, 125], [121, 130], [122, 131], [123, 132]].entries()) {
    last = updateOverRaise(state, { left: l, right: r, sides: ["left", "right"], nowMs: i * 50 }, CHECK, LINE);
    state = last.state;
  }
  assertEq([last?.value, last?.side], [132, "right"], "the higher arm");
});

test("with both arms flagged, the warning stays on its arm while that arm is still flagged", () => {
  // Rehearsal session 245 (2026-10-28): on one high raise the label went left, right, left within 0.86 s, as the two
  // arms traded the higher reading.
  let state = newOverRaiseState();
  const out = [[120, 116], [121, 117], [125, 118], [124, 126], [123, 127], [126, 125], [124, 128], [111, 129], [110, 128]].map(([l, r], i) => {
    const result = updateOverRaise(state, { left: l, right: r, sides: ["left", "right"], nowMs: i * 50 }, CHECK, LINE);
    state = result.state;
    return { value: result.value, side: result.side };
  });
  assertEq(out.map((f) => f.side), [null, null, "left", "left", "left", "left", "left", "right", "right"], "sides");
  assertEq(out[3].value, 124, "the kept arm's own reading is the warning");
  assertEq(out[7].value, 129, "once the left arm is corrected, the right arm takes over");
});

test("the registry declares the check on lateral arm raises only, last in priority, outside the measurement version", () => {
  const def = getExerciseDefinition("ex_001")!;
  const check = (def.coachingChecks ?? []).find((c): c is Extract<CoachingCheckSpec, { name: "overRaise" }> => c.name === "overRaise");
  if (!check) throw new Error("ex_001 must declare the overRaise check");
  assertEq([check.warningThreshold, check.compareDirection, check.check.mode, check.check.persistMs], [115, "above", "over-raise", 100], "line, direction, mode, persistence");
  if (def.kind !== "dynamic" || !(check.warningThreshold > def.primaryMetric.thresholds.targetROM)) {
    throw new Error("the line must sit above the full-range line");
  }
  const priorities = [...def.compensationMetrics.map((m) => m.cue?.priority ?? 0), ...(def.coachingChecks ?? []).filter((c) => c !== check).map((c) => c.cue.priority)];
  if (!priorities.every((p) => p < check.cue.priority)) throw new Error("the check must be last in priority");
  for (const id of ["ex_002", "ex_003", "ex_004", "ex_005", "ex_006", "ex_007", "ex_008"]) {
    if ((getExerciseDefinition(id)?.coachingChecks ?? []).some((c) => c.name === "overRaise")) throw new Error(`${id} must not declare it`);
  }
  if (JSON.stringify(exerciseVersionPayload(def)).includes("overRaise")) throw new Error("the check must stay out of the measurement version");
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
