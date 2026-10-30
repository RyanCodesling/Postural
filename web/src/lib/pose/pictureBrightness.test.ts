/**
 * Tests for the picture-brightness wording of the no-person and tracking messages (pictureBrightness.ts).
 * Run with: npx tsx src/lib/pose/pictureBrightness.test.ts
 */

import {
  BRIGHT_PICTURE_LUMA,
  DARK_PICTURE_LUMA,
  DARK_PICTURE_MESSAGE,
  captureMessageForPicture,
  meanLuma,
  pictureIsBright,
  pictureIsDark,
  samplePictureLuma,
} from "./pictureBrightness";
import { trackingMessage } from "./trackingSteadiness";

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

/** RGBA pixels of one colour. */
const pixels = (r: number, g: number, b: number, n = 4) => Array.from({ length: n }, () => [r, g, b, 255]).flat();

console.log("\npictureBrightness - the wording of the no-person and tracking messages\n");

test("mean luma uses Rec. 601 weights and ignores alpha", () => {
  assertEq(meanLuma(pixels(0, 0, 0)), 0, "black");
  assertEq(meanLuma(pixels(255, 255, 255)), 255, "white");
  const red = meanLuma(pixels(100, 0, 0));
  if (red === null || Math.abs(red - 29.9) > 1e-9) throw new Error(`red ${red}`);
  assertEq(meanLuma([]), null, "no pixels");
});

test("the lines sit between where tracking failed and ordinary rooms", () => {
  // Full-range luma: tracking held at 21.5 and failed at 15.4 or below in the darkened clip; the researcher's sessions
  // read 75-105 and the evaluation server's session 3 103.
  for (const failedAt of [15.4, 12.7]) if (!pictureIsDark(failedAt)) throw new Error(`${failedAt} must be dark`);
  for (const ordinary of [75.4, 84.6, 102.6, 104.8]) {
    if (pictureIsDark(ordinary)) throw new Error(`${ordinary} must not be dark`);
    if (!pictureIsBright(ordinary)) throw new Error(`${ordinary} must be bright`);
  }
  if (!(DARK_PICTURE_LUMA > 21.5 && DARK_PICTURE_LUMA < BRIGHT_PICTURE_LUMA && BRIGHT_PICTURE_LUMA <= 75)) throw new Error("line order");
  assertEq([pictureIsDark(null), pictureIsBright(null)], [false, false], "unknown brightness is neither");
});

test("a failed detection in a dark picture names the light; every other message is kept", () => {
  const noPerson = "No person detected. Step into the frame.";
  assertEq(captureMessageForPicture("NOT_VISIBLE", noPerson, 20), DARK_PICTURE_MESSAGE, "no person, dark");
  assertEq(captureMessageForPicture("LOW_CONFIDENCE", "Hold still and ensure good lighting.", 20), DARK_PICTURE_MESSAGE, "low visibility, dark");
  assertEq(captureMessageForPicture("NOT_VISIBLE", noPerson, 90), noPerson, "no person in an ordinary room");
  assertEq(captureMessageForPicture("NOT_VISIBLE", noPerson, null), noPerson, "brightness unknown");
  assertEq(captureMessageForPicture("KNEES_NOT_VISIBLE", "Step back.", 20), "Step back.", "a framing message stays");
});

test("the tracking message names the arm and leaves out 'More light' in a bright picture", () => {
  const dim = trackingMessage("leftArm");
  if (!dim.includes("your left arm") || !dim.includes("More light")) throw new Error(dim);
  const bright = trackingMessage("rightArm", { bright: true });
  if (!bright.includes("your right arm") || bright.includes("More light") || !bright.includes("plainer background")) throw new Error(bright);
  if (!trackingMessage("trunk").includes("your shoulders and hips") || !trackingMessage("head").includes("your head")) {
    throw new Error("trunk and head wording");
  }
});

test("sampling outside a browser reads nothing instead of failing", () => {
  assertEq(samplePictureLuma({ readyState: 4 }, { canvas: null }), null, "no document");
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
