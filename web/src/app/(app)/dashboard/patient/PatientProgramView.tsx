"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { prescriptionTargetText } from "@/lib/exercises/prescriptionDisplay";
import { rollupDay, type OccurrenceStatus } from "@/lib/exercises/occurrences";
import {
  formatDuration,
  isOutcomeBearingSession,
  type ScheduleSessionRecord,
} from "@/lib/exercises/scheduleSessionSummary";
import { prescribedOutcomeSides, sideLabel } from "@/lib/sessionOutcomePresentation";
import { FIT_SCREEN, Glyph, Panel, StatTile } from "../_components/DashboardKit";

export interface ProgramOccurrence {
  id: number;
  due_date: string;
  makeup_until: string;
  status: OccurrenceStatus;
  exercise_id: string;
  name: string;
  sets: number;
  reps: number;
  hold_seconds: number;
  monitoring_mode: "camera" | "manual";
}

type DayState = "done" | "today" | "makeup" | "pain" | "partial" | "missed" | "upcoming";

const DAY_MS = 86_400_000;

function dayNumber(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

function dayLabel(key: string): { weekday: string; date: string } {
  const [y, m, d] = key.split("-").map(Number);
  const at = new Date(Date.UTC(y, m - 1, d));
  return {
    weekday: at.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }),
    date: at.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
  };
}

/** "Fri, Jul 31" for a YYYY-MM-DD day. */
function shortDayLabel(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** The Manila day (YYYY-MM-DD) of a timestamp, the calendar the schedule uses. */
function manilaDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
}

/**
 * A day's row state. Past days follow the calendar's own day rules
 * (`rollupDay`), so a day stopped for pain or partly done is never called
 * missed; an exercise that can still be made up comes first.
 */
export function dayState(day: string, items: ProgramOccurrence[], today: string): DayState {
  const rollup = rollupDay(
    items.map((o) => ({ dueDate: o.due_date, makeupUntil: o.makeup_until, status: o.status })),
    day,
    today,
  );
  if (rollup === "complete") return "done";
  if (day === today) return "today";
  if (day > today) return "upcoming";
  if (items.some((o) => o.status !== "completed" && o.status !== "pain_stopped" && o.makeup_until >= today)) {
    return "makeup";
  }
  if (rollup === "pain_stopped") return "pain";
  if (rollup === "partial") return "partial";
  return "missed";
}

/** One exercise's pill when it cannot be started: its own state, not its day's. */
export function itemStatusLabel(o: ProgramOccurrence, day: string, today: string): string {
  if (o.status === "pain_stopped") return "Stopped for pain";
  if (day > today) return "Upcoming";
  if (day === today) return "Today";
  return o.makeup_until >= today ? "Make-up open" : "Missed";
}

const STATE_STYLE: Record<DayState, { bar: string; label: string }> = {
  done: { bar: "border-l-green-500", label: "Completed" },
  today: { bar: "border-l-green-700", label: "Today" },
  makeup: { bar: "border-l-amber-400", label: "Make-up open" },
  pain: { bar: "border-l-orange-400", label: "Stopped for pain" },
  partial: { bar: "border-l-amber-400", label: "Partly done" },
  missed: { bar: "border-l-red-400", label: "Missed" },
  upcoming: { bar: "border-l-green-200", label: "Upcoming" },
};

function StateIcon({ state }: { state: DayState }) {
  if (state === "done") {
    return (
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-green-500 text-white">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg>
      </span>
    );
  }
  if (state === "missed") {
    return (
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-red-100 text-red-600">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
      </span>
    );
  }
  if (state === "pain") {
    return (
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-orange-100 text-orange-600">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
      </span>
    );
  }
  if (state === "partial") {
    return (
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-amber-100 text-amber-600">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg>
      </span>
    );
  }
  if (state === "today" || state === "makeup") {
    return (
      <span className="h-9 w-9 shrink-0 rounded-full border-[5px] border-green-200 border-t-green-600" aria-hidden />
    );
  }
  return <span className="h-9 w-9 shrink-0 rounded-full border-[3px] border-green-100" aria-hidden />;
}

/** A session the dashboard can summarise: the schedule record and its exercise's name. */
export type LastSessionRecord = ScheduleSessionRecord & { exerciseName: string };

export interface LastSessionSummary {
  exerciseName: string;
  /** "Both sides", "Left side" or "Right side". */
  sideText: string;
  /** The session's Manila day, YYYY-MM-DD. */
  day: string;
  sets: number;
  /** Repetitions per prescribed side; one "Total" column for older rows kept without sides. */
  reps: Array<{ label: string; counted: number; fullRange: number }> | null;
  /** Time held per prescribed side, for a hold exercise. */
  holds: Array<{ label: string; heldMs: number }> | null;
  targetHoldMs: number | null;
}

/**
 * The Last Session card: the newest session with a result (sets, repetitions or
 * hold time, as the Session tab counts it), in counts only. Per prescribed side:
 * the repetitions the camera counted and how many reached the exercise's
 * full-range line, or the time held. No angle values: those are camera
 * estimates, shown with the trend model's band on My Progress. The sides stay
 * apart, as everywhere else.
 */
export function lastSessionSummary(sessions: LastSessionRecord[]): LastSessionSummary | null {
  let newest: LastSessionRecord | null = null;
  for (const session of sessions) {
    if (!isOutcomeBearingSession(session)) continue;
    const order = newest ? Date.parse(session.startedAt) - Date.parse(newest.startedAt) : 1;
    if (!newest || order > 0 || (order === 0 && session.id > newest.id)) newest = session;
  }
  if (!newest) return null;
  const last = newest;

  const sides = prescribedOutcomeSides(last.prescribedSide);
  const base = {
    exerciseName: last.exerciseName,
    sideText: last.prescribedSide === "both" ? "Both sides" : `${sideLabel(last.prescribedSide)} side`,
    day: manilaDay(last.startedAt),
    sets: last.setCount,
  };
  const holdMs = {
    left: last.totalLeftHoldMs ?? last.totalPairedHoldMs ?? 0,
    right: last.totalRightHoldMs ?? last.totalPairedHoldMs ?? 0,
  };
  const isHold =
    last.exerciseKind === "isometric" ||
    (last.totalReps === 0 && sides.some((side) => holdMs[side] > 0));
  if (isHold) {
    return {
      ...base,
      reps: null,
      holds: sides.map((side) => ({ label: sideLabel(side), heldMs: holdMs[side] })),
      targetHoldMs: last.totalTargetHoldMs,
    };
  }

  const bySide = sides.map((side) => ({
    label: sideLabel(side),
    counted: side === "left" ? last.leftReps : last.rightReps,
    fullRange: side === "left" ? last.completeLeftReps : last.completeRightReps,
  }));
  // A row has side counts when either side counted repetitions, the
  // unprescribed side included: that side is observation evidence, never the
  // treated side's result, so the treated side keeps its own count, even 0.
  // Only an older row with no side counts at all falls back to one total.
  const hasSideCounts = last.leftReps + last.rightReps > 0 || last.totalReps === 0;
  return {
    ...base,
    reps: hasSideCounts ? bySide : [{ label: "Total", counted: last.totalReps, fullRange: last.completeReps }],
    holds: null,
    targetHoldMs: null,
  };
}

function LastSessionCard({
  summary,
  today,
  onShowProgress,
}: {
  summary: LastSessionSummary | null;
  today: string;
  onShowProgress?: () => void;
}) {
  if (!summary) {
    return <p className="py-4 text-center text-xs text-gray-500">Finish a session to see it here.</p>;
  }
  return (
    <div className="flex h-full flex-col">
      <p className="truncate text-sm font-semibold text-gray-900">{summary.exerciseName}</p>
      <p className="text-xs text-gray-500">
        {`${summary.sideText} · ${summary.day === today ? "Today" : shortDayLabel(summary.day)} · ${summary.sets} set${summary.sets === 1 ? "" : "s"}`}
      </p>
      <table className="mt-1.5 w-full text-xs">
        {summary.reps ? (
          <>
            <thead>
              <tr className="text-gray-500">
                <th scope="col" className="py-0.5 text-left font-normal">Repetitions</th>
                {summary.reps.map((row) => (
                  <th key={row.label} scope="col" className="py-0.5 text-right font-medium">{row.label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="border-t border-green-50">
              <tr>
                <th scope="row" className="py-0.5 text-left font-normal text-gray-600">Counted</th>
                {summary.reps.map((row) => (
                  <td key={row.label} className="py-0.5 text-right font-semibold text-gray-900">{row.counted}</td>
                ))}
              </tr>
              <tr>
                <th scope="row" className="py-0.5 text-left font-normal text-gray-600">Full range</th>
                {summary.reps.map((row) => (
                  <td key={row.label} className="py-0.5 text-right font-semibold text-gray-900">{row.fullRange}</td>
                ))}
              </tr>
            </tbody>
          </>
        ) : (
          <tbody>
            {(summary.holds ?? []).map((row) => (
              <tr key={row.label}>
                <th scope="row" className="py-0.5 text-left font-normal text-gray-600">{row.label} held</th>
                <td className="py-0.5 text-right font-semibold text-gray-900">
                  {formatDuration(row.heldMs)}
                  {summary.targetHoldMs ? (
                    <span className="font-normal text-gray-500"> of {formatDuration(summary.targetHoldMs)}</span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        )}
      </table>
      {onShowProgress && (
        <button
          type="button"
          onClick={onShowProgress}
          className="mt-auto pt-1.5 text-left text-xs font-medium text-green-700 transition hover:text-green-900"
        >
          Open My Progress →
        </button>
      )}
    </div>
  );
}

export default function PatientProgramView<T extends ProgramOccurrence>({
  patientName,
  occurrences,
  sessions,
  today,
  tagFor,
  isActionable,
  calendar,
  onShowProgress,
}: {
  patientName: string;
  occurrences: T[];
  sessions: LastSessionRecord[];
  today: string;
  tagFor: (occurrence: T) => { label: string; classes: string };
  isActionable: (occurrence: T) => boolean;
  calendar: ReactNode;
  /** Opens My Progress, from the Last Session card. */
  onShowProgress?: () => void;
}) {
  const [openDay, setOpenDay] = useState<string | null>(today);
  const [showAll, setShowAll] = useState(false);

  const byDay = new Map<string, T[]>();
  for (const occurrence of occurrences) {
    byDay.set(occurrence.due_date, [...(byDay.get(occurrence.due_date) ?? []), occurrence]);
  }
  const days = [...byDay.keys()].sort();

  const total = occurrences.length;
  const done = occurrences.filter((o) => o.status === "completed").length;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);

  const first = days[0];
  const last = days[days.length - 1];
  const totalWeeks = first && last ? Math.floor((dayNumber(last) - dayNumber(first)) / 7) + 1 : 0;
  const week = first
    ? Math.min(Math.max(Math.floor((dayNumber(today) - dayNumber(first)) / 7) + 1, 1), totalWeeks)
    : 0;
  // After the last scheduled day the schedule has ended, as the Session tab says.
  const ended = Boolean(last) && today > last;

  const windowStart = dayNumber(today) - 3;
  const windowEnd = dayNumber(today) + 7;
  const inWindow = days.filter((d) => dayNumber(d) >= windowStart && dayNumber(d) <= windowEnd);
  const visibleDays = showAll || inWindow.length === 0 ? days : inWindow;

  const lastSession = lastSessionSummary(sessions);

  const upcoming = days.find((d) => d > today);
  const reminders: string[] = [];
  const todayItems = byDay.get(today)?.filter((o) => isActionable(o)) ?? [];
  if (todayItems.length > 0) {
    reminders.push(`${todayItems.length} exercise${todayItems.length === 1 ? "" : "s"} left for today.`);
  }
  const makeups = occurrences.filter((o) => o.due_date < today && isActionable(o));
  if (makeups.length > 0) {
    reminders.push(`${makeups.length} make-up exercise${makeups.length === 1 ? " is" : "s are"} still open.`);
  }
  if (upcoming) {
    const label = dayLabel(upcoming);
    reminders.push(`Next scheduled day: ${label.weekday}, ${label.date}.`);
  }
  reminders.push("Stop and tell your therapist if an exercise causes pain.");

  const todayAll = byDay.get(today) ?? [];
  const todayDone = todayAll.filter((o) => o.status === "completed").length;
  const missedCount = occurrences.filter((o) => o.status !== "completed" && o.status !== "pain_stopped" && o.makeup_until < today).length;
  const nextDay = upcoming ?? null;

  return (
    <div className={FIT_SCREEN}>
      <div id="tour-tiles" className="grid shrink-0 grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Program completed" value={percent} unit="%" icon={Glyph.check} tone="green" />
        <StatTile label="Today" value={todayAll.length === 0 ? "Rest" : `${todayDone}/${todayAll.length}`} unit={todayAll.length === 0 ? "" : "done"} icon={Glyph.dumbbell} tone="teal" />
        <StatTile
          label="Next scheduled day"
          value={nextDay ? dayLabel(nextDay).date : "None"}
          icon={Glyph.calendar}
          tone="lime"
        />
        <StatTile label="Missed" value={missedCount} unit={missedCount === 1 ? "exercise" : "exercises"} icon={Glyph.alert} tone={missedCount > 0 ? "amber" : "green"} />
      </div>

      {/* grid-cols-1 is minmax(0, 1fr): on a phone the day rows truncate instead of widening the page. */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-12">
        <Panel
          id="tour-program"
          className="lg:col-span-7"
          title={`${patientName}\u2019s Exercise Program`}
          scroll
        >
          {first ? (
            <p className="mb-3 text-sm text-gray-600">
              {ended ? `Schedule ended ${dayLabel(last).weekday}, ${dayLabel(last).date}` : `Week ${week}/${totalWeeks}`}
              <span className="mx-2 text-gray-300">|</span>
              {ended ? "Began" : "Beginning"} {dayLabel(first).weekday}, {dayLabel(first).date}
            </p>
          ) : (
            <p className="mb-3 text-sm text-gray-500">Your therapist has not scheduled any exercises yet.</p>
          )}

          <div className="space-y-2">
            {visibleDays.map((day) => {
              const items = byDay.get(day) ?? [];
              const state = dayState(day, items, today);
              const label = dayLabel(day);
              const isOpen = openDay === day;
              return (
                <div key={day} className={`overflow-hidden rounded-lg border border-green-50 border-l-4 bg-[#fafcfa] ${STATE_STYLE[state].bar}`}>
                  <button
                    type="button"
                    onClick={() => setOpenDay(isOpen ? null : day)}
                    aria-expanded={isOpen}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left"
                  >
                    <StateIcon state={state} />
                    <div className="w-28 shrink-0">
                      <p className="text-sm font-semibold text-gray-900">{state === "today" ? "Today" : label.weekday}</p>
                      <p className="text-xs text-gray-500">{label.date}</p>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-gray-700">
                        {items.length} exercise{items.length === 1 ? "" : "s"}
                      </p>
                      <p className="truncate text-xs text-gray-500">{items.map((o) => o.name).join(" · ")}</p>
                    </div>
                    <span className="hidden text-xs font-medium text-gray-500 sm:inline">{STATE_STYLE[state].label}</span>
                    <svg viewBox="0 0 24 24" className={`h-5 w-5 shrink-0 text-green-600 transition ${isOpen ? "rotate-90" : ""}`} fill="currentColor">
                      <path d="M8.59 16.59 13.17 12 8.59 7.41 10 6l6 6-6 6z" />
                    </svg>
                  </button>
                  {isOpen && (
                    <ul className="divide-y divide-green-50 border-t border-green-50 bg-white">
                      {items.map((o) => {
                        const actionable = isActionable(o);
                        const tag = tagFor(o);
                        return (
                          <li key={o.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm font-semibold text-green-800">{o.name}</p>
                                {o.monitoring_mode === "manual" && (
                                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                                    Manual · no Machine Learning
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-gray-500">
                                {o.sets} sets × {prescriptionTargetText({ exerciseId: o.exercise_id, reps: o.reps, holdSeconds: o.hold_seconds })}
                              </p>
                            </div>
                            {o.status === "completed" ? (
                              <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700">Completed</span>
                            ) : actionable ? (
                              <>
                                <span className={`rounded-full px-3 py-1 text-xs font-medium ${tag.classes}`}>{tag.label}</span>
                                {/* A custom exercise opens the camera page too, for its guide video and guided sets. */}
                                <Link
                                  href={`/camera?occurrenceId=${o.id}&exerciseId=${encodeURIComponent(o.exercise_id)}`}
                                  className="rounded-lg bg-green-700 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-green-800"
                                >
                                  Start
                                </Link>
                              </>
                            ) : (
                              <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-500">
                                {itemStatusLabel(o, day, today)}
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}

            {inWindow.length > 0 && days.length > inWindow.length && (
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                className="w-full rounded-lg border border-dashed border-green-300 py-2 text-sm font-medium text-green-800 transition hover:bg-green-50"
              >
                {showAll ? "Show nearby days only" : `Show the full schedule (${days.length} days)`}
              </button>
            )}
          </div>
        </Panel>

        <div className="grid min-h-0 gap-4 lg:col-span-5 lg:grid-rows-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <div id="tour-calendar" className="min-h-0">{calendar}</div>
          <div className="grid min-h-0 grid-cols-2 gap-4">
            <Panel id="tour-last-session" title="Last Session" scroll>
              <LastSessionCard summary={lastSession} today={today} onShowProgress={onShowProgress} />
            </Panel>
            <Panel id="tour-reminders" title="Reminders" scroll>
              <ul className="space-y-1.5">
                {reminders.map((text) => (
                  <li key={text} className="flex gap-2 text-xs text-gray-700">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-green-500" />
                    {text}
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        </div>
      </div>
    </div>
  );
}
