/**
 * The demo clock lets an admin show the app on another date (calendars,
 * missed and make-up days) without changing the computer's clock. It works
 * only after an admin enables demo tools in the database, in development or
 * production. Disabled tools ignore saved offsets. DEMO_CLOCK=off is an optional
 * deployment lock; an unset variable permits the admin controls without enabling
 * them. Changing the admin switch needs no server restart.
 */
export function demoClockAllowed(env: { NODE_ENV?: string; DEMO_CLOCK?: string }): boolean {
  return env.DEMO_CLOCK !== "off";
}

export class DemoClockError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "DemoClockError";
  }
}

export const DAY_MS = 24 * 60 * 60 * 1000;

/** The Asia/Manila calendar day (YYYY-MM-DD) of an instant: the app's "today". */
export function manilaDayKey(ms: number): string {
  return new Date(ms).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
}
