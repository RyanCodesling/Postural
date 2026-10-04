/**
 * Trend model parity: the TypeScript port must reproduce the Python reference
 * (ml/trend/model.py) on the fixtures the evaluation wrote with the frozen
 * configuration, and its normal CDF must be accurate.
 * Run with: npx tsx src/lib/analytics/trendModel.test.ts
 */
import fixtures from "./trendModelFixtures.json";
import { fitTrend, normalCdf, TREND_MODEL, trendMeasureSpec, type TrendLabel } from "./trendModel";

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`      ${err instanceof Error ? err.message : String(err)}`);
    failed += 1;
  }
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
function close(actual: number, expected: number, tolerance: number, what: string) {
  assert(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)),
    `${what}: ${actual} vs ${expected}`);
}

type FixtureCase = {
  name: string; measure: string; values: number[]; units: number[];
  pRising: number; meanChange: number; changeLow: number; changeHigh: number;
  levelMean: number[]; levelLow: number[]; levelHigh: number[]; label: number;
};

console.log("\nTrend model parity with the Python reference\n");

test("the fixtures were written with this configuration", () => {
  assert(fixtures.configVersion === TREND_MODEL.version, `${fixtures.configVersion} vs ${TREND_MODEL.version}`);
});

test("normal CDF matches reference values", () => {
  close(normalCdf(0), 0.5, 1e-15, "Φ(0)");
  close(normalCdf(1.959963984540054), 0.975, 1e-13, "Φ(1.96)");
  close(normalCdf(-1.959963984540054), 0.025, 1e-13, "Φ(-1.96)");
  // Reference values from SciPy's ndtr.
  close(normalCdf(-5), 2.866515718791933e-7, 1e-12, "Φ(-5)");
  assert(Math.abs(normalCdf(-8) - 6.22096057427174e-16) < 1e-27, `Φ(-8): ${normalCdf(-8)}`);
  close(normalCdf(3.5), 0.9997673709209645, 1e-14, "Φ(3.5)");
});

for (const c of fixtures.cases as FixtureCase[]) {
  test(c.name, () => {
    const colon = c.measure.indexOf(":");
    const spec = trendMeasureSpec(c.measure.slice(0, colon), c.measure.slice(colon + 1));
    assert(spec, `no spec for ${c.measure}`);
    const fit = fitTrend(c.values, c.units, spec);
    close(fit.pRising, c.pRising, 1e-9, "P(rising)");
    close(fit.meanChange, c.meanChange, 1e-9, "mean change");
    close(fit.changeLow, c.changeLow, 1e-7, "change 2.5 %");
    close(fit.changeHigh, c.changeHigh, 1e-7, "change 97.5 %");
    c.levelMean.forEach((m, i) => close(fit.levelMean[i], m, 1e-9, `level ${i}`));
    c.levelLow.forEach((m, i) => close(fit.levelLow[i], m, 1e-7, `level low ${i}`));
    c.levelHigh.forEach((m, i) => close(fit.levelHigh[i], m, 1e-7, `level high ${i}`));
    const expected: TrendLabel =
      c.values.length < TREND_MODEL.minSessions ? "collecting"
        : c.label === 1 ? "rising" : c.label === -1 ? "falling" : "no_clear_change";
    assert(fit.label === expected, `label ${fit.label} vs ${expected}`);
  });
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exitCode = 1;
