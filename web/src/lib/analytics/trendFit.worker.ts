import { fitModelSeries } from "./trendSeries";
import type { TrendFitJob, TrendFitWork } from "./trendFitRunner";

// Keep the same arithmetic as synchronous consumers. Returning each series
// separately lets the main charts appear before slower supplementary fits.
self.onmessage = ({ data }: MessageEvent<TrendFitWork>) => {
  for (const { index, series } of data.jobs) {
    const result: TrendFitJob = { index, series: fitModelSeries(series, data.config) };
    self.postMessage(result);
  }
};
