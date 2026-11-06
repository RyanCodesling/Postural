"use client";

import { useEffect, useMemo, useState } from "react";
import { TREND_MODEL } from "./trendModel";
import type { ModelSeries } from "./trendSeries";
import { TrendFitRunner, type TrendFitInput, type TrendFitSnapshot } from "./trendFitRunner";

export function useTrendFits(contextKey: string, series: ModelSeries[]) {
  const input = useMemo(() => ({ contextKey, config: TREND_MODEL, series }), [contextKey, series]);
  // Equal data from a freshly constructed parent group must not restart a fit.
  const key = useMemo(() => JSON.stringify(input), [input]);
  const [result, setResult] = useState<TrendFitSnapshot | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [runner] = useState(() => new TrendFitRunner(() =>
    new Worker("/workers/trend-fit.js", { type: "module", name: "postural-trends" })));

  useEffect(() => {
    runner.run(JSON.parse(key) as TrendFitInput, setResult);
    return () => runner.cancel();
  }, [key, runner, attempt]);

  // Never show a prior history's fitted bands while the next effect is pending.
  const snapshot = result?.key === key ? result : runner.preview(input);
  return { entries: snapshot.entries, retry: () => setAttempt(n => n + 1) };
}
