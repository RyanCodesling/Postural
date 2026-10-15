/**
 * Regression tests for therapist session read models.
 * Run with: npx tsx src/lib/sessionReadModels.test.ts
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildCaptureQualitySummary, parseCaptureQualitySummary, summarizeDeviceInfo } from "./sessionReadModels";

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

console.log("\nsessionReadModels - therapist readback tests\n");

test("session list outer projection includes isometric compensation", () => {
  const dbSource = readFileSync(fileURLToPath(new URL("./db.ts", import.meta.url)), "utf8");
  const start = dbSource.indexOf("export async function getSessionsForPatient");
  const end = dbSource.indexOf("export async function getTherapistRoster", start);
  const querySection = dbSource.slice(start, end);
  const outerSelect = querySection.slice(0, querySection.indexOf("FROM sessions s"));
  assert(
    outerSelect.includes("st.avg_compensation_score"),
    "getSessionsForPatient outer SELECT must project st.avg_compensation_score",
  );
});

test("capture summary accepts the persisted numeric shape", () => {
  const parsed = parseCaptureQualitySummary({ framesTotal: 300, framesOk: 276, pctOk: 92 });
  assert(parsed?.pctOk === 92, "expected 92% capture quality");
  assert(parsed?.framesOk === 276, "expected valid frame count");
});

test("capture summary saves and reads back why frames were rejected", () => {
  const saved = buildCaptureQualitySummary({
    total: 300, ok: 270, rejectedByStatus: { KNEES_NOT_VISIBLE: 26, NOT_VISIBLE: 4 }, dropoutResets: 2,
  });
  const parsed = parseCaptureQualitySummary(JSON.parse(JSON.stringify(saved)));
  assert(parsed?.pctOk === 90, "expected 90% capture quality");
  assert(parsed?.rejectedFramesByStatus?.KNEES_NOT_VISIBLE === 26, "expected the knee rejections");
  assert(parsed?.rejectedFramesByStatus?.NOT_VISIBLE === 4, "expected the no-person frames");
  assert(parsed?.sustainedDropoutResets === 2, "expected the dropout resets");
  assert(buildCaptureQualitySummary({ total: 0, ok: 0, rejectedByStatus: {}, dropoutResets: 0 }) === undefined,
    "no active frame, no summary");
  const older = parseCaptureQualitySummary({ framesTotal: 300, framesOk: 276, pctOk: 92 });
  assert(older !== null && older.rejectedFramesByStatus === undefined && older.sustainedDropoutResets === undefined,
    "older summaries read as before");
  const inconsistent = parseCaptureQualitySummary({
    framesTotal: 10, framesOk: 8, pctOk: 80, rejectedFramesByStatus: { KNEES_NOT_VISIBLE: 5 },
  });
  assert(inconsistent?.pctOk === 80 && inconsistent.rejectedFramesByStatus === undefined,
    "more rejected frames than frames not OK drops only the detail");
});

test("capture summary saves and reads back the unsteady frames", () => {
  const saved = buildCaptureQualitySummary({
    total: 300, ok: 270, rejectedByStatus: {}, dropoutResets: 0, unsteady: 40,
  });
  const parsed = parseCaptureQualitySummary(JSON.parse(JSON.stringify(saved)));
  assert(parsed?.unsteadyFrames === 40, "expected the unsteady frames");
  const older = parseCaptureQualitySummary({ framesTotal: 300, framesOk: 276, pctOk: 92 });
  assert(older !== null && older.unsteadyFrames === undefined, "older summaries have none");
  const tooMany = parseCaptureQualitySummary({ framesTotal: 10, framesOk: 8, pctOk: 80, unsteadyFrames: 9 });
  assert(tooMany?.pctOk === 80 && tooMany.unsteadyFrames === undefined,
    "more unsteady frames than tracked frames drops only the count");
  const checked = parseCaptureQualitySummary(buildCaptureQualitySummary({
    total: 300, ok: 270, rejectedByStatus: {}, dropoutResets: 0, unsteady: 40, checked: 250,
  }));
  assert(checked?.checkedFrames === 250 && checked.unsteadyFrames === 40, "the checked frames are saved and read back");
  assert(older?.checkedFrames === undefined, "older summaries have no checked count");
  const tooManyChecked = parseCaptureQualitySummary({ framesTotal: 10, framesOk: 8, pctOk: 80, checkedFrames: 9 });
  assert(tooManyChecked?.pctOk === 80 && tooManyChecked.checkedFrames === undefined,
    "more checked frames than tracked frames drops only the count");
});

test("capture summary saves and reads back every camera frame size, largest count first", () => {
  const saved = buildCaptureQualitySummary({
    total: 300, ok: 270, rejectedByStatus: {}, dropoutResets: 0, frameSizes: { "640x480": 70, "1280x720": 200 },
  });
  const parsed = parseCaptureQualitySummary(JSON.parse(JSON.stringify(saved)));
  assert(JSON.stringify(parsed?.frameSizes) === JSON.stringify([
    { width: 1280, height: 720, frames: 200 }, { width: 640, height: 480, frames: 70 },
  ]), `both sizes, largest first: ${JSON.stringify(parsed?.frameSizes)}`);
  const single = parseCaptureQualitySummary(buildCaptureQualitySummary({
    total: 300, ok: 270, rejectedByStatus: {}, dropoutResets: 0, frameSizes: { "1280x720": 270 },
  }));
  assert(single?.frameSizes?.length === 1 && single.frameSizes[0].frames === 270, "one size");
  const none = buildCaptureQualitySummary({ total: 300, ok: 270, rejectedByStatus: {}, dropoutResets: 0, frameSizes: {} });
  assert(none !== undefined && none.frameSizes === undefined, "no measured frame, no field");
  const older = parseCaptureQualitySummary({ framesTotal: 300, framesOk: 276, pctOk: 92 });
  assert(older !== null && older.frameSizes === undefined, "older summaries have no frame sizes");
  const bad: unknown[] = [
    [{ width: 0, height: 720, frames: 5 }], [{ width: 1280.5, height: 720, frames: 5 }], [{ width: "1280", height: 720, frames: 5 }],
    [{ width: 20000, height: 720, frames: 5 }], [{ width: 1280, height: 720, frames: -1 }], [{ width: 1280, height: 720, frames: 9 }],
    [{ width: 1280, height: 720, frames: 2 }, { width: 1280, height: 720, frames: 2 }], { "1280x720": 9 }, { "1280-720": 3 }, "1280x720", [],
  ];
  for (const value of bad) {
    const parsedBad = parseCaptureQualitySummary({ framesTotal: 10, framesOk: 8, pctOk: 80, frameSizes: value });
    assert(parsedBad?.pctOk === 80 && parsedBad.frameSizes === undefined, `malformed or too many frames drops only the field: ${JSON.stringify(value)}`);
  }
});

test("capture summary rejects inconsistent frame counts", () => {
  assert(
    parseCaptureQualitySummary({ framesTotal: 10, framesOk: 12, pctOk: 100 }) === null,
    "framesOk greater than framesTotal must be rejected",
  );
});

test("device readback returns coarse labels without the user-agent", () => {
  const parsed = summarizeDeviceInfo({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit Chrome/140.0 Safari/537.36",
  });
  assert(parsed?.browser === "Chrome", "expected Chrome label");
  assert(parsed?.platform === "Windows", "expected Windows label");
  assert(!("userAgent" in (parsed ?? {})), "full user-agent must not be returned");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exitCode = 1;
