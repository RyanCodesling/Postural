/**
 * Regression coverage for the coaching-shadow capture-boundary export guard.
 * Run with: npx tsx src/lib/pose/coachingShadowPlan.test.ts
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { shouldBlockCoachingShadowPlanAdvance } from "./coachingShadowPlan";

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
  assertEq(directIncrements.length, 1, "direct plan increments");
  assert(
    camera.includes("coachingShadowRecordsRef.current.length") &&
      camera.includes("coachingShadowExportedRef.current"),
    "the shared callback must re-check the live ring and export refs",
  );
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
