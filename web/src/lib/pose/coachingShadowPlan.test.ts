/**
 * Regression coverage for the coaching-shadow capture-boundary export guard.
 * Run with: npx tsx src/lib/pose/coachingShadowPlan.test.ts
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  shouldBlockCoachingShadowPlanAdvance,
  shouldBlockCoachingShadowPlanTransition,
} from "./coachingShadowPlan";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  PASS ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  FAIL ${name}`);
    console.log(`      ${error instanceof Error ? error.message : String(error)}`);
    failed += 1;
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function assertEq(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const plan = [
  { startsCapture: true },
  {},
  { startsCapture: true },
  {},
] as const;

console.log("\ncoachingShadowPlan - capture-boundary export guard\n");

test("allows movement between segments of the same capture", () => {
  assertEq(
    shouldBlockCoachingShadowPlanAdvance(plan, 0, 25, false),
    false,
    "same-capture advance",
  );
});

test("blocks movement into the next capture when decisions are unexported", () => {
  assertEq(
    shouldBlockCoachingShadowPlanAdvance(plan, 1, 25, false),
    true,
    "capture-boundary advance",
  );
});

test("blocks completion of the final capture when decisions are unexported", () => {
  assertEq(
    shouldBlockCoachingShadowPlanAdvance(plan, 3, 25, false),
    true,
    "plan completion",
  );
});

test("allows capture-boundary movement after export or with an empty ring", () => {
  assertEq(
    shouldBlockCoachingShadowPlanAdvance(plan, 1, 25, true),
    false,
    "exported capture",
  );
  assertEq(
    shouldBlockCoachingShadowPlanAdvance(plan, 1, 0, false),
    false,
    "empty capture",
  );
});

test("both CameraClient Next controls use the shared guarded advance callback", () => {
  const camera = readFileSync(
    fileURLToPath(new URL("../../app/(app)/camera/CameraClient.tsx", import.meta.url)),
    "utf8",
  );
  const sharedHandlers = camera.match(/onClick=\{advanceCoachingShadowPlan\}/g) ?? [];
  const directIncrements =
    camera.match(/setCoachingPlanIndex\(\(i\) => i \+ 1\)/g) ?? [];

  assertEq(sharedHandlers.length, 2, "shared Next handlers");
  assertEq(directIncrements.length, 0, "direct plan increments");
  assert(
    camera.includes("coachingShadowRecordsRef.current.length") &&
      camera.includes("coachingShadowExportedRef.current"),
    "the shared callback must re-check the live ring and export refs",
  );
});

// ── BACKWARD AND RESET TRANSITIONS ──────────────────────────────────────────
//
// These exist because the original guard only inspected `plan[index + 1]`, and
// the suite above only asserted things about FORWARD movement. Both checks
// passed while the main panel's Back button and its "plan complete" restart set
// the index directly, so either could leave a capture with the ring unexported.
//
// The invariant is "do not LEAVE a capture that holds unexported decisions",
// which says nothing about direction. Testing the invariant rather than the
// shape of the previous fix is the point of this section.

test("blocks stepping BACK out of a capture with unexported decisions", () => {
  // index 2 is the first step of the second capture; back is index 1.
  assertEq(
    shouldBlockCoachingShadowPlanTransition(plan, 2, 1, 25, false),
    true,
    "backward across a capture boundary",
  );
});

test("allows stepping BACK within the same capture", () => {
  assertEq(
    shouldBlockCoachingShadowPlanTransition(plan, 3, 2, 25, false),
    false,
    "backward inside one capture",
  );
  assertEq(
    shouldBlockCoachingShadowPlanTransition(plan, 1, 0, 25, false),
    false,
    "backward inside the first capture",
  );
});

test("blocks the plan-complete RESTART jumping over capture boundaries", () => {
  assertEq(
    shouldBlockCoachingShadowPlanTransition(plan, 3, 0, 25, false),
    true,
    "restart from the last step",
  );
});

test("backward and restart are permitted once exported or with an empty ring", () => {
  assertEq(shouldBlockCoachingShadowPlanTransition(plan, 2, 1, 25, true), false, "exported, backward");
  assertEq(shouldBlockCoachingShadowPlanTransition(plan, 3, 0, 0, false), false, "empty ring, restart");
});

test("leaving the plan in either direction counts as leaving the capture", () => {
  assertEq(shouldBlockCoachingShadowPlanTransition(plan, 3, 4, 25, false), true, "past the end");
  assertEq(shouldBlockCoachingShadowPlanTransition(plan, 0, -1, 25, false), true, "before the start");
});

test("the forward wrapper still agrees with the general transition check", () => {
  for (let i = -1; i <= plan.length; i++) {
    assertEq(
      shouldBlockCoachingShadowPlanAdvance(plan, i, 25, false),
      shouldBlockCoachingShadowPlanTransition(plan, i, i + 1, 25, false),
      `wrapper agrees at index ${i}`,
    );
  }
});

test("NO CameraClient control sets the plan index outside the guarded callback", () => {
  // Written against the invariant, not against one known bad pattern: every
  // `setCoachingPlanIndex` call must be either the useState declaration or the
  // single assignment inside the guarded mover.
  const camera = readFileSync(
    fileURLToPath(new URL("../../app/(app)/camera/CameraClient.tsx", import.meta.url)),
    "utf8",
  );
  const calls = camera.match(/setCoachingPlanIndex\((?!\)).*/g) ?? [];
  const declaration = camera.match(/const \[coachingPlanIndex, setCoachingPlanIndex\] = useState/g) ?? [];
  assertEq(declaration.length, 1, "state declaration");
  assertEq(calls.length, 1, "plan-index writes outside the guarded mover");
  assert(
    /onClick=\{stepBackCoachingShadowPlan\}/.test(camera),
    "the Back control must use the guarded callback",
  );
  assert(
    /onClick=\{restartCoachingShadowPlan\}/.test(camera),
    "the restart control must use the guarded callback",
  );
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
