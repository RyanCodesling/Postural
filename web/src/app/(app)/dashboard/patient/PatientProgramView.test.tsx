/**
 * The patient dashboard's Last Session card, which replaced the 0-180 range
 * gauge: the newest session with a result, in counts only (repetitions counted
 * and those that reached the full-range line, or time held), per prescribed
 * side, never averaged and with no angle values. Also the program heading once
 * the schedule has ended, and no second completion percentage.
 * Run with: npx tsx "src/app/(app)/dashboard/patient/PatientProgramView.test.tsx"
 */
import { strict as assert } from "node:assert";
import { renderToStaticMarkup } from "react-dom/server";
import type { OccurrenceStatus } from "@/lib/exercises/occurrences";
import PatientProgramView, {
  dayState,
  itemStatusLabel,
  lastSessionSummary,
  type LastSessionRecord,
  type ProgramOccurrence,
} from "./PatientProgramView";

const TODAY = "2026-10-19";

let nextId = 1;
const session = (startedAt: string, over: Partial<LastSessionRecord> = {}): LastSessionRecord => ({
  id: nextId++,
  occurrenceId: null,
  exerciseKind: "dynamic",
  exerciseName: "Lateral Arm Raises",
  prescribedSide: "both",
  startedAt,
  endedAt: startedAt,
  endReason: "completed",
  durationMs: 60_000,
  setCount: 2,
  totalReps: 20,
  completeReps: 17,
  leftReps: 10,
  rightReps: 10,
  completeLeftReps: 9,
  completeRightReps: 8,
  totalPairedHoldMs: null,
  totalTargetHoldMs: null,
  totalLeftHoldMs: null,
  totalRightHoldMs: null,
  ...over,
});
const nothingRecorded = { setCount: 0, totalReps: 0, completeReps: 0, leftReps: 0, rightReps: 0, completeLeftReps: 0, completeRightReps: 0 };

// 1. The newest session with a result; a newer one with nothing recorded is skipped.
const older = session("2026-10-17T02:00:00Z");
const newest = session("2026-10-18T02:00:00Z", { exerciseName: "Neck Lateral Flexion" });
const empty = session("2026-10-18T09:00:00Z", { exerciseName: "Wall Angels", ...nothingRecorded });
assert.equal(lastSessionSummary([older, empty, newest])?.exerciseName, "Neck Lateral Flexion", "the newest session with a result");
assert.equal(lastSessionSummary([]), null, "no sessions");
assert.equal(lastSessionSummary([empty]), null, "no session with a result");

// 2. Both sides stay apart: counted and full range per side, no average.
assert.deepEqual(
  lastSessionSummary([newest])?.reps,
  [
    { label: "Left", counted: 10, fullRange: 9 },
    { label: "Right", counted: 10, fullRange: 8 },
  ],
  "per-side counts",
);

// 3. A one-sided prescription shows only its side, even if the other side was stored.
const leftOnly = session("2026-10-18T02:00:00Z", { prescribedSide: "left", leftReps: 6, completeLeftReps: 5, rightReps: 3, completeRightReps: 3 });
const leftSummary = lastSessionSummary([leftOnly]);
assert.deepEqual(leftSummary?.reps, [{ label: "Left", counted: 6, fullRange: 5 }], "only the prescribed side");
assert.equal(leftSummary?.sideText, "Left side");

// 4. A hold: time held per side against the prescribed time; the paired total fills a missing side.
const hold = session("2026-10-18T02:00:00Z", {
  exerciseKind: "isometric",
  exerciseName: "Arm Abduction at 90°",
  prescribedSide: "right",
  setCount: 1, totalReps: 0, completeReps: 0, leftReps: 0, rightReps: 0, completeLeftReps: 0, completeRightReps: 0,
  totalRightHoldMs: 5_000,
  totalTargetHoldMs: 5_000,
});
const holdSummary = lastSessionSummary([hold]);
assert.equal(holdSummary?.reps, null, "a hold has no repetition rows");
assert.deepEqual(holdSummary?.holds, [{ label: "Right", heldMs: 5_000 }], "the prescribed side's hold");
assert.equal(holdSummary?.targetHoldMs, 5_000);
const paired = session("2026-10-18T02:00:00Z", { ...hold, id: nextId++, prescribedSide: "both", totalRightHoldMs: null, totalPairedHoldMs: 30_000 });
assert.deepEqual(lastSessionSummary([paired])?.holds, [
  { label: "Left", heldMs: 30_000 },
  { label: "Right", heldMs: 30_000 },
], "the paired total for sides without their own");

// 5. Older rows kept without per-side repetitions show one Total column.
const legacy = session("2026-10-18T02:00:00Z", { leftReps: 0, rightReps: 0, completeLeftReps: 0, completeRightReps: 0, totalReps: 12, completeReps: 10 });
assert.deepEqual(lastSessionSummary([legacy])?.reps, [{ label: "Total", counted: 12, fullRange: 10 }], "legacy totals");

// 5b. When only the unprescribed side moved, the treated side keeps its own 0:
// the other side's repetitions are never shown as its result (Codex review 2026-10-19, finding 1).
const otherSideOnly = session("2026-10-18T02:00:00Z", {
  prescribedSide: "left",
  totalReps: 5, completeReps: 5, leftReps: 0, completeLeftReps: 0, rightReps: 5, completeRightReps: 5,
});
assert.deepEqual(lastSessionSummary([otherSideOnly])?.reps, [{ label: "Left", counted: 0, fullRange: 0 }], "no Total from the other side");
assert.equal(lastSessionSummary([otherSideOnly])?.sideText, "Left side");

// 6. The day is the Manila day: 17:30 UTC on Oct 18 is Oct 19 in Manila, so "Today".
assert.equal(lastSessionSummary([session("2026-10-18T17:30:00Z")])?.day, "2026-10-19", "Manila day");

const occurrence = (id: number, due: string, status: OccurrenceStatus = "pending"): ProgramOccurrence => ({
  id, due_date: due, makeup_until: due, status, exercise_id: "ex_001", name: "Lateral Arm Raises",
  sets: 2, reps: 10, hold_seconds: 0, monitoring_mode: "camera",
});
const render = (occurrences: ProgramOccurrence[], sessions: LastSessionRecord[], onShowProgress?: () => void) =>
  renderToStaticMarkup(
    <PatientProgramView
      patientName="Test patient"
      occurrences={occurrences}
      sessions={sessions}
      today={TODAY}
      tagFor={() => ({ label: "", classes: "" })}
      isActionable={() => false}
      calendar={null}
      onShowProgress={onShowProgress}
    />,
  ).replace(/<!-- -->/g, "");

// 7. The rendered card: counts only, no dial, no angle values, no first/best/latest.
const card = render([], [session("2026-10-18T17:30:00Z", { completeLeftReps: 7 })], () => {});
assert.ok(card.includes("Last Session"), "the card's title");
assert.ok(card.includes("Both sides · Today · 2 sets"), "side, day and sets");
assert.match(card, /Counted<\/th><td[^>]*>10<\/td><td[^>]*>10</, "counted per side");
assert.match(card, /Full range<\/th><td[^>]*>7<\/td><td[^>]*>8</, "full range per side");
assert.ok(card.includes("Open My Progress"), "the link to My Progress");
for (const gone of ["Range of Motion", "Best", "Latest", "First", "180", "Camera estimates", 'viewBox="0 0 200 118"']) {
  assert.ok(!card.includes(gone), `no "${gone}" on the dashboard`);
}
assert.ok(!render([], [session("2026-10-17T02:00:00Z")]).includes("Open My Progress"), "no link without a handler");
assert.ok(render([], [session("2026-10-17T02:00:00Z", { setCount: 1 })]).includes("Both sides · Sat, Oct 17 · 1 set<"), "an earlier day by date, one set");
assert.match(render([], [hold]), /Right held<\/th><td[^>]*>5s<span[^>]*> of 5s<\/span>/, "a hold against its prescribed time");
assert.ok(render([], []).includes("Finish a session to see it here."), "the empty card");

// 8. The completion percentage shows once (the tile), not again as a ring.
const program = render([occurrence(1, "2026-10-19", "completed"), occurrence(2, "2026-10-20")], []);
assert.equal((program.match(/>50</g) ?? []).length, 1, "one 50 %");
assert.ok(!program.includes("-rotate-90"), "no ring");

// The stacked (phone) layout uses a minmax(0, 1fr) column, so long day rows truncate instead of widening the page.
assert.match(program, /class="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-12"/, "a column that cannot outgrow the screen");

// 9. The heading: the week while the schedule runs, "Schedule ended" once its last day has passed.
assert.match(program, /Week 1\/1/, "a running schedule shows its week");
assert.match(program, /Beginning Monday, Oct 19/);
const ended = render([occurrence(1, "2026-09-03"), occurrence(2, "2026-09-10")], []);
assert.match(ended, /Schedule ended Thursday, Sep 10/, "an ended schedule says so");
assert.match(ended, /Began Thursday, Sep 3/);
assert.ok(!/Week \d/.test(ended), "no week number after the end");

// 10. A past day stopped for pain, or partly done, is not called missed; the
// calendar's day rules decide (Codex review 2026-10-19, finding 2).
const YESTERDAY = "2026-10-18";
const openUntil = (o: ProgramOccurrence, day: string): ProgramOccurrence => ({ ...o, makeup_until: day });
assert.equal(dayState(YESTERDAY, [occurrence(1, YESTERDAY, "pain_stopped")], TODAY), "pain", "stopped for pain");
assert.equal(dayState(YESTERDAY, [occurrence(1, YESTERDAY, "completed"), occurrence(2, YESTERDAY, "pain_stopped")], TODAY), "partial", "done and stopped for pain");
assert.equal(dayState(YESTERDAY, [occurrence(1, YESTERDAY, "completed"), occurrence(2, YESTERDAY)], TODAY), "partial", "done and missed");
assert.equal(dayState(YESTERDAY, [occurrence(1, YESTERDAY)], TODAY), "missed", "nothing done, make-up over");
assert.equal(dayState(YESTERDAY, [openUntil(occurrence(1, YESTERDAY), "2026-10-20")], TODAY), "makeup", "make-up still open");
assert.equal(dayState(YESTERDAY, [occurrence(1, YESTERDAY, "completed")], TODAY), "done");
assert.equal(dayState(TODAY, [occurrence(1, TODAY, "pain_stopped")], TODAY), "today");
assert.equal(dayState("2026-10-20", [occurrence(1, "2026-10-20")], TODAY), "upcoming");

const painDay = render([occurrence(1, YESTERDAY, "pain_stopped")], []);
assert.ok(painDay.includes('sm:inline">Stopped for pain</span>'), "the day row says stopped for pain");
assert.ok(!painDay.includes('sm:inline">Missed</span>'), "and not missed");
assert.ok(painDay.includes("border-l-orange-400") && !painDay.includes("border-l-red-400"), "not drawn red");

// Each exercise's pill shows its own state, not its day's.
assert.equal(itemStatusLabel(occurrence(1, YESTERDAY, "pain_stopped"), YESTERDAY, TODAY), "Stopped for pain");
assert.equal(itemStatusLabel(occurrence(2, YESTERDAY), YESTERDAY, TODAY), "Missed");
assert.equal(itemStatusLabel(openUntil(occurrence(3, YESTERDAY), "2026-10-20"), YESTERDAY, TODAY), "Make-up open");
assert.equal(itemStatusLabel(occurrence(4, TODAY), TODAY, TODAY), "Today");
assert.equal(itemStatusLabel(occurrence(5, "2026-10-20"), "2026-10-20", TODAY), "Upcoming");

console.log("Last Session card: newest session with a result, per-side counts only, no gauge; schedule heading and one percentage; day states follow the calendar's rules.");
