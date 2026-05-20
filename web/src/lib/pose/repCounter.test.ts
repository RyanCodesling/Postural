/**
 * repCounter.test.ts
 *
 * Synthetic-data unit tests for the rep counter state machine.
 *
 * USAGE
 * ─────
 *   npx tsx web/src/lib/pose/repCounter.test.ts
 *
 * No test framework dependency — uses a tiny inline assertion helper. This
 * keeps the file copy-pasteable and runnable from anywhere with `tsx` or
 * `ts-node` installed. If you later add Jest/Vitest, the assertions translate
 * directly to `expect(...)` calls.
 *
 * Each test feeds a hand-crafted angle sequence to a RepCounter and verifies
 * the events emitted match expectations. Tests are independent — each
 * constructs a fresh counter.
 *
 * Thresholds used throughout match the registry's lateral arm raise (ex_001):
 *   start: 20, repComplete: 10, minimumPeak: 60, targetROM: 90
 * — so the test cases double as documentation for what those thresholds mean
 * in practice.
 */

import { RepCounter, type RepEvent } from "./repCounter";

// ─────────────────────────────────────────────────────────────────────────────
// MICRO ASSERTION HELPER
// ─────────────────────────────────────────────────────────────────────────────

let testsPassed = 0;
let testsFailed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    testsPassed += 1;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`      ${err instanceof Error ? err.message : String(err)}`);
    testsFailed += 1;
  }
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertCloseTo(actual: number, expected: number, tolerance: number, label: string): void {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label}: expected ~${expected} (±${tolerance}), got ${actual}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const STANDARD_THRESHOLDS = {
  startThreshold: 20,
  repCompleteThreshold: 10,
  minimumPeakThreshold: 60,
  targetROM: 90,
};

/** Run a sequence of (angle, timestamp) samples through a counter, return all emitted events. */
function feed(counter: RepCounter, samples: Array<[number, number]>): RepEvent[] {
  const events: RepEvent[] = [];
  for (const [angle, t] of samples) {
    const ev = counter.update(angle, t);
    if (ev) events.push(ev);
  }
  return events;
}

/** Generate a smooth half-sine arc from start to peak and back, sampled at 30fps. */
function arcSamples(peak: number, durationMs: number, t0: number = 0): Array<[number, number]> {
  const samples: Array<[number, number]> = [];
  const frameMs = 33;
  const numFrames = Math.floor(durationMs / frameMs);
  for (let i = 0; i <= numFrames; i++) {
    const phase = (i / numFrames) * Math.PI; // 0 to π → sine arc
    const angle = peak * Math.sin(phase);
    samples.push([angle, t0 + i * frameMs]);
  }
  return samples;
}

// ─────────────────────────────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────────────────────────────

console.log("\nRepCounter — synthetic data tests\n");

// ── BASIC HAPPY PATHS ────────────────────────────────────────────────────────

test("clean complete rep emits exactly one event with classification=complete", () => {
  const counter = new RepCounter(STANDARD_THRESHOLDS);
  // Arc with peak well above targetROM (90).
  const events = feed(counter, arcSamples(95, 2000));

  assertEqual(events.length, 1, "event count");
  assertEqual(events[0].index, 1, "rep index");
  assertEqual(events[0].classification, "complete", "classification");
  assertCloseTo(events[0].peakValue, 95, 0.5, "peak value");
});

test("rep with peak between minimumPeak and targetROM is classified partial", () => {
  const counter = new RepCounter(STANDARD_THRESHOLDS);
  // Peak at 75 — above minimumPeak (60), below targetROM (90).
  const events = feed(counter, arcSamples(75, 2000));

  assertEqual(events.length, 1, "event count");
  assertEqual(events[0].classification, "partial", "classification");
  assertCloseTo(events[0].peakValue, 75, 0.5, "peak value");
});

test("rep counter reports correct rep index across multiple reps", () => {
  const counter = new RepCounter(STANDARD_THRESHOLDS);
  // Three back-to-back reps with rest periods between.
  const samples: Array<[number, number]> = [];
  let t = 0;
  for (let i = 0; i < 3; i++) {
    samples.push(...arcSamples(95, 2000, t));
    t += 2100; // small gap with angle ~0 implicit (counter sees nothing during gap)
    samples.push([0, t]); // resting frame
    t += 100;
  }
  const events = feed(counter, samples);

  assertEqual(events.length, 3, "event count");
  assertEqual(events[0].index, 1, "first rep index");
  assertEqual(events[1].index, 2, "second rep index");
  assertEqual(events[2].index, 3, "third rep index");
  assertEqual(counter.getRepCount(), 3, "getRepCount");
});

// ── FALSE STARTS ────────────────────────────────────────────────────────────

test("false start (ascends past startThreshold then drops without reaching minimumPeak) emits no event", () => {
  const counter = new RepCounter(STANDARD_THRESHOLDS);
  // Crosses 20 (start), peaks at 45 (below minimumPeak 60), returns to rest.
  const events = feed(counter, arcSamples(45, 1500));

  assertEqual(events.length, 0, "event count");
  assertEqual(counter.getState(), "WAITING_FOR_REP_START", "final state");
  assertEqual(counter.getRepCount(), 0, "rep count");
});

test("false start does not affect a subsequent successful rep", () => {
  const counter = new RepCounter(STANDARD_THRESHOLDS);
  const samples: Array<[number, number]> = [
    ...arcSamples(45, 1500, 0),     // false start
    [0, 1600],                       // back to rest
    ...arcSamples(95, 2000, 1700),   // real rep
  ];
  const events = feed(counter, samples);

  assertEqual(events.length, 1, "event count");
  assertEqual(events[0].index, 1, "rep index (should be 1, not 2 — false start was discarded)");
  assertEqual(events[0].classification, "complete", "classification");
});

// ── HYSTERESIS / JITTER ─────────────────────────────────────────────────────

test("jitter at startThreshold does not double-count a single rep", () => {
  const counter = new RepCounter(STANDARD_THRESHOLDS);
  // Simulate a complete rep, then jitter on the way down right around the
  // start/complete band (10–20) — common during rest if the arm tremors.
  const samples: Array<[number, number]> = [
    ...arcSamples(95, 2000, 0),
    // After return, jitter between 8 and 18 — never re-crossing start (20)
    // because repComplete (10) isn't crossed back, but bouncing around.
    [12, 2050], [15, 2080], [18, 2110], [13, 2140], [11, 2170], [14, 2200],
    [9, 2230],  // briefly dips below complete threshold
    [12, 2260], [15, 2290], [11, 2320],
  ];
  const events = feed(counter, samples);

  assertEqual(events.length, 1, "event count");
});

test("jitter near the peak does not cause early descent transition", () => {
  const counter = new RepCounter(STANDARD_THRESHOLDS);
  // Custom sample: a slow ascent that briefly noise-dips near the top.
  // Without descentEpsilon, the dip would falsely trigger DESCENDING and
  // the recorded peak would be the dip-entry value, not the real maximum.
  const samples: Array<[number, number]> = [
    [5, 0], [15, 100], [25, 200], [40, 300], [60, 400], [80, 500],
    [92, 600],   // first peak candidate
    [91.7, 633], // tiny dip — within descentEpsilon (0.5)
    [93, 666],   // back up — should still be tracking peak
    [95, 700],   // true peak
    [80, 800], [50, 900], [20, 1000], [8, 1100],
  ];
  const events = feed(counter, samples);

  assertEqual(events.length, 1, "event count");
  assertCloseTo(events[0].peakValue, 95, 0.1, "peak should be true max, not dip-entry");
});

test("premature descent latch recovers when the signal reaches a new high", () => {
  const counter = new RepCounter({
    startThreshold: 5,
    repCompleteThreshold: 2,
    minimumPeakThreshold: 12,
    targetROM: 30,
  });
  const samples: Array<[number, number]> = [
    [0, 0],
    [7.5, 33],
    [12.3, 66],
    [17.8, 99],
    [17.0, 132], // premature descent trigger under the old logic
    [19.8, 165],
    [25.8, 198],
    [34.8, 231],
    [42.5, 264],
    [57.2, 297],
    [64.3, 330],
    [63.3, 363],
    [57.9, 396],
    [43.0, 429],
    [27.2, 462],
    [13.2, 495],
    [5.5, 528],
    [1.0, 561],
  ];
  const events = feed(counter, samples);

  assertEqual(events.length, 1, "event count");
  assertEqual(events[0].classification, "complete", "classification");
  assertCloseTo(events[0].peakValue, 64.3, 0.1, "peak should recover to true high");
});

// ── EDGE CASES ──────────────────────────────────────────────────────────────

test("rep peaking exactly at targetROM is classified complete (boundary case)", () => {
  const counter = new RepCounter(STANDARD_THRESHOLDS);
  // Peak exactly at 90.
  const events = feed(counter, arcSamples(90, 2000));

  assertEqual(events.length, 1, "event count");
  assertEqual(events[0].classification, "complete", "classification");
});

test("rep peaking exactly at minimumPeakThreshold is classified partial", () => {
  const counter = new RepCounter(STANDARD_THRESHOLDS);
  const events = feed(counter, arcSamples(60, 2000));

  assertEqual(events.length, 1, "event count");
  assertEqual(events[0].classification, "partial", "classification");
});

test("rep peaking just below minimumPeakThreshold emits no event", () => {
  const counter = new RepCounter(STANDARD_THRESHOLDS);
  const events = feed(counter, arcSamples(59.5, 2000));

  assertEqual(events.length, 0, "event count");
});

// ── TIMING FIELDS ───────────────────────────────────────────────────────────

test("RepEvent timing fields are internally consistent", () => {
  const counter = new RepCounter(STANDARD_THRESHOLDS);
  const events = feed(counter, arcSamples(95, 2000, 1000));

  assertEqual(events.length, 1, "event count");
  const ev = events[0];

  // ascentDurationMs + holdDurationMs + descentDurationMs should equal totalDurationMs.
  // Hold can be zero for a synthetic rep with no peak plateau, but the sum
  // invariant holds either way.
  const sum = ev.ascentDurationMs + ev.descentDurationMs + ev.holdDurationMs;
  assertCloseTo(sum, ev.totalDurationMs, 1, "ascent + hold + descent ≈ total");

  // Timestamps in order: start ≤ peak ≤ end
  if (!(ev.startTimeMs <= ev.peakTimeMs)) throw new Error("start > peak");
  if (!(ev.peakTimeMs <= ev.endTimeMs)) throw new Error("peak > end");

  // Total duration matches end - start
  assertCloseTo(ev.totalDurationMs, ev.endTimeMs - ev.startTimeMs, 0.1, "total = end - start");
});

// ── HOLD AT PEAK ────────────────────────────────────────────────────────────
//
// holdDurationMs was previously hard-coded to 0; any pause at the peak was
// silently absorbed into descentDurationMs. Below tests confirm that:
//   (1) a deliberate hold at peak is recorded with non-trivial holdDurationMs
//   (2) holdDurationMs + descentDurationMs equals what descentDurationMs used
//       to be under the old contract (preserves backward-compatible totals)
//   (3) a snappy rep with no observable hold records holdDurationMs equal to
//       a single frame interval, not zero (zero is reserved for "uninitialised")

test("explicit hold at peak is captured in holdDurationMs, not descentDurationMs", () => {
  const counter = new RepCounter(STANDARD_THRESHOLDS);

  // Construct: ascent → 12 frames at the peak (no descent) → clean descent.
  // 12 * 33ms ≈ 396ms of hold. With descentEpsilon=0.5, holding flat at peak
  // should NOT trigger DESCENDING; only the drop afterwards should.
  const samples: Array<[number, number]> = [];
  let t = 0;
  // Ascent (180ms)
  for (const a of [5, 25, 50, 75, 95]) {
    samples.push([a, t]); t += 33;
  }
  // Plateau at peak for 12 frames (~396ms). Keep exactly at peak — any drop
  // beyond descentEpsilon would prematurely trigger DESCENDING.
  for (let i = 0; i < 12; i++) {
    samples.push([95, t]); t += 33;
  }
  // Descent: angle must drop > descentEpsilon (0.5) below the running peak.
  for (const a of [90, 70, 40, 20, 8]) {
    samples.push([a, t]); t += 33;
  }

  const events = feed(counter, samples);
  assertEqual(events.length, 1, "expected exactly one rep");
  const ev = events[0];

  // Hold should reflect the plateau (~396ms). Use a generous tolerance —
  // exact value depends on which frame trips descentEpsilon.
  if (ev.holdDurationMs < 300) {
    throw new Error(`expected holdDurationMs > 300, got ${ev.holdDurationMs}`);
  }
  // Descent should be SHORT (just the 5 descent frames, ~150ms), not the
  // ~550ms total it would have been under the old "descent = end - peak" rule.
  if (ev.descentDurationMs > 250) {
    throw new Error(`descentDurationMs (${ev.descentDurationMs}) too large — hold time leaking into descent?`);
  }
  // Sum invariant still holds.
  const sum = ev.ascentDurationMs + ev.holdDurationMs + ev.descentDurationMs;
  assertCloseTo(sum, ev.totalDurationMs, 1, "ascent + hold + descent ≈ total");
});

test("snappy rep with no plateau records small positive holdDurationMs (one frame), not zero", () => {
  const counter = new RepCounter(STANDARD_THRESHOLDS);
  // Sine arc — peak at apex, immediate descent on the next frame.
  const events = feed(counter, arcSamples(95, 1200, 0));
  assertEqual(events.length, 1, "expected exactly one rep");
  const ev = events[0];

  // Should be one frame interval (~33ms), not zero. Zero is reserved for
  // "uninitialised" — emitting zero would conflate "no observable hold" with
  // "we never recorded a descent-start timestamp."
  if (ev.holdDurationMs <= 0) {
    throw new Error(`expected holdDurationMs > 0, got ${ev.holdDurationMs}`);
  }
  if (ev.holdDurationMs > 100) {
    throw new Error(`snappy rep should have hold ≤ 100ms (one frame), got ${ev.holdDurationMs}`);
  }
});

// ── ABANDONED REPS ──────────────────────────────────────────────────────────

test("reset() during ascending discards in-progress rep without emitting", () => {
  const counter = new RepCounter(STANDARD_THRESHOLDS);
  // Start ascending, get to mid-rep, then reset (e.g. capture readiness drops).
  feed(counter, [[5, 0], [25, 100], [50, 200], [70, 300]]);
  assertEqual(counter.getState(), "ASCENDING", "state before reset");

  counter.reset();
  assertEqual(counter.getState(), "WAITING_FOR_REP_START", "state after reset");
  assertEqual(counter.getRepCount(), 0, "rep count after reset (no rep emitted)");
});

test("reset() during descending discards in-progress rep without emitting", () => {
  const counter = new RepCounter(STANDARD_THRESHOLDS);
  // Get past the peak into descending, then reset before completion.
  feed(counter, [[5, 0], [25, 100], [50, 200], [80, 300], [95, 400], [80, 500], [60, 600]]);
  assertEqual(counter.getState(), "DESCENDING", "state before reset");

  counter.reset();
  assertEqual(counter.getState(), "WAITING_FOR_REP_START", "state after reset");
  assertEqual(counter.getRepCount(), 0, "rep count after reset");
});

// ── VALIDATION ──────────────────────────────────────────────────────────────

test("constructor throws when repCompleteThreshold >= startThreshold", () => {
  let threw = false;
  try {
    new RepCounter({
      startThreshold: 20,
      repCompleteThreshold: 25, // BAD: higher than start
      minimumPeakThreshold: 60,
      targetROM: 90,
    });
  } catch {
    threw = true;
  }
  assertEqual(threw, true, "expected constructor to throw");
});

test("constructor throws when minimumPeakThreshold > targetROM", () => {
  let threw = false;
  try {
    new RepCounter({
      startThreshold: 20,
      repCompleteThreshold: 10,
      minimumPeakThreshold: 100, // BAD: above targetROM
      targetROM: 90,
    });
  } catch {
    threw = true;
  }
  assertEqual(threw, true, "expected constructor to throw");
});

// ── CONTINUITY GATE ──────────────────────────────────────────────────────────

test("continuity gate: rep refused when ascent starts without prior rest evidence", () => {
  const counter = new RepCounter({
    startThreshold: 20,
    repCompleteThreshold: 10,
    minimumPeakThreshold: 60,
    targetROM: 90,
  });
  // No rest frames first — feed a complete arc starting from a high value.
  // armAtRest is false at construction, so no rep should emit.
  const evs = [
    counter.update(80, 100),
    counter.update(85, 133),
    counter.update(40, 166),
    counter.update(5,  200),
  ];
  if (evs.some((e) => e !== null)) {
    throw new Error("rep emitted without prior rest evidence");
  }
});

test("continuity gate: rep refused when ascent starts after a long gap (simulated cross-body sweep)", () => {
  const counter = new RepCounter({
    startThreshold: 20,
    repCompleteThreshold: 10,
    minimumPeakThreshold: 60,
    targetROM: 90,
  });
  // Establish rest.
  counter.update(0, 100);
  counter.update(0, 133);
  counter.update(0, 166);
  // Simulate ~1.5s during which the metric returned null (cross-body sweep),
  // so the caller skipped update() entirely. Then the arm reappears at lateral
  // overhead and descends through the lateral region to rest. This is the
  // exact bogus trajectory the production bug exhibits.
  const seq: Array<[number, number]> = [
    [170, 1700],
    [130, 1733],
    [90,  1766],
    [50,  1800],
    [25,  1833],
    [5,   1866],
  ];
  for (const [a, t] of seq) {
    const ev = counter.update(a, t);
    if (ev !== null) {
      throw new Error(`cross-body trajectory wrongly emitted rep at angle=${a}`);
    }
  }
});

test("continuity gate: back-to-back reps after a clean rest work normally", () => {
  // Sanity check: the new gate must not break legitimate consecutive reps.
  const counter = new RepCounter({
    startThreshold: 20,
    repCompleteThreshold: 10,
    minimumPeakThreshold: 60,
    targetROM: 90,
  });
  // First rep: rest → ascend → peak → descend → rest.
  counter.update(0,  100);
  counter.update(0,  133);
  counter.update(30, 166);
  counter.update(70, 200);
  counter.update(95, 233);
  counter.update(70, 266);
  counter.update(30, 300);
  const ev1 = counter.update(5, 333);
  if (!ev1) throw new Error("first rep did not emit");

  // Second rep immediately after (one rest frame is enough).
  counter.update(0,  366);
  counter.update(30, 400);
  counter.update(95, 433);
  counter.update(30, 466);
  const ev2 = counter.update(5, 500);
  if (!ev2) throw new Error("second rep did not emit");
  if (ev2.index !== 2) throw new Error(`expected index 2, got ${ev2.index}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n  ${testsPassed} passed, ${testsFailed} failed\n`);
process.exit(testsFailed > 0 ? 1 : 0);
