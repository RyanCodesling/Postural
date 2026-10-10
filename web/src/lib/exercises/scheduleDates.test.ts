/**
 * Prescription dates: a new or changed date may not be in the past, but a
 * running prescription keeps its past start, so it can still be extended.
 *
 *   npx tsx src/lib/exercises/scheduleDates.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pastScheduleDate, storedScheduleDates } from "./scheduleDates";

const today = "2026-10-10";
const running = { startDate: "2026-10-05", endDate: "2026-10-12" };

assert.equal(pastScheduleDate({ startDate: "2026-10-09", endDate: "2026-10-20" }, null, today), "start", "a new schedule starting yesterday");
assert.equal(pastScheduleDate({ startDate: today, endDate: "2026-10-20" }, null, today), null, "a new schedule starting today");
assert.equal(pastScheduleDate({ startDate: "2026-10-11", endDate: "2026-10-09" }, null, today), "end", "a new end in the past");
assert.equal(pastScheduleDate({ ...running, endDate: "2026-10-19" }, running, today), null,
  "a running prescription is extended (the update refused this)");
assert.equal(pastScheduleDate(running, running, today), null, "an unchanged schedule is not checked");
assert.equal(pastScheduleDate({ startDate: "2026-10-01", endDate: "2026-10-03" }, { startDate: "2026-10-01", endDate: "2026-10-03" }, today), null,
  "an unchanged, already ended schedule is not checked");
assert.equal(pastScheduleDate({ ...running, startDate: "2026-10-08" }, running, today), "start", "a start moved into the past");
assert.equal(pastScheduleDate({ ...running, endDate: "2026-10-09" }, running, today), "end", "an end moved into the past");

assert.deepEqual(storedScheduleDates({ start_date: "2026-10-05", end_date: "2026-10-12", assigned_date: "2026-10-01" }), running);
assert.deepEqual(storedScheduleDates({ start_date: null, end_date: null, assigned_date: "2026-10-01" }),
  { startDate: "2026-10-01", endDate: "2026-10-01" }, "older one-day rows fall back to the assigned date");
assert.equal(storedScheduleDates({}), null);

// Both the server and the assign page use the shared rule.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
for (const path of ["../../app/api/patient-exercises/route.ts", "../../app/(app)/dashboard/therapist/assign/page.tsx"]) {
  const source = read(path);
  assert.match(source, /pastScheduleDate\(/, `${path} uses the shared rule`);
  assert.doesNotMatch(source, /scheduleUnchanged/, `${path} has no rule of its own`);
}

console.log("Schedule dates passed: new, changed, unchanged and running schedules, stored dates, and both callers.");
