// Diagnostic script: characterize OneEuroFilter behavior with synthetic signals.
// Run with: npm run profile:filter (from Postural/web/)
//
// Validates the filter against the assumptions that production code relies on:
//   - jitter at rest stays below repCounter's descentEpsilon (0.5°)
//   - step response is faster than perceived-latency threshold (~150 ms)
//   - peak preservation during a rep is within ~1° of the true peak
//   - the same (minCutoff=0.3, beta=0.3) config behaves sanely across the three
//     real-world signal regimes: degree angles, normalized torso units, slow tilt
//
// Read-only against the codebase: imports the real OneEuroFilter, no production
// changes.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { OneEuroFilter } from "../src/lib/pose/oneEuroFilter";

// ── Determinism ─────────────────────────────────────────────────────────────

// Mulberry32 — small, fast, seedable PRNG. Fixed seed so every run is identical.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng: () => number, mean: number, stdev: number): number {
  // Box–Muller. One sample per call (the second is discarded — fine for our scale).
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + stdev * z;
}

// ── Stats helpers ───────────────────────────────────────────────────────────

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

function meanAbs(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + Math.abs(b), 0) / xs.length;
}

// ── Output paths ────────────────────────────────────────────────────────────

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "out");
mkdirSync(outDir, { recursive: true });

type Row = { tMs: number; raw: number; smoothed: number; truth: number };

function writeCsv(name: string, rows: Row[]): void {
  const lines = ["t_ms,raw,smoothed,truth"];
  for (const r of rows) {
    lines.push(
      `${r.tMs.toFixed(2)},${r.raw.toFixed(6)},${r.smoothed.toFixed(6)},${r.truth.toFixed(6)}`,
    );
  }
  writeFileSync(join(outDir, `${name}.csv`), lines.join("\n"));
}

// ── Scenario harness ────────────────────────────────────────────────────────

interface ScenarioResult {
  id: string;
  title: string;
  details: string[];
  pass: boolean;
  note?: string;
}

const results: ScenarioResult[] = [];

function pushResult(r: ScenarioResult) {
  results.push(r);
  console.log(`\n${r.id}: ${r.title}`);
  for (const line of r.details) console.log(`  ${line}`);
  console.log(`  ${r.pass ? "PASS" : "FAIL"}${r.note ? "  — " + r.note : ""}`);
}

// Production config used everywhere in CameraClient.tsx.
const PROD_MIN_CUTOFF = 1.0;
const PROD_BETA = 0.1;

// repCounter default — angle decrease that confirms descent has started.
const DESCENT_EPSILON_DEG = 0.5;

// Perceived-latency threshold for self-paced motor feedback.
const PERCEIVED_LATENCY_MS = 150;

// ── S1: Noise rejection at rest (degree scale) ──────────────────────────────

function scenarioS1() {
  const rng = mulberry32(0xc0ffee);
  const filter = new OneEuroFilter(PROD_MIN_CUTOFF, PROD_BETA);
  const fps = 30;
  const durationS = 5;
  const dtMs = 1000 / fps;
  const samples = fps * durationS;

  const trueValue = 30; // degrees, held constant
  const noiseStdev = 1.0;

  const raws: number[] = [];
  const smootheds: number[] = [];
  const rows: Row[] = [];

  for (let i = 0; i < samples; i++) {
    const tMs = i * dtMs;
    const raw = trueValue + gaussian(rng, 0, noiseStdev);
    const smoothed = filter.filter(raw, tMs);
    raws.push(raw);
    smootheds.push(smoothed);
    rows.push({ tMs, raw, smoothed, truth: trueValue });
  }

  // Discard first 0.5 s of warmup before measuring stdev.
  const warmupSamples = Math.floor(fps * 0.5);
  const rawWarm = raws.slice(warmupSamples);
  const smoothWarm = smootheds.slice(warmupSamples);

  const rawStdev = stdev(rawWarm);
  const smoothStdev = stdev(smoothWarm);
  const ratio = smoothStdev > 0 ? rawStdev / smoothStdev : Infinity;

  writeCsv("s1-noise-rejection", rows);

  pushResult({
    id: "S1",
    title: "Noise rejection at rest (degree scale, 30°, σ=1.0°)",
    details: [
      `raw stdev:      ${rawStdev.toFixed(3)}°`,
      `smoothed stdev: ${smoothStdev.toFixed(3)}°  (reduction ratio ${ratio.toFixed(1)}x)`,
      `target: smoothed stdev < ${(DESCENT_EPSILON_DEG / 2).toFixed(2)}° (half of descentEpsilon)`,
    ],
    pass: smoothStdev < DESCENT_EPSILON_DEG / 2,
  });
}

// ── S2: Step response (lag at degree scale) ─────────────────────────────────

function scenarioS2() {
  const filter = new OneEuroFilter(PROD_MIN_CUTOFF, PROD_BETA);
  const fps = 30;
  const dtMs = 1000 / fps;
  const samples = fps * 5;
  const stepAt = fps * 1; // 1 s in
  const lo = 20;
  const hi = 90;

  const rows: Row[] = [];
  let smoothed = 0;
  let t95Ms: number | null = null;
  let t99Ms: number | null = null;

  for (let i = 0; i < samples; i++) {
    const tMs = i * dtMs;
    const truth = i < stepAt ? lo : hi;
    smoothed = filter.filter(truth, tMs);
    rows.push({ tMs, raw: truth, smoothed, truth });

    if (i >= stepAt) {
      const progress = (smoothed - lo) / (hi - lo);
      const timeFromStepMs = tMs - stepAt * dtMs;
      if (t95Ms === null && progress >= 0.95) t95Ms = timeFromStepMs;
      if (t99Ms === null && progress >= 0.99) t99Ms = timeFromStepMs;
    }
  }

  writeCsv("s2-step-response", rows);

  pushResult({
    id: "S2",
    title: `Step response (${lo}° → ${hi}°, no noise)`,
    details: [
      `time to 95% of step: ${t95Ms === null ? "never" : t95Ms.toFixed(0) + " ms"}`,
      `time to 99% of step: ${t99Ms === null ? "never" : t99Ms.toFixed(0) + " ms"}`,
      `target: time to 95% < ${PERCEIVED_LATENCY_MS} ms (perceived-latency threshold)`,
    ],
    pass: t95Ms !== null && t95Ms < PERCEIVED_LATENCY_MS,
  });
}

// ── S3: Synthetic rep ───────────────────────────────────────────────────────

function runRepScenario(opts: {
  id: string;
  title: string;
  fps: number;
  baseline: number;
  peak: number;
  noiseStdev: number;
  ascendS: number;
  plateauS: number;
  descendS: number;
  descentEpsilon: number;
  unitLabel: string; // "°" or "" for normalized
  maxPeakAttenuation: number;
  maxPeakLagMs: number;
  csvName: string;
}): ScenarioResult {
  const rng = mulberry32(0xbeef + opts.id.charCodeAt(1));
  const filter = new OneEuroFilter(PROD_MIN_CUTOFF, PROD_BETA);
  const dtMs = 1000 / opts.fps;

  const ascendSamples = Math.floor(opts.fps * opts.ascendS);
  const plateauSamples = Math.floor(opts.fps * opts.plateauS);
  const descendSamples = Math.floor(opts.fps * opts.descendS);
  const totalSamples = ascendSamples + plateauSamples + descendSamples;

  const rows: Row[] = [];
  const smootheds: number[] = [];
  const rawsDuringPlateau: number[] = [];
  const smoothDuringPlateau: number[] = [];

  let smoothedPeak = -Infinity;
  let smoothedPeakIdx = 0;
  let truePeakIdx = ascendSamples + Math.floor(plateauSamples / 2);

  // For false-descent counting during plateau: track running max and count
  // dips ≥ descentEpsilon below it.
  let plateauRunningMax = -Infinity;
  let falseDescents = 0;

  for (let i = 0; i < totalSamples; i++) {
    const tMs = i * dtMs;
    let truth: number;
    if (i < ascendSamples) {
      truth = opts.baseline + ((opts.peak - opts.baseline) * i) / ascendSamples;
    } else if (i < ascendSamples + plateauSamples) {
      truth = opts.peak;
    } else {
      const k = i - ascendSamples - plateauSamples;
      truth =
        opts.peak - ((opts.peak - opts.baseline) * k) / Math.max(descendSamples - 1, 1);
    }
    const raw = truth + gaussian(rng, 0, opts.noiseStdev);
    const smoothed = filter.filter(raw, tMs);

    if (smoothed > smoothedPeak) {
      smoothedPeak = smoothed;
      smoothedPeakIdx = i;
    }

    if (i >= ascendSamples && i < ascendSamples + plateauSamples) {
      rawsDuringPlateau.push(raw);
      smoothDuringPlateau.push(smoothed);
      if (smoothed > plateauRunningMax) plateauRunningMax = smoothed;
      if (plateauRunningMax - smoothed >= opts.descentEpsilon) {
        falseDescents++;
      }
    }

    smootheds.push(smoothed);
    rows.push({ tMs, raw, smoothed, truth });
  }

  writeCsv(opts.csvName, rows);

  const peakAttenuation = opts.peak - smoothedPeak;
  const peakLagMs = (smoothedPeakIdx - truePeakIdx) * dtMs;
  const plateauStdev = stdev(smoothDuringPlateau);
  const plateauStdevRaw = stdev(rawsDuringPlateau);

  const u = opts.unitLabel;
  const pass =
    peakAttenuation < opts.maxPeakAttenuation &&
    falseDescents === 0 &&
    Math.abs(peakLagMs) < opts.maxPeakLagMs;

  return {
    id: opts.id,
    title: opts.title,
    details: [
      `raw plateau stdev:      ${plateauStdevRaw.toFixed(4)}${u}`,
      `smoothed plateau stdev: ${plateauStdev.toFixed(4)}${u}`,
      `true peak:              ${opts.peak.toFixed(4)}${u}`,
      `smoothed peak:          ${smoothedPeak.toFixed(4)}${u}  (attenuation ${peakAttenuation.toFixed(4)}${u})`,
      `peak lag:               ${peakLagMs.toFixed(0)} ms (positive = filter trails truth)`,
      `false descents during plateau: ${falseDescents} (descentEpsilon = ${opts.descentEpsilon}${u})`,
    ],
    pass,
  };
}

function scenarioS3() {
  pushResult(
    runRepScenario({
      id: "S3",
      title: "Synthetic rep at degree scale (20°→90°→20°, σ=1.5°)",
      fps: 30,
      baseline: 20,
      peak: 90,
      noiseStdev: 1.5,
      ascendS: 1.5,
      plateauS: 0.3,
      descendS: 1.5,
      descentEpsilon: DESCENT_EPSILON_DEG,
      unitLabel: "°",
      maxPeakAttenuation: 1.0,
      maxPeakLagMs: 100,
      csvName: "s3-rep-degrees",
    }),
  );
}

// ── S4: Shrug-scale (normalized torso units) ────────────────────────────────

function scenarioS4() {
  // ex_003 thresholds: start 0.02, complete 0.01, minPeak 0.04, targetROM 0.06
  // We don't actually know the right descentEpsilon for shrugs since the
  // codebase uses the default 0.5 which is degree-scale. Try a proportional
  // value: 0.5° is roughly 1.7% of the 30° range for S3, so the equivalent
  // for shrugs (range ~0.05) would be ~0.0008. We'll report against both
  // the literal default (0.5) and a scale-appropriate 0.0008.
  const result = runRepScenario({
    id: "S4",
    title: "Synthetic rep at shrug scale (0.01→0.06→0.01 normalized, σ=0.003)",
    fps: 30,
    baseline: 0.01,
    peak: 0.06,
    noiseStdev: 0.003,
    ascendS: 1.5,
    plateauS: 0.3,
    descendS: 1.5,
    descentEpsilon: 0.0008, // scale-equivalent to 0.5° on a 30° range
    unitLabel: "",
    maxPeakAttenuation: 0.001,
    maxPeakLagMs: 100,
    csvName: "s4-rep-shrug",
  });
  result.note =
    "if descentEpsilon literal default (0.5) were applied here it would never trigger (>>peak); a per-exercise override is needed";
  pushResult(result);
}

// ── S5: Slow tilt drift ─────────────────────────────────────────────────────

function scenarioS5() {
  const rng = mulberry32(0xd00d);
  const filter = new OneEuroFilter(PROD_MIN_CUTOFF, PROD_BETA);
  const fps = 30;
  const durationS = 5;
  const dtMs = 1000 / fps;
  const samples = fps * durationS;
  const noiseStdev = 0.5;
  const driftTo = 5;

  const rows: Row[] = [];
  const errors: number[] = [];
  let lastSmoothed = 0;
  let lastTruth = 0;

  for (let i = 0; i < samples; i++) {
    const tMs = i * dtMs;
    const truth = (driftTo * i) / Math.max(samples - 1, 1);
    const raw = truth + gaussian(rng, 0, noiseStdev);
    const smoothed = filter.filter(raw, tMs);
    rows.push({ tMs, raw, smoothed, truth });
    if (i > fps * 0.5) errors.push(smoothed - truth);
    lastSmoothed = smoothed;
    lastTruth = truth;
  }

  writeCsv("s5-tilt-drift", rows);

  const meanError = meanAbs(errors);
  const finalLag = lastTruth - lastSmoothed;

  pushResult({
    id: "S5",
    title: "Slow tilt drift (0°→5° over 5 s, σ=0.5°)",
    details: [
      `mean tracking error: ${meanError.toFixed(3)}°`,
      `final-value lag:     ${finalLag.toFixed(3)}° (positive = smoothed below truth)`,
      `target: mean tracking error < 0.5°`,
    ],
    pass: meanError < 0.5,
  });
}

// ── S6: Frame-rate invariance ───────────────────────────────────────────────

function scenarioS6() {
  // Re-run the S3 rep at 60 fps and compare key metrics to the 30 fps result.
  const at = (fps: number) => {
    const rng = mulberry32(0xbeef + "S3".charCodeAt(1)); // same seed as S3
    const filter = new OneEuroFilter(PROD_MIN_CUTOFF, PROD_BETA);
    const dtMs = 1000 / fps;
    const ascendSamples = Math.floor(fps * 1.5);
    const plateauSamples = Math.floor(fps * 0.3);
    const descendSamples = Math.floor(fps * 1.5);
    const totalSamples = ascendSamples + plateauSamples + descendSamples;
    const baseline = 20;
    const peak = 90;
    const noiseStdev = 1.5;

    let smoothedPeak = -Infinity;
    let smoothedPeakIdx = 0;
    const truePeakIdx = ascendSamples + Math.floor(plateauSamples / 2);

    for (let i = 0; i < totalSamples; i++) {
      const tMs = i * dtMs;
      let truth: number;
      if (i < ascendSamples) {
        truth = baseline + ((peak - baseline) * i) / ascendSamples;
      } else if (i < ascendSamples + plateauSamples) {
        truth = peak;
      } else {
        const k = i - ascendSamples - plateauSamples;
        truth = peak - ((peak - baseline) * k) / Math.max(descendSamples - 1, 1);
      }
      const raw = truth + gaussian(rng, 0, noiseStdev);
      const smoothed = filter.filter(raw, tMs);
      if (smoothed > smoothedPeak) {
        smoothedPeak = smoothed;
        smoothedPeakIdx = i;
      }
    }
    const peakAttenuation = peak - smoothedPeak;
    const peakLagMs = (smoothedPeakIdx - truePeakIdx) * dtMs;
    return { peakAttenuation, peakLagMs };
  };

  const a = at(30);
  const b = at(60);

  const attDiff = Math.abs(a.peakAttenuation - b.peakAttenuation);
  const lagDiff = Math.abs(a.peakLagMs - b.peakLagMs);

  const attRel = a.peakAttenuation === 0 ? attDiff : attDiff / Math.abs(a.peakAttenuation);
  const lagRel = a.peakLagMs === 0 ? lagDiff : lagDiff / Math.abs(a.peakLagMs);

  pushResult({
    id: "S6",
    title: "Frame-rate invariance (S3 rep at 30 fps vs 60 fps)",
    details: [
      `peak attenuation @30fps: ${a.peakAttenuation.toFixed(3)}°,  @60fps: ${b.peakAttenuation.toFixed(3)}°  (relative diff ${(attRel * 100).toFixed(0)}%)`,
      `peak lag         @30fps: ${a.peakLagMs.toFixed(0)} ms,    @60fps: ${b.peakLagMs.toFixed(0)} ms     (relative diff ${(lagRel * 100).toFixed(0)}%)`,
      `target: both relative diffs < 20%`,
    ],
    pass: attRel < 0.2 && lagRel < 0.2,
  });
}

// ── Run ─────────────────────────────────────────────────────────────────────

console.log(
  `OneEuroFilter diagnostic — production config (minCutoff=${PROD_MIN_CUTOFF}, beta=${PROD_BETA})`,
);
console.log("=".repeat(72));

scenarioS1();
scenarioS2();
scenarioS3();
scenarioS4();
scenarioS5();
scenarioS6();

const passed = results.filter((r) => r.pass).length;
const flagged = results.filter((r) => r.note).map((r) => r.id);
console.log("\n" + "=".repeat(72));
console.log(
  `${passed}/${results.length} scenarios passed${flagged.length ? "  (flagged: " + flagged.join(", ") + ")" : ""}`,
);
console.log(`CSVs written to: ${outDir}`);
