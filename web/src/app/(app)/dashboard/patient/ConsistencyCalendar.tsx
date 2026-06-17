"use client";

import { useState } from "react";
import {
  rollupDay,
  type DayState,
  type OccurrenceLite,
  type OccurrenceStatus,
} from "@/lib/exercises/occurrences";

// Month-view calendar of a patient's adherence. Each day is colored by how the
// scheduled work due that day went (complete / partial / missed / upcoming /
// rest), computed from the patient's exercise occurrences. Sessions still drive
// the activity stats (streak / totals) and mark "extra" training done on days
// nothing was scheduled.

interface CalendarSession {
  startedAt: string;
  // Used to exclude zero-outcome starts. A session row is created the instant the
  // patient presses Start (before countdown / any set or rep), so a session only
  // counts as "did a routine" once it has recorded at least one set or rep.
  setCount?: number;
  totalReps?: number;
}

interface CalendarOccurrence {
  due_date: string;
  makeup_until: string;
  status: OccurrenceStatus;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DOW = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

// Local (Asia/Manila) YYYY-MM-DD day key for an ISO timestamp. Mirrors the
// patient page's today() helper so "a day" means the same thing across the UI.
function dayKeyPH(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }); // YYYY-MM-DD
}

function todayKeyPH(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function makeKey(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function parseKey(key: string): { y: number; m: number; d: number } {
  const [y, m, d] = key.split("-").map(Number);
  return { y, m, d };
}

// Calendar date minus one day. Done in UTC so it's pure day arithmetic on an
// abstract date (no local-timezone / DST drift) — the keys are already local
// day strings, never converted back through a timezone.
function prevDayKey(key: string): string {
  const { y, m, d } = parseKey(key);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return makeKey(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

// Consecutive active days ending today — or yesterday if today has no session
// yet, so the streak isn't reset just because the patient hasn't trained today.
function computeStreak(counts: Map<string, number>, todayKey: string): number {
  let key = todayKey;
  if ((counts.get(key) ?? 0) === 0) key = prevDayKey(key);
  let streak = 0;
  while ((counts.get(key) ?? 0) > 0) {
    streak++;
    key = prevDayKey(key);
  }
  return streak;
}

// Tailwind classes for a day cell by its adherence state.
function cellClasses(state: DayState, isFuture: boolean): string {
  switch (state) {
    case "complete":
      return "bg-green-600 text-white font-semibold";
    case "partial":
      return "bg-amber-400 text-white font-semibold";
    case "overdue":
      return "bg-white border border-amber-400 text-amber-700";
    case "missed":
      return "bg-red-500 text-white font-semibold";
    case "due":
      return "bg-white border border-green-400 text-green-700";
    default: // rest
      return isFuture ? "bg-gray-50 text-gray-300" : "bg-gray-50 text-gray-500";
  }
}

export default function ConsistencyCalendar({
  sessions,
  occurrences,
}: {
  sessions: CalendarSession[];
  occurrences: CalendarOccurrence[];
}) {
  // Only "outcome-bearing" sessions count as a routine day — a session row is
  // created the moment Start is pressed, so accidental or immediately-abandoned
  // starts (no set, no rep) must not inflate the streak / totals / "did a routine".
  const realSessions = sessions.filter(
    (s) => (s.setCount ?? 0) > 0 || (s.totalReps ?? 0) > 0
  );

  // Sessions per local day.
  const counts = new Map<string, number>();
  for (const s of realSessions) {
    const key = dayKeyPH(s.startedAt);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  // Scheduled occurrences grouped by due day, for the adherence rollup.
  const occByDay = new Map<string, OccurrenceLite[]>();
  for (const o of occurrences) {
    if (!o.due_date) continue;
    const list = occByDay.get(o.due_date) ?? [];
    list.push({ dueDate: o.due_date, makeupUntil: o.makeup_until ?? o.due_date, status: o.status });
    occByDay.set(o.due_date, list);
  }

  const todayKey = todayKeyPH();
  const today = parseKey(todayKey);

  // Which month the grid shows (defaults to the current month). Stats below are
  // anchored to today regardless of which month is being viewed.
  const [view, setView] = useState<{ y: number; m: number }>({ y: today.y, m: today.m });

  // Summary stats (anchored to today).
  const streak = computeStreak(counts, todayKey);
  const monthPrefix = `${today.y}-${pad2(today.m)}-`;
  let activeThisMonth = 0;
  for (const [key, c] of counts) {
    if (c > 0 && key.startsWith(monthPrefix)) activeThisMonth++;
  }
  const totalSessions = realSessions.length;

  // Grid layout for the viewed month. new Date(y, m-1, 1).getDay() gives the
  // weekday of the 1st; new Date(y, m, 0).getDate() gives the day count — both
  // are layout-only, no day keys are derived from Date objects.
  const firstDow = new Date(view.y, view.m - 1, 1).getDay();
  const daysInMonth = new Date(view.y, view.m, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const isCurrentOrFutureMonth =
    view.y > today.y || (view.y === today.y && view.m >= today.m);

  const goPrev = () =>
    setView((v) => (v.m === 1 ? { y: v.y - 1, m: 12 } : { y: v.y, m: v.m - 1 }));
  const goNext = () =>
    setView((v) => (v.m === 12 ? { y: v.y + 1, m: 1 } : { y: v.y, m: v.m + 1 }));

  return (
    <div className="bg-white border border-green-200 rounded-2xl p-6">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-base font-semibold text-green-700">Your Consistency</h2>
      </div>

      {/* Summary stats (anchored to today) */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <StatTile label="Current streak" value={`${streak}`} sub={streak === 1 ? "day" : "days"} />
        <StatTile label="Active this month" value={`${activeThisMonth}`} sub={activeThisMonth === 1 ? "day" : "days"} />
        <StatTile label="Total sessions" value={`${totalSessions}`} sub={totalSessions === 1 ? "session" : "sessions"} />
      </div>

      {/* Month navigation */}
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={goPrev}
          aria-label="Previous month"
          className="w-8 h-8 flex items-center justify-center rounded-lg border border-green-200 text-green-700 hover:bg-green-50 transition"
        >
          ‹
        </button>
        <span className="text-sm font-semibold text-green-800">
          {MONTH_NAMES[view.m - 1]} {view.y}
        </span>
        <button
          onClick={goNext}
          disabled={isCurrentOrFutureMonth}
          aria-label="Next month"
          className={`w-8 h-8 flex items-center justify-center rounded-lg border transition ${
            isCurrentOrFutureMonth
              ? "border-gray-100 text-gray-300 cursor-not-allowed"
              : "border-green-200 text-green-700 hover:bg-green-50"
          }`}
        >
          ›
        </button>
      </div>

      {/* Day-of-week header */}
      <div className="grid grid-cols-7 gap-1 mb-1">
        {DOW.map((d) => (
          <div key={d} className="text-center text-[11px] font-medium text-gray-400 py-1">
            {d}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, i) => {
          if (day === null) return <div key={`blank-${i}`} />;
          const key = makeKey(view.y, view.m, day);
          const sessionCount = counts.get(key) ?? 0;
          const dueList = occByDay.get(key) ?? [];
          const state = rollupDay(dueList, key, todayKey);
          const isToday = key === todayKey;
          const isFuture = key > todayKey;
          return (
            <div
              key={key}
              title={dayTitle(key, state, dueList, sessionCount)}
              className={`aspect-square rounded-lg flex flex-col items-center justify-center text-xs relative ${cellClasses(
                state,
                isFuture
              )} ${isToday ? "ring-2 ring-green-700 ring-offset-1" : ""}`}
            >
              <span>{day}</span>
              {state === "complete" && (
                <span className="text-[9px] leading-none -mt-0.5">
                  {sessionCount > 1 ? `×${sessionCount}` : "✓"}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="mt-4 grid grid-cols-2 gap-y-1.5 gap-x-3 text-[11px] text-gray-500">
        <LegendDot className="bg-green-600" label="Completed all due" />
        <LegendDot className="bg-amber-400" label="Partly done" />
        <LegendDot className="bg-white border border-amber-400" label="Make-up available" />
        <LegendDot className="bg-red-500" label="Missed" />
        <LegendDot className="bg-white border border-green-400" label="Due / upcoming" />
        <LegendDot className="bg-gray-100" label="Rest day" />
      </div>
      {occurrences.length === 0 && totalSessions === 0 && (
        <p className="mt-2 text-[11px] text-gray-400">No schedule or routines logged yet</p>
      )}
    </div>
  );
}

// Tooltip text describing a day's adherence and any sessions logged.
function dayTitle(
  key: string,
  state: DayState,
  dueList: OccurrenceLite[],
  sessionCount: number
): string {
  const done = dueList.filter((o) => o.status === "completed").length;
  const sess = sessionCount > 0 ? ` · ${sessionCount} session${sessionCount === 1 ? "" : "s"}` : "";
  switch (state) {
    case "complete":
      return `${key}: completed ${done}/${dueList.length} due${sess}`;
    case "partial":
      return `${key}: ${done}/${dueList.length} due done${sess}`;
    case "overdue":
      return `${key}: ${dueList.length} due — make-up still open${sess}`;
    case "missed":
      return `${key}: missed ${dueList.length} due`;
    case "due":
      return `${key}: ${dueList.length} due`;
    default:
      return sessionCount > 0 ? `${key}${sess}` : key;
  }
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-block w-3 h-3 rounded ${className}`} />
      {label}
    </span>
  );
}

function StatTile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-green-50 border border-green-100 rounded-xl px-3 py-3 text-center">
      <p className="text-2xl font-bold text-green-700 leading-none">{value}</p>
      <p className="text-[11px] text-green-700/70 mt-1">{sub}</p>
      <p className="text-[11px] text-gray-500 mt-0.5">{label}</p>
    </div>
  );
}
