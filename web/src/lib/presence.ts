/**
 * Who is online, for the admin dashboard's User status panel.
 *
 * A signed-in page reports in every HEARTBEAT_MS while it is visible. A user
 * counts as online when their last report is within ONLINE_WINDOW_MS and they
 * have not pressed Log Out since. Closing the tab therefore shows them offline
 * within the window. All times are real time, never the demo clock.
 */
export const HEARTBEAT_MS = 45_000;
export const ONLINE_WINDOW_MS = 120_000;

export type PresenceRole = "patient" | "therapist";

export interface UserPresence {
  id: string;
  name: string;
  role: PresenceRole;
  online: boolean;
  /** ISO time of the last report, or null if the user has never been seen. */
  lastSeenAt: string | null;
}

/** Online first, then the most recently active, then never seen, each by name. */
export function sortPresence(users: UserPresence[]): UserPresence[] {
  const seen = (u: UserPresence) => (u.lastSeenAt ? Date.parse(u.lastSeenAt) : -Infinity);
  return [...users].sort(
    (a, b) =>
      Number(b.online) - Number(a.online) ||
      seen(b) - seen(a) ||
      a.name.localeCompare(b.name),
  );
}

/** "Online now", "Last active 5 min ago", "Last active Oct 30", or "Never signed in". */
export function describePresence(user: Pick<UserPresence, "online" | "lastSeenAt">, now: number): string {
  if (user.online) return "Online now";
  if (!user.lastSeenAt) return "Never signed in";
  const at = Date.parse(user.lastSeenAt);
  if (Number.isNaN(at)) return "Never signed in";
  const minutes = Math.max(1, Math.round((now - at) / 60_000));
  if (minutes < 60) return `Last active ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Last active ${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `Last active ${days} ${days === 1 ? "day" : "days"} ago`;
  return `Last active ${new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}
