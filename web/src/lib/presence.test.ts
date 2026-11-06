/**
 * Tests for the admin dashboard's User status panel.
 * Run with: npx tsx src/lib/presence.test.ts
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describePresence, HEARTBEAT_MS, ONLINE_WINDOW_MS, sortPresence, type UserPresence } from "./presence";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`      ${error instanceof Error ? error.message : String(error)}`);
    failed += 1;
  }
}

function assertEq(actual: unknown, expected: unknown, label: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const now = Date.parse("2026-10-31T12:00:00Z");
const ago = (ms: number) => new Date(now - ms).toISOString();

test("a missed heartbeat still leaves the user online", () => {
  // One late report must not flicker the dot: the window covers two heartbeats with room to spare.
  if (ONLINE_WINDOW_MS < HEARTBEAT_MS * 2) throw new Error("the online window must span at least two heartbeats");
});

test("the label reads online, minutes, hours, days, a date, or never", () => {
  assertEq(describePresence({ online: true, lastSeenAt: ago(10_000) }, now), "Online now", "online");
  assertEq(describePresence({ online: false, lastSeenAt: ago(20_000) }, now), "Last active 1 min ago", "under a minute rounds up");
  assertEq(describePresence({ online: false, lastSeenAt: ago(25 * 60_000) }, now), "Last active 25 min ago", "minutes");
  assertEq(describePresence({ online: false, lastSeenAt: ago(3 * 3_600_000) }, now), "Last active 3 h ago", "hours");
  assertEq(describePresence({ online: false, lastSeenAt: ago(26 * 3_600_000) }, now), "Last active 1 day ago", "one day");
  assertEq(describePresence({ online: false, lastSeenAt: ago(4 * 86_400_000) }, now), "Last active 4 days ago", "days");
  assertEq(describePresence({ online: false, lastSeenAt: ago(20 * 86_400_000) }, now), "Last active Oct 11, 2026", "a date after a week");
  assertEq(describePresence({ online: false, lastSeenAt: null }, now), "Never signed in", "never seen");
});

test("online users come first, then the most recent, then those never seen", () => {
  const user = (name: string, online: boolean, lastSeenAt: string | null): UserPresence => ({ id: name, name, role: "patient", online, lastSeenAt });
  const order = sortPresence([
    user("Never B", false, null),
    user("Old", false, ago(5 * 86_400_000)),
    user("Online", true, ago(30_000)),
    user("Never A", false, null),
    user("Recent", false, ago(3_600_000)),
  ]).map((u) => u.name);
  assertEq(order, ["Online", "Recent", "Old", "Never A", "Never B"], "order");
});

test("the schema script adds both columns without touching rows", () => {
  const sql = read("../../../scripts/user_presence_pg.sql");
  for (const column of ["last_seen_at TIMESTAMPTZ", "signed_out_at TIMESTAMPTZ"]) {
    if (!sql.includes(`ADD COLUMN IF NOT EXISTS ${column}`)) throw new Error(`missing ${column}`);
  }
  if (/\b(UPDATE|DELETE|INSERT|DROP)\b/i.test(sql)) throw new Error("the script must be additive only");
});

test("a fresh server database gets the presence columns", () => {
  if (!read("../../../deploy/server/02_app_db.sh").includes("user_presence_pg")) throw new Error("02_app_db.sh must run user_presence_pg.sql");
});

test("every signed-in page reports in, and Log Out marks the user offline", () => {
  if (!read("../app/(app)/layout.tsx").includes("usePresenceHeartbeat")) throw new Error("the signed-in layout must send the heartbeat");
  if (!read("../app/api/auth/logout/route.ts").includes("recordUserSignedOut")) throw new Error("Log Out must record the sign-out");
  if (!read("../app/api/auth/login/route.ts").includes("recordUserSeen")) throw new Error("signing in must count as being seen");
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
