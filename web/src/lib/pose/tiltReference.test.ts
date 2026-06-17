/**
 * tiltReference.test.ts
 *
 * Pins the split between two low-confidence tilt states:
 * - one reference line missing: actionable patient framing warning
 * - both references visible but divergent: retain low confidence internally
 *   without showing the persistent patient framing warning
 *
 * USAGE
 *   npx tsx src/lib/pose/tiltReference.test.ts
 */

import { strict as assert } from "node:assert";
import {
  computeTiltReference,
  hasMissingTiltReferenceLine,
} from "./poseMetrics";

type TestLandmark = { x: number; y: number; visibility: number };

function makeLandmarks(opts: {
  hideHips?: boolean;
  hideEars?: boolean;
  divergentEars?: boolean;
} = {}): TestLandmark[] {
  const landmarks = Array.from({ length: 33 }, () => ({
    x: 0,
    y: 0,
    visibility: 0,
  }));

  landmarks[23] = { x: 0.58, y: 0.60, visibility: opts.hideHips ? 0.1 : 1 };
  landmarks[24] = { x: 0.42, y: 0.60, visibility: opts.hideHips ? 0.1 : 1 };

  landmarks[7] = { x: 0.56, y: 0.22, visibility: opts.hideEars ? 0.1 : 1 };
  landmarks[8] = {
    x: 0.44,
    y: opts.divergentEars ? 0.24 : 0.22,
    visibility: opts.hideEars ? 0.1 : 1,
  };

  return landmarks;
}

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`PASS ${name}`);
    passed += 1;
  } catch (err) {
    console.log(`FAIL ${name}`);
    console.log(`     ${err instanceof Error ? err.message : String(err)}`);
    failed += 1;
  }
}

test("single visible reference line shows patient missing-reference warning", () => {
  const ref = computeTiltReference(makeLandmarks({ hideEars: true }));

  assert.equal(ref.confidence, "low");
  assert.equal(ref.divergenceDeg, null);
  assert.equal(hasMissingTiltReferenceLine(ref), true);
});

test("visible hip-ear divergence stays low confidence without patient framing warning", () => {
  const ref = computeTiltReference(makeLandmarks({ divergentEars: true }));

  assert.equal(ref.confidence, "low");
  assert.ok(ref.divergenceDeg !== null);
  assert.ok(ref.divergenceDeg > 3);
  assert.equal(hasMissingTiltReferenceLine(ref), false);
});

test("matching visible references are high confidence", () => {
  const ref = computeTiltReference(makeLandmarks());

  assert.equal(ref.confidence, "high");
  assert.equal(hasMissingTiltReferenceLine(ref), false);
});

test("missing both references is insufficient, not low-confidence warning", () => {
  const ref = computeTiltReference(makeLandmarks({ hideHips: true, hideEars: true }));

  assert.equal(ref.confidence, "insufficient");
  assert.equal(ref.divergenceDeg, null);
  assert.equal(hasMissingTiltReferenceLine(ref), false);
});

console.log(`\n${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
}
