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

// ── HEAD-Y CEILING, DEFAULT MODE ────────────────────────────────────────────
// Relaxed 0.25 -> 0.35 on 2026-09-07. A recorded session measured the ear line
// at y = 0.250 during a deliberate backward lean — flush against the old
// ceiling — and the transitions crossed it. Each crossing was a readiness
// dropout, and a dropout used to re-run neutral calibration, which re-anchored
// "neutral" to the leaning posture. The gate was rejecting ordinary postural
// movement, not bad framing.

/** `readyLandmarks()` with the nose moved to a given normalized y. */
function landmarksWithHeadY(y: number) {
  const landmarks = readyLandmarks();
  landmarks[0] = { x: 0.5, y, visibility: 1 };
  return landmarks;
}

test("default mode accepts a head low enough to lean or slouch", () => {
  // 0.30 sits past the OLD 0.25 ceiling and inside the new one. This is the
  // case that was silently costing recordings.
  const result = evaluateCaptureReadiness(landmarksWithHeadY(0.30), 1280, 720, "default", "both");
  assert(result.ok, `head at y=0.30 must be accepted in default mode, got ${result.status}`);
});

test("default mode still rejects a head that has dropped too far", () => {
  const result = evaluateCaptureReadiness(landmarksWithHeadY(0.45), 1280, 720, "default", "both");
  assert(!result.ok, "head at y=0.45 must still fail in default mode");
  // Deliberately NOT asserting which gate rejects it. At this depth the body no
  // longer fits the frame, so MOVE_CLOSER fires before the head-y ceiling is
  // reached — which is the behaviour the relaxation relies on: the head bound
  // was only ever a proxy for "does the body still fit", and the gates that
  // test that directly are still doing the work. Pinning the status here would
  // assert the proxy rather than the property.
  assert(
    result.status === "HEAD_NOT_POSITIONED" || result.status === "MOVE_CLOSER",
    `expected a framing rejection, got ${result.status}`,
  );
});

test("the default ceiling sits between the measured lean and the overhead mode", () => {
  // Bracketing rather than asserting the literal: the bound must clear the
  // measured worst case (0.252) with margin, and must not quietly grow into
  // overhead mode's 0.45, which assumes the patient stands further back.
  const accepted = (y: number) =>
    evaluateCaptureReadiness(landmarksWithHeadY(y), 1280, 720, "default", "both").ok;
  assert(accepted(0.252), "must clear the measured lean posture");
  assert(!accepted(0.45), "must stay short of the overhead ceiling");
});

test("the top of the frame is still guarded in default mode", () => {
  const result = evaluateCaptureReadiness(landmarksWithHeadY(0.01), 1280, 720, "default", "both");
  assert(!result.ok, "a head cut off at the top must still fail");
});

test("overhead and lateral ceilings are untouched by the default change", () => {
  const okAt = (y: number, mode: "overhead" | "lateral") =>
    evaluateCaptureReadiness(landmarksWithHeadY(y), 1280, 720, mode, "both").ok;
  assert(okAt(0.44, "overhead"), "overhead must still accept 0.44");
  assert(!okAt(0.46, "overhead"), "overhead must still reject 0.46");
  assert(okAt(0.90, "lateral"), "lateral must still accept 0.90");
});

console.log("\ncaptureReadiness - side-bend (lateral) knee and hip gate\n");

// A live side-bend session (2026-10-02) lost frames and bends because the knee
// visibility score fell below 0.5 at the bottom of deep bends while both knees
// stayed inside the picture and unobstructed.
test("lateral mode accepts in-frame knees whose visibility score drops", () => {
  const landmarks = readyLandmarks();
  landmarks[25].visibility = 0.3;
  landmarks[26].visibility = 0.2;
  const result = evaluateCaptureReadiness(landmarks, 1280, 720, "lateral", "both");
  assert(result.ok, `expected ok, got ${result.status}`);
});

test("lateral mode still rejects a knee outside the picture", () => {
  const landmarks = readyLandmarks();
  landmarks[26] = { x: 0.58, y: 1.04, visibility: 0.9 };
  const result = evaluateCaptureReadiness(landmarks, 1280, 720, "lateral", "both");
  assert(!result.ok && result.status === "KNEES_NOT_VISIBLE", `expected KNEES_NOT_VISIBLE, got ${result.status}`);
});

test("lateral mode rejects poorly detected or clipped hips", () => {
  const faint = readyLandmarks();
  faint[23].visibility = 0.3;
  const a = evaluateCaptureReadiness(faint, 1280, 720, "lateral", "both");
  assert(!a.ok && a.status === "HIPS_NOT_VISIBLE", `expected HIPS_NOT_VISIBLE, got ${a.status}`);
  const clipped = readyLandmarks();
  clipped[24] = { x: 1.02, y: 0.6, visibility: 0.9 };
  const b = evaluateCaptureReadiness(clipped, 1280, 720, "lateral", "both");
  assert(!b.ok && b.status === "HIPS_NOT_VISIBLE", `expected HIPS_NOT_VISIBLE, got ${b.status}`);
});

test("default and overhead modes keep the knee visibility requirement", () => {
  for (const mode of ["default", "overhead"] as const) {
    const landmarks = readyLandmarks();
    landmarks[25].visibility = 0.3;
    if (mode === "overhead") landmarks[0] = { x: 0.5, y: 0.3, visibility: 1 };
    const result = evaluateCaptureReadiness(landmarks, 1280, 720, mode, "both");
    assert(!result.ok && result.status === "KNEES_NOT_VISIBLE", `${mode}: expected KNEES_NOT_VISIBLE, got ${result.status}`);
  }
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exitCode = 1;
