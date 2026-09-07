/**
 * traceSyncClock.test.ts
 *
 * Run with: npx tsx src/lib/pose/traceSyncClock.test.ts
 *
 * ── WHY THIS SUITE EXISTS ────────────────────────────────────────────────────
 * The readout's only job is to let a value transcribed off a paused video frame
 * name an EXACT row in the exported trace. That guarantee rests on one property
 * — the display format loses nothing — and a format that quietly truncated or
 * rounded would still look perfectly plausible on screen while resolving to the
 * wrong row offline. Nothing else in the system would notice.
 *
 * So this half is tested behaviourally: the functions are imported and run,
 * and every claim below is round-tripped rather than asserted about the source.
 * The WIRING half — that the readout is driven by the values actually persisted
 * rather than by a clock of its own — cannot be reached this way, because it
 * lives inside a React component behind a live camera loop. It is guarded by
 * source-text invariants in `tuningTraceV4.test.ts` instead, and the split is
 * deliberate: this file proves the format, that file proves the plumbing.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  formatTraceElapsed,
  formatTraceSyncReadout,
  parseTraceElapsed,
  parseTraceSyncReadout,
  TRACE_ELAPSED_PATTERN,
  TRACE_SYNC_PLACEHOLDER,
  TRACE_SYNC_READOUT_PATTERN,
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

console.log("\ntrace sync clock - lossless video-to-export matching\n");

// ── THE LOAD-BEARING PROPERTY ───────────────────────────────────────────────

test("every millisecond value round-trips back to itself exactly", () => {
  // Boundaries first: the rollovers are where a format loses digits.
  const boundaries = [
    0, 1, 9, 10, 99, 100, 999, // sub-second, every digit width
    1_000, 1_001, 59_999, // the second and minute rollovers
    60_000, 60_001, 3_599_999, // the minute rollover and the hour boundary
    3_600_000, 5_999_999, 6_000_000, // past 60 minutes: the field must widen
    35_999_999, // ~10 hours, far beyond any real session
  ];

  for (const ms of boundaries) {
    const shown = formatTraceElapsed(ms);
    assert(shown !== null, `formatTraceElapsed(${ms}) must render`);
    assertEq(parseTraceElapsed(shown!), ms, `round-trip of ${ms}`);
  }
});

test("a dense sweep round-trips too, not only the boundaries", () => {
  // A boundary list can be satisfied by a format that is wrong in between.
  for (let ms = 0; ms <= 400_000; ms += 617) {
    const shown = formatTraceElapsed(ms);
    assert(shown !== null, `formatTraceElapsed(${ms}) must render`);
    const back = parseTraceElapsed(shown!);
    assertEq(back, ms, `round-trip of ${ms} (rendered ${shown})`);
  }
});

test("the millisecond field carries all three digits, never rounded away", () => {
  // The failure this catches: a format showing tenths would look fine and land
  // on the wrong row by up to 99 ms — roughly one whole frame at 10 fps.
  assertEq(formatTraceElapsed(1_234), "00:01.234", "1234 ms");
  assertEq(formatTraceElapsed(1_004), "00:01.004", "leading zeros in millis");
  assertEq(formatTraceElapsed(1_040), "00:01.040", "interior zero in millis");
  assertEq(formatTraceElapsed(999), "00:00.999", "sub-second");
});

test("minutes widen past 99 rather than wrapping", () => {
  // Wrapping would silently name a row 100 minutes away. Widening cannot.
  const ms = 100 * 60_000 + 7_000 + 42;
  assertEq(formatTraceElapsed(ms), "100:07.042", "three-digit minutes");
  assertEq(parseTraceElapsed("100:07.042"), ms, "wide minutes round-trip");
});

// ── REFUSING BAD INPUT, RATHER THAN RENDERING SOMETHING PLAUSIBLE ───────────

test("unusable elapsed values render nothing instead of a misleading number", () => {
  for (const bad of [-1, -0.5, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
    assertEq(formatTraceElapsed(bad), null, `formatTraceElapsed(${bad})`);
  }
});

test("a misread display fails loudly instead of resolving to a plausible row", () => {
  const malformed = [
    "", "  ", "01:02", "1:02.345", "00:60.000", "00:02.34", "00:02.3456",
    "aa:bb.ccc", "00-02.345", "#12  00:02.345",
  ];
  for (const bad of malformed) {
    assertEq(parseTraceElapsed(bad), null, `parseTraceElapsed(${JSON.stringify(bad)})`);
  }
});

test("surrounding whitespace is tolerated, since readings are transcribed by hand", () => {
  assertEq(parseTraceElapsed("  00:01.234  "), 1_234, "padded reading");
});

test("the published pattern accepts exactly what the formatter emits", () => {
  // The pattern is exported for offline tooling; if it disagreed with the
  // formatter, that tooling would reject valid readings.
  for (const ms of [0, 1_234, 60_000, 3_599_999, 6_000_000]) {
    const shown = formatTraceElapsed(ms)!;
    assert(TRACE_ELAPSED_PATTERN.test(shown), `pattern must accept ${shown}`);
  }
});

// ── THE FULL READOUT ────────────────────────────────────────────────────────

test("the readout carries the frame index verbatim, as the join key", () => {
  // The index is the value offline analysis actually joins on, so it must
  // appear exactly — no padding, no thousands separator, no truncation.
  assertEq(formatTraceSyncReadout(0, 0), "#0  00:00.000", "first frame");
  assertEq(formatTraceSyncReadout(7, 1_234), "#7  00:01.234", "small index");
  assertEq(formatTraceSyncReadout(148_302, 90_061), "#148302  01:30.061", "large index");
});

test("the frame index is recoverable from the readout", () => {
  const shown = formatTraceSyncReadout(1_432, 254_009)!;
  const [indexPart, elapsedPart] = shown.split(/\s+/);
  assertEq(Number(indexPart.slice(1)), 1_432, "index recovered");
  assertEq(parseTraceElapsed(elapsedPart), 254_009, "elapsed recovered");
});

test("a broken half suppresses the whole readout rather than showing half a row", () => {
  // Half a reading is worse than none: it invites a confident wrong lookup.
  assertEq(formatTraceSyncReadout(-1, 1_000), null, "negative index");
  assertEq(formatTraceSyncReadout(1.5, 1_000), null, "non-integer index");
  assertEq(formatTraceSyncReadout(Number.NaN, 1_000), null, "NaN index");
  assertEq(formatTraceSyncReadout(5, -1), null, "negative elapsed");
  assertEq(formatTraceSyncReadout(5, Number.NaN), null, "NaN elapsed");
});

test("the placeholder cannot be mistaken for a real reading", () => {
  // It sits on screen before the first traced frame, so it is exactly what a
  // recording captures during setup. If it parsed as a READOUT, someone could
  // transcribe it and land on frame 0 at time zero — a row that genuinely
  // exists and would look entirely reasonable in a spreadsheet.
  //
  // An earlier version of this test only checked that the placeholder was not
  // a valid ELAPSED value, which a readout-shaped placeholder passes trivially
  // because of the leading `#`. Mutation testing caught that; the assertion
  // below is against the whole readout, which is the shape actually at risk.
  assertEq(
    parseTraceSyncReadout(TRACE_SYNC_PLACEHOLDER),
    null,
    "placeholder must not parse as a readout",
  );
  assert(
    !TRACE_SYNC_READOUT_PATTERN.test(TRACE_SYNC_PLACEHOLDER),
    "placeholder must not match the readout pattern",
  );
  assertEq(parseTraceElapsed(TRACE_SYNC_PLACEHOLDER), null, "nor as a bare elapsed value");
});

test("a full readout round-trips through its own inverse", () => {
  // This is the function offline tooling joins on, so it gets the same
  // round-trip treatment as the elapsed format rather than a spot check.
  const cases: Array<[number, number]> = [
    [0, 0], [1, 1], [7, 1_234], [1_432, 254_009],
    [148_302, 90_061], [9_999_999, 6_000_000],
  ];
  for (const [frameIndex, elapsedMs] of cases) {
    const shown = formatTraceSyncReadout(frameIndex, elapsedMs);
    assert(shown !== null, `readout for #${frameIndex} must render`);
    const back = parseTraceSyncReadout(shown!);
    assert(back !== null, `readout ${shown} must parse back`);
    assertEq(back!.frameIndex, frameIndex, `frameIndex of ${shown}`);
    assertEq(back!.elapsedMs, elapsedMs, `elapsedMs of ${shown}`);
  }
});

test("a malformed readout fails loudly rather than resolving to frame zero", () => {
  const malformed = [
    "", "  ", "#", "#12", "#12 00:01", "12  00:01.234", "#12  0:01.234",
    "#12  00:60.000", "#-1  00:01.234", "#1.5  00:01.234", "#abc  00:01.234",
    TRACE_SYNC_PLACEHOLDER,
  ];
  for (const bad of malformed) {
    assertEq(parseTraceSyncReadout(bad), null, `parseTraceSyncReadout(${JSON.stringify(bad)})`);
  }
});

test("this module holds no clock of its own", () => {
  // The guarantee is that the readout shows the value being PERSISTED. A time
  // source in here would let the display drift away from the stored row while
  // still looking correct — and would do it invisibly, because every value it
  // showed would still be a plausible time.
  const source = readFileSync(
    fileURLToPath(new URL("./traceSyncClock.ts", import.meta.url)),
    "utf8",
  );
  assert(!/performance\.now\(/.test(source), "must not read performance.now()");
  assert(!/Date\.now\(/.test(source), "must not read Date.now()");
  assert(!/new Date\(/.test(source), "must not construct a Date");
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
