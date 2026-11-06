/**
 * Run with: npx tsx src/lib/sessionOutcomePresentation.test.ts
 */

import { strict as assert } from "node:assert";
import {
  fullRomOutcomeText,
  prescribedOutcomeSides,
  prescribedValue,
  shouldShowOutcomeAsymmetry,
} from "./sessionOutcomePresentation";

assert.deepEqual(
  prescribedOutcomeSides("both"),
  ["left", "right"],
  "bilateral outcomes must keep both sides separate",
);
assert.deepEqual(
  prescribedOutcomeSides("left"),
  ["left"],
  "left-only outcomes must not present the right observation as treatment",
);
assert.deepEqual(
  prescribedOutcomeSides("right"),
  ["right"],
  "right-only outcomes must not present the left observation as treatment",
);
assert.equal(shouldShowOutcomeAsymmetry("both"), true);
assert.equal(shouldShowOutcomeAsymmetry("left"), false);
assert.equal(shouldShowOutcomeAsymmetry("right"), false);
assert.equal(
  prescribedValue("right", { left: 8_000, right: 12_000 }, 8_000),
  12_000,
  "a unilateral hold must credit its prescribed side, not the bilateral minimum",
);
assert.equal(
  prescribedValue("both", { left: 8_000, right: 12_000 }, 8_000),
  8_000,
  "a bilateral hold remains gated by its paired/slower-side value",
);
assert.equal(fullRomOutcomeText(2, 3), "2/3 met full-ROM target");

console.log("sessionOutcomePresentation: 9 assertions passed");
