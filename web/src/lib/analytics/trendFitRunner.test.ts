import { strict as assert } from "node:assert";
import { TREND_MODEL } from "./trendModel";
import { fitModelSeries, modelSeries, prepareModelSeries, type TrendModelSession } from "./trendSeries";
import { TrendFitRunner, type TrendFitInput, type TrendFitJob, type TrendFitSnapshot, type TrendFitWork, type TrendFitWorker } from "./trendFitRunner";

class FakeWorker implements TrendFitWorker {
  onmessage: TrendFitWorker["onmessage"] = null;
  onerror: TrendFitWorker["onerror"] = null;
  onmessageerror: TrendFitWorker["onmessageerror"] = null;
  work: TrendFitWork | null = null;
  terminated = false;
  postMessage(work: TrendFitWork) { this.work = work; }
  terminate() { this.terminated = true; }
  finish(index: number) {
    const job = this.work!.jobs.find(job => job.index === index)!;
    this.onmessage!({ data: { index, series: fitModelSeries(job.series, this.work!.config) } } as MessageEvent<TrendFitJob>);
  }
}

const sessions: TrendModelSession[] = Array.from({ length: 5 }, (_, i) => ({
  exerciseKind: "dynamic", setCount: 1, leftReps: i === 1 ? 2 : 12,
  avgLeftPeakValue: 82 + i, sdLeftPeakValue: 2 + i / 10,
}));
const input = (): TrendFitInput => ({
  contextKey: "ex_001:left:none:measurement-v1", config: TREND_MODEL,
  series: [prepareModelSeries("ex_001", sessions, "peak", "left")],
});
const workers: FakeWorker[] = [];
const runner = new TrendFitRunner(() => { const worker = new FakeWorker(); workers.push(worker); return worker; });
let snapshot: TrendFitSnapshot;
let publications = 0;
const publish = (next: TrendFitSnapshot) => { snapshot = next; publications++; };

runner.run(input(), publish);
assert.equal(snapshot!.entries[0].status, "loading");
assert.equal(snapshot!.entries[0].series.values[1], null, "excluded sessions stay excluded while fitting");
workers[0].finish(0);
assert.deepEqual(snapshot!.entries[0].series, modelSeries("ex_001", sessions, "peak", "left"));
assert.equal(workers[0].terminated, true);

runner.run(structuredClone(input()), publish);
assert.equal(workers.length, 1, "equivalent data on parent rerender reuses the fit");
const expanded = input();
expanded.series.push(prepareModelSeries("ex_001", sessions, "peakSpread", "left"));
runner.run(expanded, publish);
assert.deepEqual(workers[1].work!.jobs.map(job => job.index), [1], "opening extras fits only the newly requested measure");
assert.equal(snapshot!.entries[0].status, "ready", "main band remains ready while extras fit");
workers[1].finish(1);
runner.run(input(), publish);
runner.run(structuredClone(expanded), publish);
assert.equal(workers.length, 2, "closing/reopening extras and selecting points do not refit");

// Each field that changes fit meaning invalidates reuse even if everything else is equal.
const changedInputs = [
  { ...input(), contextKey: "ex_001:left:none:measurement-v2" },
  { ...input(), config: { ...TREND_MODEL, pStar: 0.999 } },
  { ...input(), series: [prepareModelSeries("ex_001", sessions.map((s, i) => i === 0 ? { ...s, leftReps: 4 } : s), "peak", "left")] },
  { ...input(), series: [prepareModelSeries("ex_001", sessions.map((s, i) => i === 0 ? { ...s, avgLeftPeakValue: 10 } : s), "peak", "left")] },
  { ...input(), series: [prepareModelSeries("ex_001", sessions.slice(1), "peak", "left")] },
];
for (const changed of changedInputs) {
  const count: number = workers.length;
  runner.run(changed, publish);
  assert.equal(workers.length, count + 1, "context, configuration, units, values and deletion invalidate the fit");
}
const old = workers.at(-1)!;
const lateMessage = old.onmessage!;
runner.run({ ...input(), contextKey: "another-history" }, publish);
assert.equal(old.terminated, true, "replaced work is cancelled");
const beforeLate = publications;
lateMessage({ data: { index: 0, series: fitModelSeries(old.work!.jobs[0].series) } } as MessageEvent<TrendFitJob>);
assert.equal(publications, beforeLate, "a late reply cannot overwrite a newer history");

const failedWorker = workers.at(-1)!;
failedWorker.onerror!({ preventDefault() {} } as ErrorEvent);
assert.equal(snapshot!.entries[0].status, "error");
assert.deepEqual(snapshot!.entries[0].series.values, input().series[0].values, "failed fitting preserves measured points");
runner.run({ ...input(), contextKey: "another-history" }, publish);
workers.at(-1)!.finish(0);
assert.equal(snapshot!.entries[0].status, "ready", "failed jobs can be retried");

const noWorker = new TrendFitRunner(() => { throw new Error("Worker unavailable"); });
noWorker.run(input(), publish);
assert.equal(snapshot!.entries[0].status, "error", "startup failure is explicit instead of a synchronous fallback");
noWorker.run({ ...input(), series: [prepareModelSeries("ex_001", sessions.slice(0, 1), "peak", "left")] }, publish);
assert.equal(snapshot!.entries[0].status, "ready");
assert.equal(snapshot!.entries[0].series.label, "collecting", "too few sessions need no worker");

const smallWorkers: FakeWorker[] = [];
const bounded = new TrendFitRunner(() => { const worker = new FakeWorker(); smallWorkers.push(worker); return worker; }, 1);
for (const contextKey of ["a", "b", "a"]) {
  bounded.run({ ...input(), contextKey }, publish);
  smallWorkers.at(-1)!.finish(0);
}
assert.equal(smallWorkers.length, 3, "cache eviction is bounded and recomputes an evicted history");
runner.cancel();
bounded.cancel();
console.log("Trend fitting: parity, reuse, lazy extras, invalidation, cancellation, failure/retry and bounded cache passed.");
