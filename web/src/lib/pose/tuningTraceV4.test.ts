/**
 * tuningTraceV4.test.ts
 *
 * Guards the two things the `upper_body_v4` tuning trace exists to persist.
 * Run with: npx tsx src/lib/pose/tuningTraceV4.test.ts
 *
 * ── WHY THIS SUITE EXISTS ────────────────────────────────────────────────────
 * Both additions are recorded ONLY so a session can be reanalysed later, which
 * means nothing in the running app notices if they stop being written. There is
 * no screen that shows them and no metric that consumes them; a regression here
 * is silent until someone tries to reprocess a recording months afterwards and
 * finds the data missing — which is exactly what happened to the 2026-06
 * sessions and cost the normalization work two separate dead ends.
 *
 *   1. `frame` — the source frame size. MediaPipe normalizes landmarks by frame
 *      width and height separately, so without the divisors no stored angle can
 *      be reinterpreted in a corrected coordinate space.
 *   2. `calibration.samples` — the retained neutral-calibration ring. Every
 *      baseline is a MEDIAN over it, and a median cannot be recomputed under a
 *      changed measurement from the stored scalar alone.
 *
 * This suite reads `CameraClient.tsx` as source text rather than mounting it.
 * The emission path sits inside a React component behind a live camera loop, so
 * a behavioural test would need a mounted component and a fake MediaPipe. The
 * source assertions below are deliberately written against the INVARIANT
 * ("something writes the frame size into the payload", "the samples are gated
 * to once per set") rather than against one exact spelling, because a check
 * shaped to the current patch cannot fail on a path the patch never considered.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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

const camera = readFileSync(
  fileURLToPath(new URL("../../app/(app)/camera/CameraClient.tsx", import.meta.url)),
  "utf8",
);
const schema = readFileSync(
  fileURLToPath(new URL("../../../../scripts/sessions_pg.sql", import.meta.url)),
  "utf8",
);

console.log("\nupper_body_v4 tuning trace - reprocessability guards\n");

// ── THE VERSION TAG ─────────────────────────────────────────────────────────

test("the trace payload declares exactly one kind, and it is upper_body_v4", () => {
  // Only what the client WRITES counts. Doc comments legitimately name retired
  // kinds (`ex_007_upper_body_v1`, v2, v3) because those rows still exist in
  // the table, so matching every mention of the string would fail on history.
  const kinds = [...camera.matchAll(/traceKind:\s*"upper_body_v(\d+)"/g)].map((m) => m[1]);
  assert(kinds.length >= 2, `expected the type and the literal, found ${kinds.length}`);
  const distinct = [...new Set(kinds)];
  assertEq(distinct.length, 1, `all written kinds must agree, found v${distinct.join(", v")}`);
  assertEq(distinct[0], "4", "trace kind version");
});

test("a version bump forces the payload type and the literal to move together", () => {
  // They are declared in two places; if only one is bumped the writer emits a
  // kind the type does not describe, and the mismatch is invisible at runtime
  // because trace_kind is a free TEXT column.
  assert(/traceKind:\s*"upper_body_v4";/.test(camera), "payload TYPE must pin the kind");
  assert(/traceKind:\s*"upper_body_v4",/.test(camera), "payload LITERAL must pin the kind");
});

// ── 1. SOURCE FRAME SIZE ────────────────────────────────────────────────────

test("the payload type carries a source frame size", () => {
  assert(
    /frame:\s*\{\s*width:\s*number;\s*height:\s*number\s*\}\s*\|\s*null;/.test(camera),
    "UpperBodyTraceMetrics must declare `frame: { width, height } | null`",
  );
});

test("the frame size written is the ACTUAL video size, not a constant", () => {
  // The whole point is that it records what the camera really delivered. A
  // hard-coded 1280x720 would look right and be worthless, since the device
  // picker can change resolution mid-session.
  assert(
    /videoResolutionRef\.current\s*\n?\s*\?\s*\{/.test(camera) ||
      /width:\s*videoResolutionRef\.current\.width/.test(camera),
    "the frame size must come from videoResolutionRef, the live video dimensions",
  );
  assert(
    !/frame:\s*\{\s*width:\s*1280/.test(camera),
    "the frame size must not be hard-coded",
  );
});

test("the builder cannot silently omit the frame size", () => {
  // It is a required (non-optional) parameter and a required field, so dropping
  // it is a type error rather than a quietly missing key in the trace.
  assert(
    /frame:\s*UpperBodyTraceMetrics\["frame"\],/.test(camera),
    "upperBodyTraceMetrics must take `frame` as a REQUIRED parameter",
  );
  assert(!/frame\?:\s*\{\s*width/.test(camera), "`frame` must not be optional on the payload type");
});

// ── 2. RETAINED CALIBRATION SAMPLES ─────────────────────────────────────────

test("the payload type carries the retained calibration samples", () => {
  assert(/samples\?:\s*CalibrationSample\[\];/.test(camera), "calibration.samples must be declared");
  assert(
    /type CalibrationSample = \{/.test(camera),
    "CalibrationSample must be a named type, not an inline shape",
  );
});

test("a calibration sample keeps the LANDMARKS, not just a derived angle", () => {
  // A stored tilt scalar cannot be re-derived into a different coordinate
  // convention. The landmarks are the thing that makes reprocessing possible.
  const block = camera.slice(camera.indexOf("type CalibrationSample = {"));
  const body = block.slice(0, block.indexOf("};"));
  assert(/landmarks:/.test(body), "a calibration sample must retain its landmarks");
});

test("samples are emitted ONCE PER SET, not on every frame", () => {
  // Repeating a ring of up to 300 samples on every frame would multiply the
  // trace size for no added information.
  assert(
    /calibrationSamplesEmittedSetRef/.test(camera),
    "a per-set emission guard must exist",
  );
  assert(
    /calibrationSamplesEmittedSetRef\.current\s*!==\s*setIndex/.test(camera),
    "emission must be gated on the set index",
  );
  assert(
    /calibrationSamplesEmittedSetRef\.current\s*=\s*setIndex;/.test(camera),
    "the guard must be marked after emitting",
  );
});

test("samples are only emitted once calibration has FINALIZED", () => {
  // Emitting during "capturing" would persist a partial ring that does not
  // correspond to the baseline the session actually used.
  assert(
    /baselinePhaseRef\.current === "captured" &&\s*\n?\s*calibrationSamplesEmittedSetRef/.test(camera),
    "emission must require baselinePhase === 'captured'",
  );
});

test("recalibrating re-arms emission so the NEW samples are written", () => {
  // resetNeutralCalibration clears the ring. Without clearing the guard too, a
  // recalibration inside the same set would persist nothing and the stored
  // baseline would have no samples behind it.
  const reset = camera.slice(camera.indexOf("const resetNeutralCalibration = useCallback"));
  const body = reset.slice(0, reset.indexOf("}, ["));
  assert(
    /neutralCalibrationSamplesRef\.current = \[\];/.test(body),
    "reset must clear the sample ring (precondition for this test)",
  );
  assert(
    /calibrationSamplesEmittedSetRef\.current = null;/.test(body),
    "reset must also re-arm the per-set emission guard",
  );
});

// ── SCHEMA DOCUMENTATION ────────────────────────────────────────────────────

test("the raw_frames schema documents whatever kind the client actually writes", () => {
  // Derived from the client rather than hard-coded, so bumping the payload
  // version without updating the table documentation fails here. `trace_kind`
  // is a free TEXT column, so the comment is the only place a reader of the
  // database learns which contract the newest rows follow.
  const written = camera.match(/traceKind:\s*"(upper_body_v\d+)",/)?.[1];
  assert(!!written, "could not determine the kind the client writes");
  const mentions = [...schema.matchAll(/upper_body_v\d+/g)].map((m) => m[0]);
  assert(
    mentions.includes(written!),
    `sessions_pg.sql documents ${JSON.stringify(mentions)} but the client writes ${written}`,
  );
  assert(
    /all kinds coexist/.test(schema),
    "the schema must keep stating that older kinds coexist — rows are never migrated",
  );
});

// ── LIFECYCLE AND DOWNSTREAM ────────────────────────────────────────────────
//
// Added 2026-09-06 after review reproduced TWO defects that every check above
// passed straight through. Both were shape-correct and behaviour-broken:
//   1. `finalizeNeutralCalibration` frees the raw sample ring BEFORE flipping
//      the phase to "captured", and the trace writer only runs after that flip
//      — so the shipped v4 wrote `samples: []` every single time.
//   2. The offline exporter keeps its own trace-kind allowlist, which did not
//      include v4, so every v4 row was invisible to it.
// Assertions about the payload SHAPE cannot see either. These check the ORDER
// of the lifecycle, and the AGREEMENT between two allowlists in different files.

test("finalize SNAPSHOTS the calibration samples before freeing the ring", () => {
  const fn = camera.slice(camera.indexOf("function finalizeNeutralCalibration"));
  const body = fn.slice(0, fn.indexOf("\n  }"));
  const snapshotAt = body.indexOf("calibrationTraceSamplesRef.current =");
  const clearAt = body.indexOf("neutralCalibrationSamplesRef.current = []");
  const phaseAt = body.indexOf('setBaselinePhase("captured")');
  assert(snapshotAt >= 0, "finalize must snapshot the samples for the trace");
  assert(clearAt >= 0, "precondition: finalize still frees the raw ring");
  assert(phaseAt >= 0, "precondition: finalize still flips the phase");
  assert(
    snapshotAt < clearAt,
    "the snapshot must happen BEFORE the ring is freed, or it captures nothing",
  );
  assert(
    clearAt < phaseAt,
    "precondition: the ring is freed before the phase flips — which is exactly " +
      "why the writer cannot read it directly",
  );
});

test("the trace writer reads the SNAPSHOT, never the freed ring", () => {
  const fn = camera.slice(camera.indexOf("const bufferTuningRawFrame"));
  const body = fn.slice(0, fn.indexOf("\n  };"));
  assert(
    /calibrationSamples = calibrationTraceSamplesRef\.current/.test(body),
    "the writer must source samples from the snapshot ref",
  );
  assert(
    !/calibrationSamples\s*=\s*neutralCalibrationSamplesRef/.test(body),
    "the writer must NOT read the raw ring — it is empty by the time it runs",
  );
});

test("recalibrating clears the snapshot as well as the ring", () => {
  const reset = camera.slice(camera.indexOf("const resetNeutralCalibration = useCallback"));
  const body = reset.slice(0, reset.indexOf("}, ["));
  assert(
    /calibrationTraceSamplesRef\.current = null;/.test(body),
    "reset must clear the snapshot, or a stale set's samples could be re-emitted",
  );
});

test("the offline exporter accepts the trace kind the client writes", () => {
  // The exporter keeps its OWN allowlist, used for both session discovery and
  // frame retrieval. A kind missing from it makes those sessions invisible
  // rather than failing loudly — which is how v4 shipped inert.
  const exporter = readFileSync(
    fileURLToPath(new URL("../../../scripts/export-tuning-traces.ts", import.meta.url)),
    "utf8",
  );
  const written = camera.match(/traceKind:\s*"(upper_body_v\d+)",/)?.[1];
  assert(!!written, "could not determine the kind the client writes");
  const block = exporter.slice(exporter.indexOf("const TRACE_KINDS"));
  const allow = block.slice(0, block.indexOf("];"));
  assert(
    allow.includes(`"${written}"`),
    `TRACE_KINDS does not include ${written}, so those sessions would be ` +
      `silently excluded from every export`,
  );
  // Rows are never migrated, so the legacy kinds must survive too.
  for (const legacy of ["ex_007_upper_body_v1", "upper_body_v2", "upper_body_v3"]) {
    assert(allow.includes(`"${legacy}"`), `TRACE_KINDS must retain ${legacy}`);
  }
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
