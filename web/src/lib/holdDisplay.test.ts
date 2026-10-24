/**
 * Tests for the per-arm hold display (ex_006).
 * Run with: npx tsx src/lib/holdDisplay.test.ts
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { perArmHoldDisplay } from "./holdDisplay";

const camera = readFileSync(
  fileURLToPath(new URL("../app/(app)/camera/CameraClient.tsx", import.meta.url)),
  "utf8",
);

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

const both = { holdSeconds: 30, prescribedSide: "both" as const };

test("the main number is the slower arm for a both-arms prescription", () => {
  // The arms reached the band 0.5 s apart: their own numbers can differ, the main one cannot.
  const view = perArmHoldDisplay({ leftSec: 13.4, rightSec: 12.9, leftInBand: true, rightInBand: true }, both);
  assertEq(view.seconds, 12, "main number");
  assertEq(view.arms.map((a) => [a.label, a.seconds]), [["L", 13], ["R", 12]], "per-arm seconds");
});

test("the main number follows the prescribed arm when only one is prescribed", () => {
  const view = perArmHoldDisplay(
    { leftSec: 4.2, rightSec: 21.7, leftInBand: true, rightInBand: true },
    { holdSeconds: 30, prescribedSide: "right" },
  );
  assertEq(view.seconds, 21, "main number");
  assertEq(view.arms.map((a) => a.observation), [true, false], "the left arm is observation only");
});

test("an arm out of position is paused, and one that reached the hold stays done", () => {
  const view = perArmHoldDisplay({ leftSec: 30.2, rightSec: 17.6, leftInBand: false, rightInBand: false }, both);
  assertEq(view.arms.map((a) => a.tone), ["done", "paused"], "tones");
  const counting = perArmHoldDisplay({ leftSec: 5, rightSec: 5, leftInBand: true, rightInBand: false }, both);
  assertEq(counting.arms.map((a) => a.tone), ["counting", "paused"], "tones while holding");
});

test("the main number is done exactly when the set's credited hold is reached", () => {
  assertEq(perArmHoldDisplay({ leftSec: 31, rightSec: 29.99, leftInBand: true, rightInBand: true }, both).done, false, "29.99 s");
  assertEq(perArmHoldDisplay({ leftSec: 31, rightSec: 30, leftInBand: true, rightInBand: true }, both).done, true, "30 s");
});

test("the camera's per-arm hold uses this display, and the side-split hold keeps its own", () => {
  const hud = camera.slice(camera.indexOf("function CameraSetHud("));
  const perLimb = hud.indexOf('activeDefinition.bilateralMode === "per-limb"');
  const sideSplit = hud.indexOf('} else if (activeDefinition.kind === "isometric" && activeDefinition.bilateral) {');
  if (perLimb === -1 || sideSplit === -1) throw new Error("the per-limb and side-split hold branches must both exist");
  const branch = hud.slice(perLimb, sideSplit);
  if (!branch.includes("perArmHoldDisplay(holdState, prescription)")) throw new Error("the per-limb branch must draw from perArmHoldDisplay");
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
