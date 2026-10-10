/**
 * The demo clock lets an admin show the app on another date (calendars,
 * missed and make-up days) without changing the computer's clock. It works
 * only in a development server started with `npm run dev:demo`, which sets
 * DEMO_CLOCK=on. A normal start, and every production build, uses the real
 * time and ignores a demo date still saved in the database, so a forgotten
 * demo date cannot be stamped on real sessions.
 */
export function demoClockEnabled(env: { NODE_ENV?: string; DEMO_CLOCK?: string }): boolean {
  return env.NODE_ENV !== "production" && env.DEMO_CLOCK === "on";
}

export const DAY_MS = 24 * 60 * 60 * 1000;

/** The Asia/Manila calendar day (YYYY-MM-DD) of an instant: the app's "today". */
export function manilaDayKey(ms: number): string {
  return new Date(ms).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
}
