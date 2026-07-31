/**
 * Regression tests for prescription-side capture gating.
 * Run with: npx tsx src/lib/pose/captureReadiness.test.ts
 */

import { evaluateCaptureReadiness } from "./captureReadiness";

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

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function readyLandmarks() {
  const landmarks = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    visibility: 1,
  }));
  landmarks[0] = { x: 0.5, y: 0.2, visibility: 1 };
  landmarks[15] = { x: 0.35, y: 0.5, visibility: 1 };
  landmarks[16] = { x: 0.65, y: 0.5, visibility: 1 };
  landmarks[25] = { x: 0.42, y: 0.85, visibility: 1 };
  landmarks[26] = { x: 0.58, y: 0.85, visibility: 1 };
  return landmarks;
}

console.log("\ncaptureReadiness - prescribed-side wrist gating\n");

test("left-side prescription requires the mirrored raw right wrist", () => {
  const landmarks = readyLandmarks();
  landmarks[15].visibility = 0;
  const result = evaluateCaptureReadiness(
    landmarks,
    1280,
    720,
    "default",
    "left",
  );
  assert(result.ok, "an invisible unprescribed anatomical right wrist must not block capture");
});

test("left-side prescription rejects a missing anatomical left wrist", () => {
  const landmarks = readyLandmarks();
  landmarks[16].visibility = 0;
  const result = evaluateCaptureReadiness(
    landmarks,
    1280,
    720,
    "default",
    "left",
  );
  assert(!result.ok, "the prescribed anatomical left wrist must be required");
  assert(
    result.message.includes("left hand"),
    "the message must use the patient's anatomical side",
  );
});

test("both-side prescription still requires both wrists", () => {
  const landmarks = readyLandmarks();
  landmarks[15].visibility = 0;
  const result = evaluateCaptureReadiness(
    landmarks,
    1280,
    720,
    "default",
    "both",
  );
  assert(!result.ok, "both-side work must retain bilateral wrist gating");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exitCode = 1;
