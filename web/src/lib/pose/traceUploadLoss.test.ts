/**
 * traceUploadLoss.test.ts
 *
 * Run with: npx tsx src/lib/pose/traceUploadLoss.test.ts
 *
 * ── WHY THIS SUITE EXISTS ────────────────────────────────────────────────────
 * An abandoned trace batch cannot be recovered, so the only useful thing the
 * camera page can do is say so while the person recording can still stop and
 * fix the cause. That rests on two halves. The loss record and its wording are
 * imported and run below. The wiring — that the upload loop records a loss,
 * that the warning is drawn beside the trace sync readout, and that it survives
 * the end of the session it describes — lives inside a React component behind a
 * live camera loop, so it is guarded by source-text invariants at the end.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  recordTraceBatchLoss,
  traceUploadLossLabel,
  traceUploadLossToast,
} from "./traceUploadLoss";

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

console.log("\ntrace upload loss - abandoned batches are visible\n");

// ── THE LOSS RECORD ─────────────────────────────────────────────────────────

test("the first abandoned batch starts a record for its session", () => {
  const loss = recordTraceBatchLoss(null, 210, 404);
  assertEq(loss.sessionId, 210, "session");
  assertEq(loss.droppedBatches, 1, "dropped batches");
  assertEq(loss.lastStatus, 404, "status");
});

test("losses in one session accumulate and keep the latest cause", () => {
  let loss = recordTraceBatchLoss(null, 210, 404);
  loss = recordTraceBatchLoss(loss, 210, 404);
  loss = recordTraceBatchLoss(loss, 210, null);
  assertEq(loss.droppedBatches, 3, "dropped batches");
  assertEq(loss.lastStatus, null, "a later network failure replaces the earlier status");
});

test("a loss from another session starts over instead of adding to this one", () => {
  // Upload chains outlive their session: the last batch of a session that has
  // just ended can fail after the next session has started.
  const earlier = recordTraceBatchLoss(recordTraceBatchLoss(null, 210, 404), 210, 404);
  const other = recordTraceBatchLoss(earlier, 211, 500);
  assertEq(other.sessionId, 211, "session");
  assertEq(other.droppedBatches, 1, "dropped batches");
  assertEq(other.lastStatus, 500, "status");
});

test("recording a loss leaves the previous record untouched", () => {
  // The record is React state; mutating it in place would not re-render.
  const first = recordTraceBatchLoss(null, 210, 404);
  const second = recordTraceBatchLoss(first, 210, 404);
  assert(second !== first, "a new record must be returned");
  assertEq(first.droppedBatches, 1, "the earlier record");
});

// ── THE WORDING ─────────────────────────────────────────────────────────────

test("the label names the count, the session and the HTTP status", () => {
  const label = traceUploadLossLabel({ sessionId: 210, droppedBatches: 8, lastStatus: 404 });
  assert(label.includes("8 batches"), `count missing: ${label}`);
  assert(label.includes("210"), `session missing: ${label}`);
  assert(label.includes("HTTP 404"), `status missing: ${label}`);
});

test("one batch is not pluralised", () => {
  const label = traceUploadLossLabel({ sessionId: 210, droppedBatches: 1, lastStatus: 404 });
  assert(/\b1 batch\b/.test(label), `expected the singular: ${label}`);
});

test("a failure with no response is not reported as an HTTP status", () => {
  const label = traceUploadLossLabel({ sessionId: 210, droppedBatches: 2, lastStatus: null });
  assert(label.includes("no response"), `cause missing: ${label}`);
  assert(!label.includes("HTTP"), `must not invent a status: ${label}`);
});

test("the toast names the session and the cause, and says to stop", () => {
  const toast = traceUploadLossToast({ sessionId: 210, droppedBatches: 1, lastStatus: 404 });
  assert(toast.includes("210"), `session missing: ${toast}`);
  assert(toast.includes("HTTP 404"), `status missing: ${toast}`);
  assert(/\bstop\b/i.test(toast), `no instruction to stop: ${toast}`);
});

// ── THE WIRING ──────────────────────────────────────────────────────────────
// Written against the invariant rather than one spelling, so a rewrite of the
// upload loop fails here only if it stops reporting losses.

const camera = readFileSync(
  fileURLToPath(new URL("../../app/(app)/camera/CameraClient.tsx", import.meta.url)),
  "utf8",
);

function functionBody(signature: string): string {
  const start = camera.indexOf(signature);
  assert(start !== -1, `could not locate ${signature}`);
  return camera.slice(start, camera.indexOf("\n  };", start));
}

test("an abandoned batch is recorded with its final attempt's HTTP status", () => {
  const body = functionBody("const flushRawFrames = () => {");
  const giveUp = body.indexOf("attempt === RAW_FRAME_UPLOAD_ATTEMPTS");
  const record = body.indexOf("recordTraceBatchLoss(");
  assert(giveUp !== -1, "could not locate the give-up branch");
  assert(record > giveUp, "a loss must be recorded when retries are exhausted");

  const kept = body.match(/(\w+)\s*=\s*response\.status\b/);
  const name = kept?.[1] ?? "";
  assert(name !== "", "the failing response's status must be kept");
  const call = body.slice(record, body.indexOf(")", record));
  assert(new RegExp(`\\b${name}\\b`).test(call), "the loss must be recorded with the kept status");

  const reset = body.search(new RegExp(`let\\s+${name}\\b[^;]*=\\s*null`));
  assert(
    reset > body.indexOf("for (let attempt"),
    "the kept status must reset on every attempt, or a later network failure reports an old status",
  );
});

test("the warning is drawn inside the trace sync card", () => {
  const start = camera.indexOf("const traceSyncReadout =");
  const end = camera.indexOf("\n  );", start);
  assert(start !== -1 && end > start, "could not locate the shared trace sync card");
  const card = camera.slice(start, end);
  assert(card.includes("ref={traceSyncElRef}"), "the card must contain the live readout");
  assert(card.includes("traceUploadLossLabel(traceUploadLoss)"), "the warning must stay with the readout in every session state");
});

test("a new session clears the warning, and ending a session does not", () => {
  // resetSessionPersistence also runs at End. Clearing there would erase the
  // warning at the moment someone finally looks at the screen.
  const start = functionBody("const startSessionPersistence = async (): Promise<boolean> => {");
  const reset = functionBody("const resetSessionPersistence = () => {");
  assert(/setTraceUploadLoss\(null\)/.test(start), "starting a session must clear the previous warning");
  assert(!/setTraceUploadLoss\(/.test(reset), "the reset that also runs at End must leave the warning");
});

test("the loss toast is raised only while the staff panel shows the readout", () => {
  // The toast tells the person recording to check the server. The trace is on
  // by default, so without this gate a patient would get it on a flaky upload.
  const body = functionBody("const flushRawFrames = () => {");
  const toast = body.indexOf("showToast(");
  assert(toast !== -1, "could not locate the loss toast");
  const guard = body.slice(body.lastIndexOf("if (", toast), toast);
  assert(
    /traceSyncReadoutShownRef\.current/.test(guard),
    "the toast must be gated on the readout being shown",
  );
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
