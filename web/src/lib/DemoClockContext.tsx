"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

interface DemoClockContextValue {
  effectiveNow: Date;
  overrideActive: boolean;
  settingsAvailable: boolean;
}

const DemoClockContext = createContext<DemoClockContextValue>({
  effectiveNow: new Date(),
  overrideActive: false,
  settingsAvailable: false,
});

interface DemoClockResponse {
  available: boolean;
  isOverridden: boolean;
  offsetMs: number;
}

export function DemoClockProvider({ children }: { children: ReactNode }) {
  const [offsetMs, setOffsetMs] = useState(0);
  const [overrideActive, setOverrideActive] = useState(false);
  const [settingsAvailable, setSettingsAvailable] = useState(false);
  const [effectiveNow, setEffectiveNow] = useState(() => new Date());

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const response = await fetch("/api/demo-clock", { cache: "no-store" });
        if (!response.ok) return;
        const state = (await response.json()) as DemoClockResponse;
        if (cancelled) return;
        setOffsetMs(state.offsetMs || 0);
        setOverrideActive(Boolean(state.isOverridden));
        setSettingsAvailable(Boolean(state.available));
      } catch {
        if (!cancelled) setSettingsAvailable(false);
      }
    };

    void refresh();
    const onClockUpdated = () => void refresh();
    window.addEventListener("demo-clock-updated", onClockUpdated);
    const poll = window.setInterval(() => void refresh(), 15_000);
    return () => {
      cancelled = true;
      window.removeEventListener("demo-clock-updated", onClockUpdated);
      window.clearInterval(poll);
    };
  }, []);

  useEffect(() => {
    const tick = () => setEffectiveNow(new Date(Date.now() + offsetMs));
    tick();
    const timer = window.setInterval(tick, 1_000);
    return () => window.clearInterval(timer);
  }, [offsetMs]);

  return (
    <DemoClockContext.Provider value={{ effectiveNow, overrideActive, settingsAvailable }}>
      {children}
      {overrideActive && (
        <div className="fixed bottom-4 left-4 z-30 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-950 shadow-lg">
          Demo clock · {effectiveNow.toLocaleString()}
        </div>
      )}
    </DemoClockContext.Provider>
  );
}

export function useDemoClock() {
  return useContext(DemoClockContext);
}