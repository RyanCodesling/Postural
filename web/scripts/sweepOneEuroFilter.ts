// Grid sweep: find (minCutoff, beta) configurations that pass all degree-scale
// scenarios from profileOneEuroFilter.ts.
//
// Run with: npm run profile:sweep (from Postural/web/)
//
// Targets the four degree-scale scenarios:
//   S1: noise rejection at rest (smoothed stdev < 0.25°)
//   S2: step response (time-to-95% < 150 ms)
//   S3: synthetic rep (|peak attn| < 1.0°, false descents = 0, |peak lag| < 100 ms)
//   S6: frame-rate invariance (relative diff < 20% between 30 and 60 fps)
//
// Skips S4 (normalized torso-unit shrugs — different scale, needs its own sweep)
// and S5 (tilt — different requirements; the production tilt filter probably
// wants a separate config anyway).

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { OneEuroFilter } from "../src/lib/pose/oneEuroFilter";

// ── Determinism helpers (same as profileOneEuroFilter.ts) ───────────────────

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
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + stdev * z;
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

// ── Scenario evaluators ─────────────────────────────────────────────────────

// Compact versions of the profileOneEuroFilter.ts scenarios — no console
// output, no CSV writing. Each returns the key metrics.

function evalNoiseRejection(minCutoff: number, beta: number): { smoothStdev: number } {
  const rng = mulberry32(0xc0ffee);
  const filter = new OneEuroFilter(minCutoff, beta);
  const fps = 30;
  const dtMs = 1000 / fps;
  const samples = fps * 5;
  const trueValue = 30;
  const noiseStdev = 1.0;
  const warmup = Math.floor(fps * 0.5);

  const smootheds: number[] = [];
  for (let i = 0; i < samples; i++) {
    const raw = trueValue + gaussian(rng, 0, noiseStdev);
    const smoothed = filter.filter(raw, i * dtMs);
    if (i >= warmup) smootheds.push(smoothed);
  }
  return { smoothStdev: stdev(smootheds) };
}

function evalStepResponse(minCutoff: number, beta: number): { t95Ms: number | null } {
  const filter = new OneEuroFilter(minCutoff, beta);
  const fps = 30;
  const dtMs = 1000 / fps;
  const samples = fps * 5;
  const stepAt = fps * 1;
  const lo = 20;
  const hi = 90;

  let t95Ms: number | null = null;
  for (let i = 0; i < samples; i++) {
    const tMs = i * dtMs;
    const truth = i < stepAt ? lo : hi;
    const smoothed = filter.filter(truth, tMs);
    if (i >= stepAt && t95Ms === null) {
      const progress = (smoothed - lo) / (hi - lo);
      if (progress >= 0.95) t95Ms = tMs - stepAt * dtMs;
    }
  }
  return { t95Ms };
}

function evalSynthRep(
  minCutoff: number,
  beta: number,
  fps = 30,
): { peakAttenuation: number; peakLagMs: number; falseDescents: number } {
  const rng = mulberry32(0xbef00);
  const filter = new OneEuroFilter(minCutoff, beta);
  const dtMs = 1000 / fps;
  const ascendSamples = Math.floor(fps * 1.5);
  const plateauSamples = Math.floor(fps * 0.3);
  const descendSamples = Math.floor(fps * 1.5);
  const total = ascendSamples + plateauSamples + descendSamples;
  const baseline = 20;
  const peak = 90;
  const noiseStdev = 1.5;
  const descentEpsilon = 0.5;

  let smoothedPeak = -Infinity;
  let smoothedPeakIdx = 0;
  const truePeakIdx = ascendSamples + Math.floor(plateauSamples / 2);
  let plateauRunningMax = -Infinity;
  let falseDescents = 0;

  for (let i = 0; i < total; i++) {
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
    const smoothed = filter.filter(raw, i * dtMs);

    if (smoothed > smoothedPeak) {
      smoothedPeak = smoothed;
      smoothedPeakIdx = i;
    }
    if (i >= ascendSamples && i < ascendSamples + plateauSamples) {
      if (smoothed > plateauRunningMax) plateauRunningMax = smoothed;
      if (plateauRunningMax - smoothed >= descentEpsilon) falseDescents++;
    }
  }
  return {
    peakAttenuation: peak - smoothedPeak,
    peakLagMs: (smoothedPeakIdx - truePeakIdx) * dtMs,
    falseDescents,
  };
}

function evalFrameRateDiff(
  minCutoff: number,
  beta: number,
): { attRelDiff: number; lagRelDiff: number } {
  const a = evalSynthRep(minCutoff, beta, 30);
  const b = evalSynthRep(minCutoff, beta, 60);
  const attDiff = Math.abs(a.peakAttenuation - b.peakAttenuation);
  const lagDiff = Math.abs(a.peakLagMs - b.peakLagMs);
  const attRel = a.peakAttenuation === 0 ? attDiff : attDiff / Math.abs(a.peakAttenuation);
  const lagRel = a.peakLagMs === 0 ? lagDiff : lagDiff / Math.abs(a.peakLagMs);
  return { attRelDiff: attRel, lagRelDiff: lagRel };
}

// ── Pass criteria ───────────────────────────────────────────────────────────

const PASS_S1_STDEV_DEG = 0.25;
const PASS_S2_T95_MS = 150;
const PASS_S3_PEAK_ATTN_DEG = 1.0;
const PASS_S3_PEAK_LAG_MS = 100;
const PASS_S6_REL_DIFF = 0.2;

interface SweepRow {
  minCutoff: number;
  beta: number;
  s1Stdev: number;
  s2T95: number | null;
  s3Attn: number;
  s3Lag: number;
  s3FalseDescents: number;
  s6AttRel: number;
  s6LagRel: number;
  passS1: boolean;
  passS2: boolean;
  passS3: boolean;
  passS6: boolean;
  passAll: boolean;
}

function evaluate(minCutoff: number, beta: number): SweepRow {
  const s1 = evalNoiseRejection(minCutoff, beta);
  const s2 = evalStepResponse(minCutoff, beta);
  const s3 = evalSynthRep(minCutoff, beta);
  const s6 = evalFrameRateDiff(minCutoff, beta);

  const passS1 = s1.smoothStdev < PASS_S1_STDEV_DEG;
  const passS2 = s2.t95Ms !== null && s2.t95Ms < PASS_S2_T95_MS;
  const passS3 =
    Math.abs(s3.peakAttenuation) < PASS_S3_PEAK_ATTN_DEG &&
    s3.falseDescents === 0 &&
    Math.abs(s3.peakLagMs) < PASS_S3_PEAK_LAG_MS;
  const passS6 = s6.attRelDiff < PASS_S6_REL_DIFF && s6.lagRelDiff < PASS_S6_REL_DIFF;

  return {
    minCutoff,
    beta,
    s1Stdev: s1.smoothStdev,
    s2T95: s2.t95Ms,
    s3Attn: s3.peakAttenuation,
    s3Lag: s3.peakLagMs,
    s3FalseDescents: s3.falseDescents,
    s6AttRel: s6.attRelDiff,
    s6LagRel: s6.lagRelDiff,
    passS1,
    passS2,
    passS3,
    passS6,
    passAll: passS1 && passS2 && passS3 && passS6,
  };
}

// ── Grid ────────────────────────────────────────────────────────────────────

// Log-spaced ranges that cover the canonical 1€ tuning territory.
const MIN_CUTOFF_GRID = [0.1, 0.2, 0.3, 0.5, 0.8, 1.2, 2.0];
const BETA_GRID = [0.001, 0.005, 0.01, 0.05, 0.1, 0.3, 1.0];

// ── Output ──────────────────────────────────────────────────────────────────

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "out");
mkdirSync(outDir, { recursive: true });

function fmt(n: number | null, digits: number, width: number): string {
  if (n === null) return "—".padStart(width);
  return n.toFixed(digits).padStart(width);
}

function failedScenarios(r: SweepRow): string {
  const failed: string[] = [];
  if (!r.passS1) failed.push("S1");
  if (!r.passS2) failed.push("S2");
  if (!r.passS3) failed.push("S3");
  if (!r.passS6) failed.push("S6");
  return failed.length === 0 ? "PASS" : failed.join(",");
}

console.log("OneEuroFilter parameter sweep (degree-scale scenarios)");
console.log("=".repeat(94));
console.log("Pass criteria:");
console.log(`  S1 smoothed stdev    < ${PASS_S1_STDEV_DEG.toFixed(2)}°`);
console.log(`  S2 time-to-95%       < ${PASS_S2_T95_MS} ms`);
console.log(`  S3 |peak attn|       < ${PASS_S3_PEAK_ATTN_DEG.toFixed(2)}°, falseDescents = 0, |peak lag| < ${PASS_S3_PEAK_LAG_MS} ms`);
console.log(`  S6 frame-rate diffs  < ${(PASS_S6_REL_DIFF * 100).toFixed(0)}%`);
console.log("=".repeat(94));

const header =
  "minCut  beta    | S1 σ°  | S2 t95 | S3 attn | S3 lag | S3fd | S6 attR | S6 lagR | result";
console.log(header);
console.log("-".repeat(header.length));

const rows: SweepRow[] = [];
for (const minCutoff of MIN_CUTOFF_GRID) {
  for (const beta of BETA_GRID) {
    const r = evaluate(minCutoff, beta);
    rows.push(r);
    console.log(
      [
        r.minCutoff.toFixed(2).padStart(6),
        r.beta.toFixed(3).padStart(6),
        " |",
        fmt(r.s1Stdev, 3, 6),
        " |",
        fmt(r.s2T95, 0, 4) + "ms",
        " |",
        fmt(r.s3Attn, 2, 6) + "°",
        " |",
        fmt(r.s3Lag, 0, 4) + "ms",
        " |",
        r.s3FalseDescents.toString().padStart(4),
        " |",
        (r.s6AttRel * 100).toFixed(0).padStart(5) + "%",
        " |",
        (r.s6LagRel * 100).toFixed(0).padStart(5) + "%",
        " |",
        " " + failedScenarios(r),
      ].join(""),
    );
  }
}

// ── CSV ─────────────────────────────────────────────────────────────────────

const csvLines = [
  "minCutoff,beta,s1_smoothStdev,s2_t95_ms,s3_peak_attenuation,s3_peak_lag_ms,s3_false_descents,s6_att_rel_diff,s6_lag_rel_diff,passes_all",
];
for (const r of rows) {
  csvLines.push(
    [
      r.minCutoff,
      r.beta,
      r.s1Stdev.toFixed(4),
      r.s2T95 === null ? "" : r.s2T95.toFixed(1),
      r.s3Attn.toFixed(4),
      r.s3Lag.toFixed(1),
      r.s3FalseDescents,
      r.s6AttRel.toFixed(4),
      r.s6LagRel.toFixed(4),
      r.passAll ? 1 : 0,
    ].join(","),
  );
}
writeFileSync(join(outDir, "sweep.csv"), csvLines.join("\n"));

// ── Recommendations ─────────────────────────────────────────────────────────

console.log("\n" + "=".repeat(94));
const passing = rows.filter((r) => r.passAll);

if (passing.length === 0) {
  console.log("No configurations passed all four strict scenarios.");

  // Show best-performing configs by pass count, then by S3 false-descent count
  // (the most operationally important metric for rep counting).
  const passCount = (r: SweepRow) =>
    [r.passS1, r.passS2, r.passS3, r.passS6].filter(Boolean).length;

  const maxPass = Math.max(...rows.map(passCount));
  console.log(`\nBest result: ${maxPass} of 4 scenarios passing.`);
  console.log(`Configs at ${maxPass} of 4 (sorted by S3 peak lag, then S1 noise):`);
  const best = rows
    .filter((r) => passCount(r) === maxPass)
    .sort((a, b) => {
      if (Math.abs(a.s3Lag) !== Math.abs(b.s3Lag)) {
        return Math.abs(a.s3Lag) - Math.abs(b.s3Lag);
      }
      return a.s1Stdev - b.s1Stdev;
    })
    .slice(0, 8);
  for (const r of best) {
    console.log(
      `  (${r.minCutoff.toFixed(2)}, ${r.beta.toFixed(3)}) — failed: ${failedScenarios(r)}, s1=${r.s1Stdev.toFixed(3)}°, s2=${r.s2T95 ?? "—"}ms, s3 attn=${r.s3Attn.toFixed(2)}°/lag=${r.s3Lag.toFixed(0)}ms/fd=${r.s3FalseDescents}`,
    );
  }

  // Operationally, S3 falseDescents = 0 with low lag is the headline measure.
  console.log(`\nConfigs with falseDescents = 0 and |peak lag| < 200 ms (operational target):`);
  const operational = rows
    .filter((r) => r.s3FalseDescents === 0 && Math.abs(r.s3Lag) < 200)
    .sort((a, b) => a.s1Stdev - b.s1Stdev)
    .slice(0, 8);
  for (const r of operational) {
    console.log(
      `  (${r.minCutoff.toFixed(2)}, ${r.beta.toFixed(3)}) — s1=${r.s1Stdev.toFixed(3)}°, s2=${r.s2T95 ?? "—"}ms, s3 attn=${r.s3Attn.toFixed(2)}°/lag=${r.s3Lag.toFixed(0)}ms`,
    );
  }
} else {
  console.log(`${passing.length} configurations passed all four scenarios.`);
  console.log("Top picks (sorted by balanced margin — at-rest noise × step lag):");
  const ranked = [...passing]
    .map((r) => ({
      r,
      score: r.s1Stdev * Math.max(r.s2T95 ?? 0, 33),
    }))
    .sort((a, b) => a.score - b.score)
    .slice(0, 5);

  for (const { r } of ranked) {
    console.log(
      `  (${r.minCutoff}, ${r.beta}) — at-rest σ=${r.s1Stdev.toFixed(3)}°, step t95=${r.s2T95}ms, peak attn=${r.s3Attn.toFixed(2)}°, peak lag=${r.s3Lag.toFixed(0)}ms`,
    );
  }
}

console.log("\nSweep CSV written to: " + join(outDir, "sweep.csv"));
