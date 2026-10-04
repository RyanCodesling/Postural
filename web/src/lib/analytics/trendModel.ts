/**
 * Gaussian-process trend model for the progress trends (machine-learning trend
 * analytics). Port of `ml/trend/model.py`'s `series_posterior` and `labels`; the
 * parity test checks it against fixtures that the Python evaluation wrote.
 *
 * For one series of session means y_i (session index i = 0, 1, …):
 *
 *   y_i = f(i) + d_i + e_i,  e_i ~ N(0, w_i),  d_i ~ N(0, τ²)
 *
 * w_i is the within-session variance of the session mean (unit SD² ÷ units) and
 * τ the session-to-session variation learned offline. f is a Gaussian process on
 * the mean-centred series with kernel
 *
 *   k(i, j) = V² + V²(i − c)(j − c) + a² exp(−(i − j)² / (2ℓ²)),
 *
 * c the mean index, V = vague·τ̂ and a = smoothFraction·τ. τ is integrated over a
 * log grid with a log-normal prior centred on the learned τ̂. The label comes from
 * the posterior of the change Δ = f(last) − f(first). It reports whether a
 * measurement changed by more than normal session-to-session variation; it is
 * not a clinical judgement.
 */
import trendModelConfig from "./trendModelConfig.json";

export interface TrendMeasureSpec {
  exercise: string;
  measure: string;
  tauHat: number;
  sigmaU: number;
  deltaMin: number;
  labelled: boolean;
  minUnits: number;
  /** False when the measure is charted without a model band (failed or no check). */
  band?: boolean;
  /** One value per session (all variation is session to session, so σ_u = 0). */
  sessionLevel?: boolean;
  sigmaSource: string;
  tauSource: string;
}

export interface TrendModelConfig {
  version: string;
  model: string;
  protocol: string;
  protocolSha256: string;
  variant: string;
  tauLogSd: number;
  minSessions: number;
  smooth: boolean;
  smoothFraction: number;
  rbfLength: number;
  vague: number;
  gridPoints: number;
  pStar: number;
  measures: Record<string, TrendMeasureSpec>;
}

export type TrendLabel = "rising" | "no_clear_change" | "falling" | "collecting";

export interface TrendFit {
  /** Posterior probability that the underlying level rose from the first to the latest session. */
  pRising: number;
  /** Estimated change of the underlying level, first → latest session, with its 95 % range. */
  meanChange: number;
  changeLow: number;
  changeHigh: number;
  /** Estimated underlying level at each session, with a 95 % band. */
  levelMean: number[];
  levelLow: number[];
  levelHigh: number[];
  label: TrendLabel;
}

export const TREND_MODEL: TrendModelConfig = trendModelConfig as TrendModelConfig;

export function trendMeasureSpec(
  exerciseId: string,
  measure: string,
  config: TrendModelConfig = TREND_MODEL,
): TrendMeasureSpec | null {
  return config.measures[`${exerciseId}:${measure}`] ?? null;
}

const LOG_2PI = Math.log(2 * Math.PI);
const SQRT2 = Math.SQRT2;

/** erfc for z ≥ 0: series for small z, continued fraction beyond. */
function erfcNonNegative(z: number): number {
  if (z < 3) {
    // erf(z) = 2/√π · e^{−z²} · Σ 2ⁿ z^{2n+1} / (1·3·…·(2n+1)); every term positive.
    let term = z;
    let sum = z;
    for (let n = 1; n < 200; n += 1) {
      term *= (2 * z * z) / (2 * n + 1);
      sum += term;
      if (term < sum * 1e-17) break;
    }
    return 1 - (2 / Math.sqrt(Math.PI)) * Math.exp(-z * z) * sum;
  }
  // erfc(z) = e^{−z²}/√π · 1/(z + (1/2)/(z + 1/(z + (3/2)/(z + …)))) by modified Lentz.
  const tiny = 1e-300;
  let f = z;
  let c = z;
  let d = 0;
  for (let k = 1; k < 500; k += 1) {
    const a = k / 2;
    d = z + a * d;
    d = Math.abs(d) < tiny ? tiny : d;
    c = z + a / c;
    c = Math.abs(c) < tiny ? tiny : c;
    d = 1 / d;
    const delta = c * d;
    f *= delta;
    if (Math.abs(delta - 1) < 1e-16) break;
  }
  return Math.exp(-z * z) / Math.sqrt(Math.PI) / f;
}

/** Standard normal CDF. */
export function normalCdf(x: number): number {
  if (!Number.isFinite(x)) return x > 0 ? 1 : 0;
  const z = Math.abs(x) / SQRT2;
  const tail = 0.5 * erfcNonNegative(z);
  return x >= 0 ? 1 - tail : tail;
}

function cholesky(matrix: number[][]): number[][] {
  const n = matrix.length;
  const lower = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j <= i; j += 1) {
      let sum = matrix[i][j];
      for (let k = 0; k < j; k += 1) sum -= lower[i][k] * lower[j][k];
      if (i === j) {
        if (!(sum > 0)) throw new Error("trend model: covariance is not positive definite");
        lower[i][i] = Math.sqrt(sum);
      } else {
        lower[i][j] = sum / lower[j][j];
      }
    }
  }
  return lower;
}

function choleskySolve(lower: number[][], b: number[]): number[] {
  const n = lower.length;
  const y = new Array<number>(n);
  for (let i = 0; i < n; i += 1) {
    let sum = b[i];
    for (let k = 0; k < i; k += 1) sum -= lower[i][k] * y[k];
    y[i] = sum / lower[i][i];
  }
  const x = new Array<number>(n);
  for (let i = n - 1; i >= 0; i -= 1) {
    let sum = y[i];
    for (let k = i + 1; k < n; k += 1) sum -= lower[k][i] * x[k];
    x[i] = sum / lower[i][i];
  }
  return x;
}

function logSumExp(values: number[]): number {
  const max = Math.max(...values);
  let sum = 0;
  for (const v of values) sum += Math.exp(v - max);
  return max + Math.log(sum);
}

function mixtureQuantile(weights: number[], mu: number[], sd: number[], q: number): number {
  let lo = Math.min(...mu.map((m, j) => m - 10 * sd[j]));
  let hi = Math.max(...mu.map((m, j) => m + 10 * sd[j]));
  for (let iteration = 0; iteration < 200; iteration += 1) {
    const mid = 0.5 * (lo + hi);
    let cdf = 0;
    for (let j = 0; j < weights.length; j += 1) cdf += weights[j] * normalCdf((mid - mu[j]) / sd[j]);
    if (cdf < q) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/**
 * Fits one series. `values` are session means in time order and `units` the
 * number of repetitions (or sets) behind each mean.
 */
export function fitTrend(
  values: number[],
  units: number[],
  spec: TrendMeasureSpec,
  config: TrendModelConfig = TREND_MODEL,
): TrendFit {
  const n = values.length;
  if (n === 0 || units.length !== n) throw new Error("trend model: values and units must be non-empty and aligned");
  if (!(spec.tauHat > 0)) throw new Error(`trend model: ${spec.exercise}:${spec.measure} has no learned variation`);
  const w = units.map((u) => (spec.sigmaU * spec.sigmaU) / u);
  const ybar = values.reduce((a, b) => a + b, 0) / n;
  const yc = values.map((v) => v - ybar);
  const centre = (n - 1) / 2;
  const vague = config.vague * spec.tauHat;

  const grid = Array.from({ length: config.gridPoints }, (_, j) =>
    config.gridPoints === 1 ? 0 : -3 * config.tauLogSd + (6 * config.tauLogSd * j) / (config.gridPoints - 1),
  );
  const taus = grid.map((g) => spec.tauHat * Math.exp(g));
  const logPrior = taus.map((tau) => {
    const z = Math.log(tau / spec.tauHat) / config.tauLogSd;
    return -0.5 * z * z;
  });

  const logLik: number[] = [];
  const mu: number[] = [];
  const sd: number[] = [];
  const fMean: number[][] = [];
  const fVar: number[][] = [];
  for (const tau of taus) {
    const amplitude = config.smooth ? config.smoothFraction * tau : 0;
    const kf = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (__, j) =>
        vague * vague * (1 + (i - centre) * (j - centre)) +
        amplitude * amplitude * Math.exp(-((i - j) ** 2) / (2 * config.rbfLength * config.rbfLength)),
      ),
    );
    const ky = kf.map((row, i) => row.map((v, j) => (i === j ? v + w[i] + tau * tau : v)));
    const lower = cholesky(ky);
    const alpha = choleskySolve(lower, yc);
    let logDet = 0;
    for (let i = 0; i < n; i += 1) logDet += 2 * Math.log(lower[i][i]);
    let quad = 0;
    for (let i = 0; i < n; i += 1) quad += yc[i] * alpha[i];
    logLik.push(-0.5 * quad - 0.5 * logDet - 0.5 * n * LOG_2PI);

    const mean = kf.map((row) => row.reduce((s, v, j) => s + v * alpha[j], 0) + ybar);
    // cov = Kf − Kf Ky⁻¹ Kf, column by column.
    const kinvKf = Array.from({ length: n }, (_, col) => choleskySolve(lower, kf.map((row) => row[col])));
    const cov = kf.map((row) => row.map((v, j) => v - row.reduce((s, kik, k) => s + kik * kinvKf[j][k], 0)));
    fMean.push(mean);
    fVar.push(cov.map((row, i) => Math.max(row[i], 0)));
    const changeMean = kf[n - 1].reduce((s, v, j) => s + v * alpha[j], 0) - kf[0].reduce((s, v, j) => s + v * alpha[j], 0);
    const changeVar = cov[n - 1][n - 1] + cov[0][0] - cov[0][n - 1] - cov[n - 1][0];
    mu.push(changeMean);
    sd.push(Math.sqrt(Math.max(changeVar, 1e-300)));
  }

  const logWeights = logLik.map((ll, j) => ll + logPrior[j]);
  const norm = logSumExp(logWeights);
  const weights = logWeights.map((lw) => Math.exp(lw - norm));

  let pRising = 0;
  let meanChange = 0;
  for (let j = 0; j < taus.length; j += 1) {
    pRising += weights[j] * normalCdf(mu[j] / sd[j]);
    meanChange += weights[j] * mu[j];
  }
  const levelMean = new Array<number>(n).fill(0);
  const second = new Array<number>(n).fill(0);
  for (let j = 0; j < taus.length; j += 1) {
    for (let i = 0; i < n; i += 1) {
      levelMean[i] += weights[j] * fMean[j][i];
      second[i] += weights[j] * (fVar[j][i] + fMean[j][i] * fMean[j][i]);
    }
  }
  const levelSd = levelMean.map((m, i) => Math.sqrt(Math.max(second[i] - m * m, 0)));

  return {
    pRising,
    meanChange,
    changeLow: mixtureQuantile(weights, mu, sd, 0.025),
    changeHigh: mixtureQuantile(weights, mu, sd, 0.975),
    levelMean,
    levelLow: levelMean.map((m, i) => m - 1.96 * levelSd[i]),
    levelHigh: levelMean.map((m, i) => m + 1.96 * levelSd[i]),
    label: trendLabel(pRising, meanChange, n, spec, config),
  };
}

export function trendLabel(
  pRising: number,
  meanChange: number,
  sessions: number,
  spec: TrendMeasureSpec,
  config: TrendModelConfig = TREND_MODEL,
): TrendLabel {
  if (sessions < config.minSessions) return "collecting";
  if (pRising >= config.pStar && meanChange >= spec.deltaMin) return "rising";
  if (1 - pRising >= config.pStar && meanChange <= -spec.deltaMin) return "falling";
  return "no_clear_change";
}
