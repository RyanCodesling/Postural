/**
 * tuningTraceV4.test.ts
 *
 * Guards what the `upper_body_v4` tuning trace exists to persist, and — since
 * the recording work grew into them — the calibration and sync-readout
 * behaviours a recording session depends on.
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
 * Most of this suite reads `CameraClient.tsx` as source text rather than
 * mounting it. The emission path sits inside a React component behind a live
 * camera loop, so a full behavioural test would need a mounted component and a
 * fake MediaPipe. The source assertions are deliberately written against the
 * INVARIANT ("something writes the frame size into the payload", "the samples
 * are gated to once per set") rather than against one exact spelling, because a
 * check shaped to the current patch cannot fail on a path the patch never
 * considered.
 *
 * ── AND WHERE THAT IS NOT ENOUGH ────────────────────────────────────────────
 * A source assertion proves the wiring exists, not that the wiring does
 * anything. The tests marked BEHAVIOURAL drive the real `RepCounter` through
 * the recalibration defect end to end, because that one is about what the
 * state machine EMITS across an unmeasured gap — a property no amount of
 * reading the camera source can establish.
 *
 * Two source assertions here were previously wrong in a way worth remembering.
 * One forbade any `resetNeutralCalibration(` call inside the dropout handler,
 * which made the handler's two phases indistinguishable and would have blocked
 * a legitimate fix — a test protecting a defect. The other was named for a
 * guarantee it did not check. Both were found by review rather than by failing.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { RepCounter } from "./repCounter";
import {
  applyTraceSyncReadout,
  parseTraceSyncReadout,
  TRACE_SYNC_PAUSED,
  TRACE_SYNC_PLACEHOLDER,
} from "./traceSyncClock";

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
const clock = readFileSync(
  fileURLToPath(new URL("./traceSyncClock.ts", import.meta.url)),
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

// ── THE SCREEN-RECORDING SYNC READOUT ───────────────────────────────────────
// The readout's whole value is that a number transcribed off a paused video
// frame names a row that EXISTS in the export. That holds only while it is
// driven by the values actually persisted. A readout fed by its own clock would
// look identical on screen, drift silently, and send every offline lookup to a
// neighbouring row — so these guard the plumbing, not the appearance.
// `traceSyncClock.test.ts` covers the format behaviourally.

/** The body of `bufferTuningRawFrame`, from its signature to the batch flush. */
function traceWriterBody(): string {
  const start = camera.indexOf("const bufferTuningRawFrame = (");
  if (start === -1) throw new Error("could not locate bufferTuningRawFrame");
  const end = camera.indexOf("RAW_FRAME_UPLOAD_BATCH_SIZE", start);
  if (end === -1) throw new Error("could not locate the end of bufferTuningRawFrame");
  return camera.slice(start, end);
}

test("the persisted frame index and elapsed time are single locals, not inline expressions", () => {
  // If the payload recomputed either value inline, the readout could not
  // reference the same one, and the two could diverge with no test noticing.
  const body = traceWriterBody();
  assert(
    /const frameIndex = \+\+rawFrameIndexRef\.current;/.test(body),
    "frameIndex must be hoisted to a local so the readout can share it",
  );
  assert(
    /const elapsedMs = Math\.max\(/.test(body),
    "elapsedMs must be hoisted to a local so the readout can share it",
  );
  assert(
    !/frameIndex:\s*\+\+rawFrameIndexRef/.test(body),
    "the payload must use the hoisted frameIndex, not recompute it inline",
  );
  assert(
    !/elapsedMs:\s*Math\.max\(/.test(body),
    "the payload must use the hoisted elapsedMs, not recompute it inline",
  );
});

test("the readout is written from those same two locals", () => {
  const body = traceWriterBody();
  const write = body.match(/writeTraceSyncReadout\([\s\S]{0,220}?\);/)?.[0];
  assert(!!write, "the readout write was not found");
  assert(
    /formatTraceSyncReadout\(\s*frameIndex\s*,\s*elapsedMs\s*\)/.test(write!),
    "the readout must be built from the hoisted frameIndex and elapsedMs",
  );
});

test("the readout is written BEFORE the payload, from values the payload then persists", () => {
  // Ordering is the evidence that the displayed number and the stored number
  // are one value rather than two that happen to agree.
  const body = traceWriterBody();
  const declared = body.indexOf("const frameIndex = ");
  const shown = body.indexOf("writeTraceSyncReadout(");
  const pushed = body.indexOf("pendingRawFramesRef.current.push({");
  assert(declared !== -1 && shown !== -1 && pushed !== -1, "could not locate all three sites");
  assert(declared < shown, "the values must be computed before they are displayed");
  assert(shown < pushed, "the readout must be written before the payload is queued");
});

test("the trace writer reads no clock of its own for the readout", () => {
  // The one permitted time source is `tNow`, passed in by the camera loop and
  // used for BOTH the stored row and the readout. Anything else reintroduces
  // exactly the drift this readout exists to remove.
  const body = traceWriterBody();
  assert(!/performance\.now\(/.test(body), "must not call performance.now()");
  assert(!/Date\.now\(/.test(body), "must not call Date.now()");
});

test("the readout is not rendered outside a patient tuning session", () => {
  // Renamed, because the name it used to carry — "only while a session is
  // actually recording" — described a guarantee this check does not make. The
  // render gate is the toggle, not the recording state; whether a reading is
  // SHOWN while recording is stopped is a separate property, guarded below.
  const marker = camera.indexOf("ref={traceSyncElRef}");
  assert(marker !== -1, "the readout element was not found in the rendered tree");
  const preceding = camera.slice(Math.max(0, marker - 1400), marker);
  assert(
    /user\?\.role === "patient" && tuningTraceEnabled &&/.test(preceding),
    "the readout must be gated on a patient session with tracing enabled",
  );
});

test("the trace is recorded by default", () => {
  // Since 2026-10-24 every patient session is traced unless the staff panel
  // switches it off, so a counting problem reported from any session can be
  // replayed offline. The camera loop reads the ref, not the state, so a ref
  // that starts off would leave the first frames of every page load untraced.
  assert(
    /\[tuningTraceEnabled, setTuningTraceEnabledState\] = useState\(true\)/.test(camera),
    "the trace toggle must start on",
  );
  assert(
    /tuningTraceEnabledRef = useRef\(true\)/.test(camera),
    "the ref the camera loop reads must start on too",
  );
});

test("the readout needs its own staff switch, which starts off", () => {
  // With the trace on by default, the trace toggle alone would put a
  // debugging readout, and a warning to check the server, in front of every
  // patient and evaluator.
  const marker = camera.indexOf("ref={traceSyncElRef}");
  assert(marker !== -1, "the readout element was not found in the rendered tree");
  const preceding = camera.slice(Math.max(0, marker - 1400), marker);
  assert(
    /tuningTraceEnabled && traceSyncReadoutShown &&/.test(preceding),
    "the readout must also be gated on the staff panel's readout switch",
  );
  assert(
    /\[traceSyncReadoutShown, setTraceSyncReadoutShownState\] = useState\(false\)/.test(camera),
    "the readout switch must start off",
  );
  assert(
    /traceSyncReadoutShownRef = useRef\(false\)/.test(camera),
    "the readout switch's ref must start off too",
  );
  assert(
    camera.includes("setTraceSyncReadoutShown(e.target.checked)"),
    "the staff panel must offer the readout switch",
  );
});

test("a frame that is not traced BLANKS the readout", () => {
  // The defect this closes: the readout was written only on traced frames, so
  // a gap left the last good reading on screen. Pausing a screen recording
  // inside that gap reads a value that names a real row — an OLDER one — and
  // the label is then attached to the wrong posture, silently and plausibly.
  const start = camera.indexOf("const predictWebcam = () => {");
  assert(start !== -1, "could not locate predictWebcam");
  const loop = camera.slice(start);
  const cleared = loop.indexOf("traceSyncWroteThisFrameRef.current = false;");
  const checked = loop.search(/if \(!traceSyncWroteThisFrameRef\.current\) \{/);
  assert(cleared !== -1, "the per-frame trace flag must be cleared each frame");
  assert(checked !== -1, "the loop must check whether this frame was traced");
  assert(cleared < checked, "the flag must be cleared before it is read");
  assert(
    /writeTraceSyncReadout\(TRACE_SYNC_PAUSED\)/.test(loop.slice(checked, checked + 300)),
    "an untraced frame must blank the readout, not leave the last value up",
  );
});

test("the paused marker cannot be mistaken for a reading", () => {
  // Both fallbacks have to fail `parseTraceSyncReadout`, or offline tooling
  // that transcribes one resolves it to a real row instead of rejecting it.
  assert(
    parseTraceSyncReadout(TRACE_SYNC_PAUSED) === null,
    "TRACE_SYNC_PAUSED must not parse as a readout",
  );
  assert(
    parseTraceSyncReadout(TRACE_SYNC_PLACEHOLDER) === null,
    "TRACE_SYNC_PLACEHOLDER must not parse as a readout",
  );
  // Compared as plain strings: both are literal-typed consts, and tsc rejects
  // the direct comparison as provably false rather than checking it. Widening
  // is what makes this a runtime guard against the two being made equal.
  assert(
    (TRACE_SYNC_PAUSED as string) !== (TRACE_SYNC_PLACEHOLDER as string),
    "paused and not-yet-started must be distinguishable on screen — they mean " +
      "different things to someone scrubbing the recording",
  );
});

test("only one function writes the readout node", () => {
  // The guarantee is "a reading on screen belongs to the frame showing it".
  // That is checkable while every update goes through one place, and stops
  // being checkable the moment a second writer exists.
  const inCamera = camera.match(/\.textContent\s*=[^=]/g) ?? [];
  assertEq(inCamera.length, 0, "the camera must not write the node directly");
  const inClock = clock.match(/\.textContent\s*=[^=]/g) ?? [];
  assertEq(inClock.length, 1, "traceSyncClock must hold exactly one writer");
});

test("BEHAVIOURAL: the writer compares the NODE, never a remembered value", () => {
  // The regression. A cache of the last string written can disagree with the
  // node, and when it does the skip leaves a STALE READING on screen — which
  // is the one failure this readout exists to prevent.
  //
  // It happened: the cache lived in a ref reset from the element's `ref`
  // callback, on the assumption that receiving a node meant a fresh one. React
  // calls an inline ref callback on ordinary rerenders too, reattaching the
  // SAME node with its text unchanged, so a rerender desynchronised the cache
  // and the next write of that value was skipped while the old reading stayed
  // visible. Source assertions passed the whole time.
  const node: { textContent: string | null } = { textContent: null };

  assert(applyTraceSyncReadout(node, "#12  00:01.234"), "first write must land");
  assertEq(node.textContent, "#12  00:01.234", "node text");

  // Unchanged value: skipped, and that is the only skip allowed.
  assert(!applyTraceSyncReadout(node, "#12  00:01.234"), "an identical write must be skipped");

  // The desync itself. Anything that changes the node behind the writer's back
  // — a rerender, a remount, React repainting the JSX default — must not be
  // able to make a needed write look redundant.
  node.textContent = TRACE_SYNC_PLACEHOLDER;
  assert(
    applyTraceSyncReadout(node, "#12  00:01.234"),
    "a write must land whenever the NODE disagrees, however the node got that way",
  );
  assertEq(node.textContent, "#12  00:01.234", "node text after re-write");

  // And the reverse direction, which is the session-reset case that was broken.
  node.textContent = "#99  00:09.999";
  assert(
    applyTraceSyncReadout(node, TRACE_SYNC_PLACEHOLDER),
    "clearing must land even after the node changed behind the writer",
  );
  assertEq(node.textContent, TRACE_SYNC_PLACEHOLDER, "node text after clear");

  assert(!applyTraceSyncReadout(null, TRACE_SYNC_PLACEHOLDER), "a missing node is a no-op");
});

test("no cached last-write value survives anywhere", () => {
  // Structural counterpart: the desync is impossible only while there is
  // nothing to desynchronise. A reintroduced cache would pass every other
  // test here.
  assert(
    !/traceSyncLastWriteRef/.test(camera),
    "the camera must not cache the last readout write",
  );
  assert(
    !/\blet\s+last\w*\s*[:=]|\bconst\s+last\w*\s*=\s*\{/.test(clock),
    "traceSyncClock must hold no module-level last-write cache",
  );
});

test("stopping the camera clears the readout", () => {
  // stopCamera cancels the animation frame, so the per-frame blanking that
  // repairs a stale reading everywhere else is exactly what is no longer
  // running. Without a clear here an old row key survives the lifecycle gap.
  const start = camera.indexOf("const stopCamera = useCallback(");
  assert(start !== -1, "could not locate stopCamera");
  const body = camera.slice(start, camera.indexOf("\n  }, [", start));
  const cancel = body.indexOf("cancelAnimationFrame");
  const clear = body.indexOf("applyTraceSyncReadout(");
  assert(cancel !== -1, "stopCamera must cancel the frame loop");
  assert(clear !== -1, "stopCamera must clear the sync readout");
  assert(cancel < clear, "the clear must come after the loop is cancelled");
});

test("a new session resets the readout", () => {
  // Frame indices restart at 1, so a reading left over from the previous
  // session names a row number that now belongs to different data.
  const start = camera.indexOf("const resetSessionPersistence = () => {");
  assert(start !== -1, "could not locate resetSessionPersistence");
  const body = camera.slice(start, camera.indexOf("\n  };", start));
  assert(
    /writeTraceSyncReadout\(TRACE_SYNC_PLACEHOLDER\)/.test(body),
    "starting a session must clear the previous session's reading",
  );
});

test("an unusable reading falls back to a placeholder, never to a partial number", () => {
  const body = traceWriterBody();
  assert(
    /\?\?\s*TRACE_SYNC_PLACEHOLDER/.test(body),
    "the readout must fall back to TRACE_SYNC_PLACEHOLDER",
  );
});

// ── THE WORLD-COORDINATE DEPTH CHANNEL ──────────────────────────────────────
// Recorded so one question can be answered offline instead of by recording a
// second session: can either depth signal separate sagittal faults — leaning
// back, slouching, an elbow drifting off a wall — that the image plane cannot
// see at all? Nothing reads it at runtime, so a regression here is silent until
// somebody tries the analysis and finds the column empty. That is exactly how
// the frame size and the calibration samples were lost twice already.

test("the payload carries world landmarks, and they are not optional", () => {
  assert(
    /worldLandmarks:\s*Record<string,\s*RawTraceWorldLandmark \| null> \| null;/.test(camera),
    "the metrics envelope must declare a nullable, non-optional worldLandmarks",
  );
  assert(
    !/worldLandmarks\?:/.test(camera),
    "worldLandmarks must not be optional — a missing key is indistinguishable " +
      "from a frame where the pose task emitted nothing",
  );
});

test("world landmarks travel inside `metrics`, not beside `landmarks`", () => {
  // The write route allowlists the fields it persists. A new TOP-LEVEL key on
  // the payload is dropped silently, with no error anywhere — the same failure
  // that made the v4 trace inert. `metrics` is stored whole, so nesting it
  // there is what actually survives the round trip.
  const payloadType = camera.slice(
    camera.indexOf("type RawFramePayload = {"),
    camera.indexOf("};", camera.indexOf("type RawFramePayload = {")),
  );
  assert(payloadType.length > 0, "could not locate RawFramePayload");
  assert(
    !/worldLandmarks/.test(payloadType),
    "worldLandmarks must NOT sit at the payload top level, where the route drops it",
  );

  const route = readFileSync(
    fileURLToPath(new URL("../../app/api/sessions/[id]/raw-frames/route.ts", import.meta.url)),
    "utf8",
  );
  const persisted = route.slice(route.indexOf("rows.push({"), route.indexOf("return rows;"));
  assert(
    /metrics:\s*item\.metrics/.test(persisted),
    "the route must persist `metrics` whole, which is what carries this field",
  );
});

test("world landmarks come from the pose task's OWN world output", () => {
  // Deriving them from the normalized landmarks would produce a depth channel
  // that is a copy of the image plane — and would answer the question with a
  // guaranteed null result while looking like it worked.
  assert(
    /results\.worldLandmarks\?\.\[0\]/.test(camera),
    "the writer must be fed results.worldLandmarks[0]",
  );
  const body = camera.slice(
    camera.indexOf("function upperBodyTraceWorldLandmarks("),
    camera.indexOf("function upperBodyTraceLandmarks("),
  );
  assert(body.length > 0, "could not locate upperBodyTraceWorldLandmarks");
  assert(
    !/NormalizedLandmark/.test(body),
    "the world serializer must not touch the normalized landmark type",
  );
});

test("the two landmark sets stay in lockstep on the same ten points", () => {
  // A depth reading for a point whose image-plane position was not retained
  // could not be compared against anything.
  const indicesIn = (fnName: string): string[] => {
    const start = camera.indexOf(`function ${fnName}(`);
    assert(start !== -1, `could not locate ${fnName}`);
    const body = camera.slice(start, camera.indexOf("\n}", start));
    return (body.match(/\[(\d+)\]/g) ?? []).sort();
  };
  const normalized = indicesIn("upperBodyTraceLandmarks");
  const world = indicesIn("upperBodyTraceWorldLandmarks");
  assert(normalized.length === 10, `expected 10 normalized indices, got ${normalized.length}`);
  assertEq(world.join(","), normalized.join(","), "world indices must match normalized");
});

test("a world landmark with no usable depth is stored as null, not as a hole", () => {
  const body = camera.slice(
    camera.indexOf("function traceWorldLandmark("),
    camera.indexOf("function upperBodyTraceWorldLandmarks("),
  );
  assert(body.length > 0, "could not locate traceWorldLandmark");
  assert(
    /z === null/.test(body),
    "a non-finite z must reject the whole point — depth is the only reason this channel exists",
  );
});

// ── A DROPOUT MUST NOT RE-ANCHOR THE NEUTRAL BASELINE ───────────────────────
// Neutral calibration captures "neutral" from whatever posture the patient is
// holding. Re-running it after an interruption therefore adopts that posture as
// the reference every later deduction is measured against. A recorded session
// did exactly this twice — once while the subject was leaning, once while
// slouching — and nothing surfaced it, because the residual it produces looks
// perfectly normal. These guard the fix rather than the symptom.

/** The body of `resetAfterSustainedCaptureDropout`. */
function dropoutHandlerBody(): string {
  const start = camera.indexOf("function resetAfterSustainedCaptureDropout(");
  if (start === -1) throw new Error("could not locate resetAfterSustainedCaptureDropout");
  const end = camera.indexOf("captureDropoutResetDoneRef.current = true;", start);
  if (end === -1) throw new Error("could not locate the end of the dropout handler");
  return camera.slice(start, end);
}

test("a dropout branches on whether the baseline was FINISHED", () => {
  // An earlier version of this test forbade any `resetNeutralCalibration(` in
  // the handler at all. That was wrong, and it was wrong in a way that would
  // have PROTECTED a defect: it made the handler's two cases indistinguishable,
  // so the fix for the finished-baseline case was silently applied to the
  // unfinished one too. The two cases need opposite handling, so the test has
  // to know they exist.
  const body = dropoutHandlerBody();
  assert(
    /baselinePhaseRef\.current === "captured"/.test(body),
    "the handler must branch on the baseline phase",
  );
  assert(
    /}\s*else\s*{/.test(body),
    "the unfinished-baseline case must be handled, not fall through",
  );
});

test("a dropout after a FINISHED baseline keeps it and raises the stale flag", () => {
  const body = dropoutHandlerBody();
  const captured = body.slice(body.indexOf('baselinePhaseRef.current === "captured"'));
  const elseAt = captured.search(/}\s*else\s*{/);
  assert(elseAt !== -1, "could not split the captured branch from the else");
  const branch = captured.slice(0, elseAt);
  assert(
    !/resetNeutralCalibration\(/.test(branch),
    "a finished baseline must NOT be re-taken here — that silently re-anchors " +
      "it to whatever posture the interruption happened in",
  );
  assert(
    /calibrationStaleRef\.current = true;/.test(branch) &&
      /setCalibrationStale\(true\);/.test(branch),
    "it must mark the baseline stale instead, in both the ref and the state " +
      "the prompt renders from",
  );
});

test("a dropout during an UNFINISHED calibration discards the partial samples", () => {
  // The opposite case, and a regression the phase gate introduced. Before the
  // gate, the handler restarted calibration unconditionally. Adding
  // `=== "captured"` was right for the finished case and left this one with no
  // handling at all, so samples taken before an interruption were silently
  // carried into the same median as samples taken after it — across a camera
  // move, which is a common cause of the interruption in the first place.
  const body = dropoutHandlerBody();
  const elseAt = body.search(/}\s*else\s*{/);
  assert(elseAt !== -1, "could not locate the unfinished-baseline branch");
  const branch = body.slice(elseAt);
  assert(
    /resetNeutralCalibration\(/.test(branch),
    "an unfinished calibration must be restarted, not resumed across the gap",
  );
  assert(
    !/calibrationStaleRef\.current = true;/.test(branch),
    "there is nothing to warn about here — no baseline was ever presented as " +
      "good, so calibration simply starts over",
  );
});

test("recalibrating clears the stale flag", () => {
  const start = camera.indexOf("const resetNeutralCalibration = useCallback(");
  assert(start !== -1, "could not locate resetNeutralCalibration");
  const body = camera.slice(start, camera.indexOf("}, [", start));
  assert(
    /calibrationStaleRef\.current = false;/.test(body),
    "taking the baseline again must answer the stale warning",
  );
  // BOTH have to be cleared, and the state is the load-bearing one: the prompt
  // renders from it, so clearing only the ref leaves the banner on screen
  // forever with no way to dismiss it. Mutation testing caught exactly that.
  assert(
    /setCalibrationStale\(false\);/.test(body),
    "the rendered state must be cleared too, or the prompt can never be dismissed",
  );
});

test("recalibration is offered to the operator, never performed for them", () => {
  // The prompt is the whole mechanism: without it the baseline would silently
  // stay stale after a genuine camera move, which is the opposite failure.
  const marker = camera.indexOf("{calibrationStale && !baselineVisible && (");
  assert(marker !== -1, "the stale-baseline prompt was not found in the rendered tree");
  const block = camera.slice(marker, marker + 3000);
  assert(
    /onClick=\{handleManualRecalibration\}/.test(block),
    "the prompt must offer a manual recalibration control",
  );
  assert(
    /camera moved/.test(block),
    "the prompt must say why recalibrating might be needed, not just offer a button",
  );
});

// ── RECALIBRATING IS A MEASUREMENT BOUNDARY ─────────────────────────────────
// Pressing Recalibrate mid-movement does two things at once: it pauses metric
// updates while the new baseline is captured, and it replaces the frozen tilt
// and every per-side baseline. A repetition already in progress survives both
// unless something discards it, and is then completed afterwards — carrying a
// duration that spans the unmeasured interval, and having accumulated its peak
// under the OLD reference while its completion threshold is evaluated under the
// NEW one. It is then credited toward set progress and can close the set.
//
// The first test below is behavioural: it drives the real `RepCounter` through
// that exact sequence. The rest check that the camera actually routes the
// button through the discard, which is the half a unit test cannot see.

/** Thresholds shaped like a lateral-raise exercise, in metric units. */
const RECAL_THRESHOLDS = {
  repCompleteThreshold: 15,
  startThreshold: 20,
  minimumPeakThreshold: 25,
  targetROM: 70,
};

test("BEHAVIOURAL: a rep in progress survives a calibration gap unless discarded", () => {
  // Arm at rest, then ascending, then descending — a rep is now in flight.
  const counter = new RepCounter(RECAL_THRESHOLDS);
  for (const [angle, t] of [[0, 100], [30, 150], [90, 200], [80, 250]] as const) {
    assert(counter.update(angle, t) === null, `unexpected event at t=${t}`);
  }
  assert(counter.getState() === "DESCENDING", "setup failed: expected DESCENDING");

  // Now the operator recalibrates. Three seconds pass with no updates, because
  // the metric path is skipped for as long as the baseline is not captured.
  // The arm comes back down and the rep completes.
  const leaked = counter.update(0, 3400);
  assert(leaked !== null, "setup failed: expected the rep to complete");
  assert(
    leaked!.totalDurationMs === 3250,
    `the surviving rep spans the calibration gap: ${leaked!.totalDurationMs}ms`,
  );
  assert(
    leaked!.classification === "complete",
    "and it is credited as complete, so it counts toward the set",
  );
  // The long-gap check is not a substitute. It clears `armAtRest` only, which
  // gates STARTING a rep — it does nothing to one already in flight.

  // Same sequence, with the discard the fix performs.
  const fixed = new RepCounter(RECAL_THRESHOLDS);
  for (const [angle, t] of [[0, 100], [30, 150], [90, 200], [80, 250]] as const) {
    fixed.update(angle, t);
  }
  fixed.reset();
  assert(
    fixed.update(0, 3400) === null,
    "after the discard, nothing may be emitted across the gap",
  );
  assert(fixed.getRepCount() === 0, "and nothing may be credited");
});

test("BEHAVIOURAL: the discard does not touch what was already credited", () => {
  // The other half of the requirement. Discarding must lose the unobserved
  // repetition and NOTHING else — a fix that also wiped completed reps would
  // pass the test above and be worse than the defect.
  const counter = new RepCounter(RECAL_THRESHOLDS);
  for (const [angle, t] of [[0, 100], [30, 150], [90, 200], [80, 250], [0, 300]] as const) {
    counter.update(angle, t);
  }
  assert(counter.getRepCount() === 1, "setup failed: expected one credited rep");
  counter.reset();
  assert(
    counter.getRepCount() === 1,
    "a discard must not revoke a repetition that was already observed end to end",
  );
});

/** The body of `discardInProgressMovement`. */
function discardBody(): string {
  const start = camera.indexOf("function discardInProgressMovement(): void {");
  if (start === -1) throw new Error("could not locate discardInProgressMovement");
  const end = camera.indexOf("\n  }", start);
  if (end === -1) throw new Error("could not locate the end of discardInProgressMovement");
  return camera.slice(start, end);
}

test("the manual Recalibrate button discards in-progress movement FIRST", () => {
  const start = camera.indexOf("function handleManualRecalibration(): void {");
  assert(start !== -1, "could not locate handleManualRecalibration");
  const body = camera.slice(start, camera.indexOf("\n  }", start));
  const discardAt = body.indexOf("discardInProgressMovement()");
  const recalAt = body.indexOf("resetNeutralCalibration(");
  assert(discardAt !== -1, "the handler must discard the movement in progress");
  assert(recalAt !== -1, "the handler must then open a new calibration");
  assert(
    discardAt < recalAt,
    "the discard must come first — recalibrating first leaves a window in " +
      "which the surviving rep is adjudicated against the new reference",
  );
});

test("the discard covers every accumulator a repetition is built from", () => {
  // Each of these spans frames. Any one left behind lets some part of the
  // unobserved movement reach the completed event.
  const body = discardBody();
  for (const [what, pattern] of [
    ["the rep state machines", /leftRepCounterRef\.current\?\.reset\(\)/],
    ["the right rep counter", /rightRepCounterRef\.current\?\.reset\(\)/],
    ["the bidirectional counter", /bidirectionalRepCounterRef\.current\?\.reset\(\)/],
    ["the rep quality buffer", /dynamicRepQualityBufferRef\.current\.reset\(\)/],
    ["the isometric dt anchor", /lastIsometricTickMsRef\.current = null/],
    ["the hold-quality accumulator", /resetHoldQualityAccum\(\)/],
    ["accrued hold time", /pairedHoldMsRef\.current = 0/],
  ] as const) {
    assert(pattern.test(body), `the discard must clear ${what}`);
  }
});

test("the discard does NOT revoke credited reps or sets", () => {
  // The source-level counterpart of the behavioural test above.
  const body = discardBody();
  assert(
    !/repCountsRef/.test(body),
    "credited repetition counts must survive a discard",
  );
  assert(
    !/completedSetsRef/.test(body),
    "closed sets must survive a discard",
  );
});

test("the capture-dropout handler and the button share one discard", () => {
  // They are the same requirement — an interrupted movement cannot be scored —
  // and the defect was that only one of them implemented it.
  const dropout = dropoutHandlerBody();
  assert(
    /discardInProgressMovement\(\)/.test(dropout),
    "the dropout handler must route through the shared discard",
  );
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
