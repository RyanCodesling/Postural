"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { manilaDayKey } from "./demoClock";

interface DemoClockContextValue {
  /** The app's current time: the real time, moved by the demo date only while the demo clock is set. */
  now: () => Date;
  /**
   * Today's Manila calendar day (YYYY-MM-DD) by that time. It changes once a
   * day, so a page that reads it (the camera page, say) does not redraw every
   * second.
   */
  todayKey: string;
  /** The server runs in demo mode (`npm run dev:demo`); the controls exist only then. */
  enabled: boolean;
  /** Demo mode is on and the demo-clock table is installed. */
  settingsAvailable: boolean;
  overrideActive: boolean;
}

const DemoClockContext = createContext<DemoClockContextValue>({
  now: () => new Date(),
  todayKey: manilaDayKey(Date.now()),
  enabled: false,
  settingsAvailable: false,
  overrideActive: false,
});

interface DemoClockResponse {
  available: boolean;
  isOverridden: boolean;
  offsetMs: number;
}

export function DemoClockProvider({ children }: { children: ReactNode }) {
  const [offsetMs, setOffsetMs] = useState(0);
  const [enabled, setEnabled] = useState(false);
  const [settingsAvailable, setSettingsAvailable] = useState(false);
  const [overrideActive, setOverrideActive] = useState(false);
  const [todayKey, setTodayKey] = useState(() => manilaDayKey(Date.now()));

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const response = await fetch("/api/demo-clock", { cache: "no-store" });
        if (cancelled) return;
        if (!response.ok) {
          // 404: the server was not started in demo mode, which only a restart
          // changes, so stop asking.
          if (response.status === 404) window.clearInterval(poll);
          setEnabled(false);
          setSettingsAvailable(false);
          setOffsetMs(0);
          setOverrideActive(false);
          return;
        }
        const state = (await response.json()) as DemoClockResponse;
        if (cancelled) return;
        setEnabled(true);
        setOffsetMs(state.offsetMs || 0);
        setOverrideActive(Boolean(state.isOverridden));
        setSettingsAvailable(Boolean(state.available));
      } catch {
        if (!cancelled) setSettingsAvailable(false);
      }
    };

    // Set before the first request, which may clear it.
    const poll = window.setInterval(() => void refresh(), 15_000);
    void refresh();
    const onClockUpdated = () => void refresh();
    window.addEventListener("demo-clock-updated", onClockUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener("demo-clock-updated", onClockUpdated);
      window.clearInterval(poll);
    };
  }, []);

  // The day is checked twice a minute; React skips the update while it is
  // unchanged, so nothing that reads it redraws until the date changes.
  useEffect(() => {
    const check = () => setTodayKey(manilaDayKey(Date.now() + offsetMs));
    check();
    const timer = window.setInterval(check, 30_000);
    return () => window.clearInterval(timer);
  }, [offsetMs]);

  const now = useCallback(() => new Date(Date.now() + offsetMs), [offsetMs]);
  const value = useMemo(
    () => ({ now, todayKey, enabled, settingsAvailable, overrideActive }),
    [now, todayKey, enabled, settingsAvailable, overrideActive],
  );

  return (
    <DemoClockContext.Provider value={value}>
      {children}
      {overrideActive && <DemoClockBadge now={now} />}
    </DemoClockContext.Provider>
  );
}

/** The amber "Demo clock" badge. Only it ticks every second, so the pages under it do not redraw. */
function DemoClockBadge({ now }: { now: () => Date }) {
  const label = useTickingLabel(now);
  return (
    <div className="fixed bottom-4 left-4 z-30 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-950 shadow-lg">
      Demo clock · {label}
    </div>
  );
}

/** The time `now()` gives, as text, refreshed every second in the component that shows it. */
export function useTickingLabel(now: () => Date): string {
  const [label, setLabel] = useState(() => now().toLocaleString());
  useEffect(() => {
    const tick = () => setLabel(now().toLocaleString());
    tick();
    const timer = window.setInterval(tick, 1_000);
    return () => window.clearInterval(timer);
  }, [now]);
  return label;
}

export function useDemoClock() {
  return useContext(DemoClockContext);
}
