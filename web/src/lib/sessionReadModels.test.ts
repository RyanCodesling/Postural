/**
 * Regression tests for therapist session read models.
 * Run with: npx tsx src/lib/sessionReadModels.test.ts
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseCaptureQualitySummary, summarizeDeviceInfo } from "./sessionReadModels";

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
