"use client";

import { useEffect } from "react";
import { HEARTBEAT_MS } from "./presence";

/**
 * Reports to the server that a signed-in page is open, while it is visible.
 * A hidden tab stops reporting, so the admin sees that user go offline once
 * the online window passes. Failures are ignored: the next beat retries.
 */
export function usePresenceHeartbeat(userId: string | null | undefined) {
  useEffect(() => {
    if (!userId) return;
    const beat = () => {
      if (document.visibilityState !== "visible") return;
      fetch("/api/presence", { method: "POST" }).catch(() => {});
    };
    beat();
    const interval = window.setInterval(beat, HEARTBEAT_MS);
    document.addEventListener("visibilitychange", beat);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", beat);
    };
  }, [userId]);
}
