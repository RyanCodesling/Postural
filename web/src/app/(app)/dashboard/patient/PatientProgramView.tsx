"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { prescriptionTargetText } from "@/lib/exercises/prescriptionDisplay";
import type { OccurrenceStatus } from "@/lib/exercises/occurrences";
import { sessionPrimaryValue, type TrendSession } from "../_components/ExerciseTrends";
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

type DayState = "done" | "today" | "makeup" | "missed" | "upcoming";

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

function dayState(day: string, items: ProgramOccurrence[], today: string): DayState {
  if (items.every((o) => o.status === "completed")) return "done";
  if (day === today) return "today";
  if (day > today) return "upcoming";
  return items.some((o) => o.status !== "completed" && o.status !== "pain_stopped" && o.makeup_until >= today)
    ? "makeup"
    : "missed";
}

const STATE_STYLE: Record<DayState, { bar: string; label: string }> = {
  done: { bar: "border-l-green-500", label: "Completed" },
  today: { bar: "border-l-green-700", label: "Today" },
  makeup: { bar: "border-l-amber-400", label: "Make-up open" },
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
  if (state === "today" || state === "makeup") {
    return (
      <span className="h-9 w-9 shrink-0 rounded-full border-[5px] border-green-200 border-t-green-600" aria-hidden />
    );
  }
  return <span className="h-9 w-9 shrink-0 rounded-full border-[3px] border-green-100" aria-hidden />;
}

function ProgressRing({ percent }: { percent: number }) {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="relative h-20 w-20 shrink-0">
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx="50" cy="50" r={radius} fill="none" stroke="#dcfce7" strokeWidth="7" />
        <circle
          cx="50" cy="50" r={radius} fill="none" stroke="#16a34a" strokeWidth="7" strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - percent / 100)}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <p className="text-lg font-bold leading-none text-gray-900">{percent}%</p>
        </div>
      </div>
    </div>
  );
}

/** Half-circle gauge on a 0–180 scale: the needle is the latest value, the fill the best so far. */
function Gauge({ latest, first, best }: { latest: number; first: number; best: number }) {
  const point = (value: number, r: number) => {
    const angle = Math.PI * (1 - Math.min(Math.max(value, 0), 180) / 180);
    return { x: 100 + r * Math.cos(angle), y: 100 - r * Math.sin(angle) };
  };
  const arc = (from: number, to: number, r: number) => {
    const a = point(from, r);
    const b = point(to, r);
    return `M ${a.x} ${a.y} A ${r} ${r} 0 0 1 ${b.x} ${b.y}`;
  };
  const needle = point(latest, 70);
  const firstMark = point(first, 80);
  return (
    <svg viewBox="0 0 200 118" className="w-full">
      <path d={arc(0, 180, 78)} fill="none" stroke="#e5efe7" strokeWidth="14" strokeLinecap="round" />
      <path d={arc(0, Math.max(best, 1), 78)} fill="none" stroke="#86efac" strokeWidth="14" strokeLinecap="round" />
      <path d={arc(0, Math.max(latest, 1), 78)} fill="none" stroke="#16a34a" strokeWidth="14" strokeLinecap="round" />
      <circle cx={firstMark.x} cy={firstMark.y} r="3" fill="#15803d" />
      <line x1="100" y1="100" x2={needle.x} y2={needle.y} stroke="#14532d" strokeWidth="2" strokeDasharray="3 3" />
      <circle cx="100" cy="100" r="5" fill="#fff" stroke="#14532d" strokeWidth="2" />
      <text x="14" y="116" fontSize="9" fill="#6b7280">0</text>
      <text x="178" y="116" fontSize="9" fill="#6b7280">180</text>
    </svg>
  );
}

export default function PatientProgramView<T extends ProgramOccurrence>({
  patientName,
  occurrences,
  sessions,
  today,
  tagFor,
  isActionable,
  onStart,
  calendar,
}: {
  patientName: string;
  occurrences: T[];
  sessions: TrendSession[];
  today: string;
  tagFor: (occurrence: T) => { label: string; classes: string };
  isActionable: (occurrence: T) => boolean;
  onStart: (occurrence: T) => void;
  calendar: ReactNode;
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

  const windowStart = dayNumber(today) - 3;
  const windowEnd = dayNumber(today) + 7;
  const inWindow = days.filter((d) => dayNumber(d) >= windowStart && dayNumber(d) <= windowEnd);
  const visibleDays = showAll || inWindow.length === 0 ? days : inWindow;

  // Gauge: the latest rep-counted session of a degree-measured exercise, against
  // the first and best sessions of that same exercise. Values are camera estimates.
  const rom = sessions
    .filter((s) => s.exerciseKind === "dynamic" && s.exerciseId !== "ex_007" && sessionPrimaryValue(s) != null)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const latestSession = rom[rom.length - 1];
  const sameExercise = latestSession ? rom.filter((s) => s.exerciseId === latestSession.exerciseId) : [];
  const values = sameExercise.map((s) => sessionPrimaryValue(s) as number);

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
      <div className="grid shrink-0 grid-cols-2 gap-3 lg:grid-cols-4">
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

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-12">
        <Panel
          className="lg:col-span-7"
          title={`${patientName}\u2019s Exercise Program`}
          right={<ProgressRing percent={percent} />}
          scroll
        >
          {first ? (
            <p className="mb-3 text-sm text-gray-600">
              Week {week}/{totalWeeks}
              <span className="mx-2 text-gray-300">|</span>
              Beginning {dayLabel(first).weekday}, {dayLabel(first).date}
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
                              <p className="text-sm font-semibold text-green-800">{o.name}</p>
                              <p className="text-xs text-gray-500">
                                {o.sets} sets × {prescriptionTargetText({ exerciseId: o.exercise_id, reps: o.reps, holdSeconds: o.hold_seconds })}
                              </p>
                            </div>
                            {o.status === "completed" ? (
                              <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700">Completed</span>
                            ) : actionable ? (
                              <>
                                <span className={`rounded-full px-3 py-1 text-xs font-medium ${tag.classes}`}>{tag.label}</span>
                                {o.monitoring_mode === "camera" ? (
                                  <Link
                                    href={`/camera?occurrenceId=${o.id}&exerciseId=${encodeURIComponent(o.exercise_id)}`}
                                    className="rounded-lg bg-green-700 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-green-800"
                                  >
                                    Start
                                  </Link>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => onStart(o)}
                                    className="rounded-lg border border-green-300 px-4 py-1.5 text-sm font-medium text-green-800 transition hover:bg-green-50"
                                  >
                                    Mark done
                                  </button>
                                )}
                              </>
                            ) : (
                              <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-500">
                                {o.status === "pain_stopped" ? "Paused for pain" : STATE_STYLE[state].label}
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
          <div className="min-h-0">{calendar}</div>
          <div className="grid min-h-0 grid-cols-2 gap-4">
            <Panel title="Range of Motion" scroll>
              {latestSession && values.length > 0 ? (
                <div className="flex h-full flex-col justify-between">
                  <Gauge latest={values[values.length - 1]} first={values[0]} best={Math.max(...values)} />
                  <div className="text-center leading-tight">
                    <p className="truncate text-xs font-semibold text-gray-900">{latestSession.exerciseName}</p>
                    <p className="text-[11px] text-gray-500">
                      Latest <strong className="text-green-700">{Math.round(values[values.length - 1])}</strong> · Best{" "}
                      <strong className="text-gray-900">{Math.round(Math.max(...values))}</strong> · First{" "}
                      <strong className="text-gray-900">{Math.round(values[0])}</strong>
                    </p>
                    <p className="text-[10px] text-gray-400">Camera estimates.</p>
                  </div>
                </div>
              ) : (
                <p className="py-4 text-center text-xs text-gray-500">Finish a session to see your range of motion here.</p>
              )}
            </Panel>
            <Panel title="Reminders" scroll>
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
