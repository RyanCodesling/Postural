import type { TrendModelConfig } from "./trendModel";
import type { ModelSeries } from "./trendSeries";

export interface TrendFitInput {
  contextKey: string;
  config: TrendModelConfig;
  series: ModelSeries[];
}
export interface TrendFitJob { index: number; series: ModelSeries }
export interface TrendFitWork { jobs: TrendFitJob[]; config: TrendModelConfig }
export interface TrendFitEntry { series: ModelSeries; status: "ready" | "loading" | "error" }
export interface TrendFitSnapshot { key: string; entries: TrendFitEntry[] }
export interface TrendFitWorker {
  onmessage: ((event: MessageEvent<TrendFitJob>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage(work: TrendFitWork): void;
  terminate(): void;
}

const needsFit = (s: ModelSeries) => !!s.spec && s.spec.band !== false && s.counted >= 2;

/** Per-card, memory-only cache. Nothing is shared between users or persisted.
 * Keys include the complete model configuration, comparable context, ordered
 * values, unit counts, side, measure and missing positions. No history is cut.
 */
export class TrendFitRunner {
  private cache = new Map<string, ModelSeries>();
  private worker: TrendFitWorker | null = null;
  private generation = 0;

  constructor(private createWorker: () => TrendFitWorker, private cacheLimit = 64) {}

  private keys(input: TrendFitInput): string[] {
    const prefix = JSON.stringify([input.contextKey, input.config]);
    return input.series.map(series => `${prefix}\n${JSON.stringify(series)}`);
  }

  preview(input: TrendFitInput): TrendFitSnapshot {
    const keys = this.keys(input);
    return {
      key: JSON.stringify(input),
      entries: input.series.map((series, i) => {
        const cached = this.cache.get(keys[i]);
        return cached ? { series: cached, status: "ready" } : { series, status: needsFit(series) ? "loading" : "ready" };
      }),
    };
  }

  cancel(): void {
    this.generation++;
    this.worker?.terminate();
    this.worker = null;
  }

  run(input: TrendFitInput, publish: (snapshot: TrendFitSnapshot) => void): void {
    this.cancel();
    const generation = this.generation;
    const keys = this.keys(input);
    let snapshot = this.preview(input);
    const pending = new Set(snapshot.entries.flatMap((entry, i) => entry.status === "loading" ? [i] : []));
    // Touch reused entries, so opening extras does not evict the main measures.
    for (const key of keys) {
      const cached = this.cache.get(key);
      if (cached) { this.cache.delete(key); this.cache.set(key, cached); }
    }
    publish(snapshot);
    if (!pending.size) return;

    const fail = () => {
      if (this.generation !== generation) return;
      snapshot = { ...snapshot, entries: snapshot.entries.map(entry =>
        entry.status === "loading" ? { ...entry, status: "error" } : entry) };
      this.cancel();
      publish(snapshot);
    };
    try {
      const worker = this.createWorker();
      this.worker = worker;
      worker.onerror = event => { event.preventDefault(); fail(); };
      worker.onmessageerror = fail;
      worker.onmessage = ({ data }) => {
        if (this.generation !== generation || !pending.has(data.index)) return;
        const { index, series } = data;
        pending.delete(index);
        this.cache.set(keys[index], series);
        while (this.cache.size > this.cacheLimit) this.cache.delete(this.cache.keys().next().value!);
        snapshot = {
          ...snapshot,
          entries: snapshot.entries.map((entry, i) => i === index ? { series, status: "ready" } : entry),
        };
        if (!pending.size) this.cancel();
        publish(snapshot);
      };
      worker.postMessage({ config: input.config, jobs: [...pending].map(index => ({ index, series: input.series[index] })) });
    } catch {
      // Worker creation/transfer can fail (for example a restrictive CSP).
      // Keep measured points, show an explicit retry, and never block the UI
      // by silently falling back to a synchronous long-history fit.
      fail();
    }
  }
}
