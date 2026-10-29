"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { useDemoClock } from "@/lib/DemoClockContext";
import AppShell from "../_components/AppShell";
import { PATIENT_TOURS } from "../_components/tours";
import ProfileLayout, { ProfileField } from "../_components/ProfileLayout";
import { FIT_SCREEN, Glyph, PageHeading, Panel, StatTile } from "../_components/DashboardKit";
import {
  prescriptionMetricLabel,
  prescriptionMetricValue,
  prescriptionTargetText,
} from "@/lib/exercises/prescriptionDisplay";
import {
  dayCountsText,
  type OccurrenceCounts,
  type PrescriptionState,
} from "@/lib/exercises/prescriptionStatus";
import ConsistencyCalendar from "./ConsistencyCalendar";
import PatientProgramView from "./PatientProgramView";
import { groupSessionsByExercise, ExerciseTrendCard } from "../_components/ExerciseTrends";
import { SkeletonBar, SkeletonCard } from "../_components/Skeleton";
import ReportButton from "../_components/ReportButton";
import SessionVideo from "../_components/SessionVideo";
import CustomExerciseVideo from "../_components/CustomExerciseVideo";
import { exerciseVideoFromRow } from "@/lib/exercises/customVideo";
import ChangePasswordModal from "../_components/ChangePasswordModal";
import { NEW_NOTIFICATIONS_EVENT } from "../_components/NotificationBell";
import {
  classifyScheduleOccurrence,
  isOccurrenceActionable,
  type OccurrenceStatus,
} from "@/lib/exercises/occurrences";
import {
  completedSessionDoseText,
  groupSessionsByOccurrence,
  selectCompletedOccurrenceResult,
  type CompletedOccurrenceResult,
  type ScheduleSessionRecord,
} from "@/lib/exercises/scheduleSessionSummary";
import type {
  PainReportStatus,
  PainTiming,
  PrescribedSide,
  ResistanceContext,
  SessionContextSnapshot,
} from "@/lib/prescriptionContext";

interface PatientProfile {
  id: string;
  name: string;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  email: string;
  dateOfBirth: string | null;
  age: number | null;
  gender: string | null;
  diagnosis: string | null;
  prescription: string | null;
  condition: string | null;
  therapistId: string | null;
  therapistName: string | null;
  createdAt: string | null;
}

interface AssignedExercise {
  exercise_id: string;
  name: string;
  description: string;
  prescription_state: PrescriptionState;
  occurrence_summary: OccurrenceCounts;
  sets: number;
  reps: number;
  rest_seconds: number;
  hold_seconds: number;
  assigned_date: string;
}

// Lifecycle only, worded as on the therapist's PT Program tab; how the days
// went is the dayCountsText line under the exercise.
const PRESCRIPTION_PILLS: Record<PrescriptionState, { label: string; classes: string }> = {
  upcoming: { label: "Upcoming", classes: "bg-sky-100 text-sky-700" },
  active: { label: "Active", classes: "bg-teal-100 text-teal-700" },
  ended: { label: "Ended", classes: "bg-gray-100 text-gray-700" },
  archived: { label: "Ended early", classes: "bg-gray-100 text-gray-700" },
};

// One scheduled day for an assigned exercise (a row of exercise_occurrences
// joined to its prescription). Drives the Session schedule tab and the calendar.
interface PatientOccurrence {
  id: number;
  patient_exercise_id: number;
  due_date: string;
  makeup_until: string;
  status: OccurrenceStatus;
  exercise_id: string;
  name: string;
  sets: number;
  reps: number;
  rest_seconds: number;
  hold_seconds: number;
  sequence_index: number;
  monitoring_mode: "camera" | "manual";
  video_mime_type?: string | null;
  youtube_video_id?: string | null;
}

// Per-session summary from /api/sessions. Carries the fields the calendar, the
// exercise tags, and the My Progress trend charts all need (this shape
// structurally satisfies the shared TrendSession type).
interface SessionLite extends ScheduleSessionRecord {
  exerciseId: string;
  exerciseName: string;
  avgPeakValue: number | null;
  prescribedSide: PrescribedSide;
  resistance: ResistanceContext;
  comparableContextKey: string;
  exerciseConfigVersion: string | null;
  // Read by the progress report.
  context: SessionContextSnapshot | null;
  hasRecording?: boolean;
  painReport: {
    status: PainReportStatus;
    score: number | null;
    timing: PainTiming | null;
    bodyArea: string | null;
  };
}

type ActiveTab = "dashboard" | "my-progress" | "view-profile" | "session";

/** The patient's recorded sessions, newest first, each opening its player. */
function SessionVideoList({
  sessions,
  onDeleted,
}: {
  sessions: SessionLite[];
  onDeleted: (sessionId: number) => void;
}) {
  const [openId, setOpenId] = useState<number | null>(null);
  if (sessions.length === 0) return null;
  return (
    <div className="mt-8">
      <h2 className="text-lg font-semibold text-green-800">Session videos</h2>
      <p className="text-xs text-gray-500 mt-1 mb-3">
        In the app, only you and your therapist can watch these. They are kept on the project&apos;s server, and you can delete them.
      </p>
      <div className="space-y-2">
        {sessions.map((s) => (
          <div key={s.id} className="bg-white border border-green-100 rounded-xl p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm">
                <p className="font-medium text-gray-800">{s.exerciseName}</p>
                <p className="text-xs text-gray-500">
                  {new Date(s.startedAt).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpenId(openId === s.id ? null : s.id)}
                className="px-3 py-1.5 text-sm rounded-lg border border-green-700 text-green-700 hover:bg-green-50"
              >
                {openId === s.id ? "Hide" : "Watch"}
              </button>
            </div>
            {openId === s.id && (
              <div className="mt-3">
                <SessionVideo sessionId={s.id} onDeleted={() => onDeleted(s.id)} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function PatientDashboardPage() {
  const { user, loading, logout } = useAuth();
  const { todayKey } = useDemoClock();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [activeTab, setActiveTab] = useState<ActiveTab>("dashboard");
  const [pageLoading, setPageLoading] = useState(true);
  const [patientProfile, setPatientProfile] = useState<PatientProfile | null>(null);
  const [exercises, setExercises] = useState<AssignedExercise[]>([]);
  const [occurrences, setOccurrences] = useState<PatientOccurrence[]>([]);
  const [sessions, setSessions] = useState<SessionLite[]>([]);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [scheduleActionError, setScheduleActionError] = useState("");

  useEffect(() => {
    if (searchParams.get("tab") === "session") setActiveTab("session");
  }, [searchParams]);

  useEffect(() => {
    if (loading) return;
    if (user && user.role !== "patient") { router.push("/dashboard"); return; }
    setPageLoading(false);
  }, [user, loading, router]);

  const loadData = useCallback(async () => {
    if (!user?.id) return;
    try {
      const [profileRes, exercisesRes, sessionsRes] = await Promise.all([
        fetch(`/api/users/${user.id}`),
        fetch("/api/patient-exercises"),
        fetch("/api/sessions"),
      ]);

      if (profileRes.ok) {
        const d = await profileRes.json();
        setPatientProfile(d.user ?? null);
      }

      if (exercisesRes.ok) {
        const d = await exercisesRes.json();
        setExercises(d.exercises ?? []);
        setOccurrences(d.occurrences ?? []);
      }

      if (sessionsRes.ok) {
        const d = await sessionsRes.json();
        setSessions(d.sessions ?? []);
      }
    } catch (err) {
      console.error("Error loading patient data:", err);
    } finally {
      setPageLoading(false);
    }
  }, [user?.id]);

  // Every exercise starts on the camera page; a custom one runs a guided set-by-set
  // session there, whose last set marks the day complete.
  const handleOccurrenceStart = async (occurrence: PatientOccurrence) => {
    setScheduleActionError("");
    router.push(
      `/camera?occurrenceId=${occurrence.id}&exerciseId=${encodeURIComponent(occurrence.exercise_id)}`,
    );
  };

  useEffect(() => {
    if (!loading && user?.id) void loadData();
  }, [user?.id, loading, loadData]);

  // A therapist's change (assigned, edited or removed exercises) arrives as a
  // notification; reload then, and when the patient returns to this tab, so the
  // dashboard never needs a page reload to catch up.
  useEffect(() => {
    if (loading || !user?.id) return;
    const reload = () => void loadData();
    const reloadIfVisible = () => {
      if (document.visibilityState === "visible") reload();
    };
    window.addEventListener(NEW_NOTIFICATIONS_EVENT, reload);
    document.addEventListener("visibilitychange", reloadIfVisible);
    return () => {
      window.removeEventListener(NEW_NOTIFICATIONS_EVENT, reload);
      document.removeEventListener("visibilitychange", reloadIfVisible);
    };
  }, [user?.id, loading, loadData]);

  const NAV_TABS: { key: ActiveTab; label: string; Icon: () => React.ReactElement }[] = [
    { key: "dashboard",    label: "Dashboard",    Icon: PatHomeIcon     },
    { key: "my-progress",  label: "My Progress",  Icon: PatProgressIcon },
    { key: "view-profile", label: "View Profile", Icon: PatPersonIcon   },
  ];

  if (loading || pageLoading) {
    return (
      <div className="min-h-screen bg-green-50 p-6">
        <div className="max-w-5xl mx-auto">
          <SkeletonBar className="h-7 w-48" />
          <SkeletonBar className="h-4 w-64 mt-2 mb-6" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <SkeletonCard className="h-64" />
            <SkeletonCard className="h-64" />
          </div>
        </div>
      </div>
    );
  }

  // Most-recent session per exercise — used to decide the in_progress sub-label
  // (In Progress vs Ended Early) from the latest attempt only (see
  // exerciseStatusTag). Sessions arrive newest-first, but pick by startedAt
  // defensively in case ordering ever changes.
  const latestSessionByExercise = new Map<string, SessionLite>();
  for (const s of sessions) {
    const cur = latestSessionByExercise.get(s.exerciseId);
    if (!cur || s.startedAt > cur.startedAt) {
      latestSessionByExercise.set(s.exerciseId, s);
    }
  }
  const sessionsByOccurrenceId = groupSessionsByOccurrence(sessions);

  // Today's Manila day (YYYY-MM-DD), by the demo clock in demo mode.
  const today = todayKey;

  return (
    <AppShell
      items={[
        ...NAV_TABS.map(({ key, label, Icon }) => ({
          key,
          label,
          icon: <Icon />,
          active: activeTab === key,
          onSelect: () => setActiveTab(key),
        })),
        { key: "session", label: "Session", icon: <PatClockIcon />, active: activeTab === "session", onSelect: () => setActiveTab("session") },
        { key: "camera", label: "Camera", icon: <PatCameraIcon />, active: false, href: "/camera" },
      ]}
      userName={user?.name}
      roleLabel="Patient"
      tour={PATIENT_TOURS[activeTab]}
      onLogout={async () => { await logout(); router.push("/"); }}
    >
        {/* ── Dashboard ── */}
        {activeTab === "dashboard" && (
          <PatientProgramView
            patientName={patientProfile?.name ?? user?.name ?? "Your"}
            occurrences={occurrences}
            sessions={sessions}
            today={today}
            tagFor={(occurrence) =>
              dashboardOccurrenceStatusTag(
                occurrence,
                today,
                latestSessionByExercise.get(occurrence.exercise_id)?.endReason === "user",
              )
            }
            isActionable={(occurrence) =>
              isOccurrenceActionable(
                { dueDate: occurrence.due_date, makeupUntil: occurrence.makeup_until, status: occurrence.status },
                today,
              )
            }
            calendar={<ConsistencyCalendar sessions={sessions} occurrences={occurrences} compact />}
            onShowProgress={() => setActiveTab("my-progress")}
          />
        )}

        {/* ── My Progress ── */}
        {activeTab === "my-progress" && (() => {
          const trendGroups = groupSessionsByExercise(sessions);
          const recorded = sessions.filter((x) => x.setCount > 0 || x.totalReps > 0);
          const lastSession = recorded.reduce<string | null>((latest, x) => (!latest || x.startedAt > latest ? x.startedAt : latest), null);
          return (
            <div className="mx-auto flex max-w-6xl flex-col gap-4">
              <div id="tour-progress-header" className="flex flex-wrap items-start justify-between gap-3">
                <PageHeading title="My Progress" subtitle="Your session-over-session trends per exercise. Descriptive trends, not a diagnosis." />
                {trendGroups.length > 0 && (
                  <ReportButton
                    label="Download progress report (PDF)"
                    onDownload={async () => {
                      const { downloadProgressReport } = await import("../_components/progressReport");
                      await downloadProgressReport({}, patientProfile?.name ?? user?.name ?? "Patient");
                    }}
                    className="px-4 py-2 bg-green-700 text-white text-sm font-medium rounded-lg hover:bg-green-800 transition disabled:opacity-60"
                  />
                )}
              </div>

              <div id="tour-progress-tiles" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatTile label="Exercises tracked" value={trendGroups.length} icon={Glyph.dumbbell} tone="green" />
                <StatTile label="Sessions recorded" value={recorded.length} icon={Glyph.pulse} tone="teal" />
                <StatTile
                  label="Last session"
                  value={lastSession ? new Date(lastSession).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "Asia/Manila" }) : "None"}
                  icon={Glyph.calendar}
                  tone="lime"
                />
                <StatTile label="Saved videos" value={sessions.filter((x) => x.hasRecording).length} icon={Glyph.list} tone="green" />
              </div>

              {trendGroups.length === 0 ? (
                <div className="rounded-xl bg-white p-8 text-center text-sm text-gray-500 shadow-sm">
                  Finish a few sessions to see your progress here.
                </div>
              ) : (
                <div id="tour-progress-trends" className="grid items-start gap-4">
                  {trendGroups.map((g) => (
                    <ExerciseTrendCard key={g.contextKey} group={g} />
                  ))}
                </div>
              )}

              <SessionVideoList
                sessions={sessions.filter((x) => x.hasRecording)}
                onDeleted={(id) => setSessions((all) => all.map((x) => (x.id === id ? { ...x, hasRecording: false } : x)))}
              />
            </div>
          );
        })()}

        {/* ── Session ── */}
        {activeTab === "session" && (() => {
          const bucketFor = (occurrence: PatientOccurrence) =>
            classifyScheduleOccurrence(
              {
                dueDate: occurrence.due_date,
                makeupUntil: occurrence.makeup_until,
                status: occurrence.status,
              },
              today
            );
          const current = occurrences.filter((occurrence) => bucketFor(occurrence) === "current");
          const upcoming = occurrences.filter((occurrence) => bucketFor(occurrence) === "upcoming");
          const history = occurrences.filter((occurrence) => bucketFor(occurrence) === "history");
          const currentGroups = groupScheduleOccurrences(current, "asc");
          const upcomingGroups = groupScheduleOccurrences(upcoming, "asc");
          const historyGroups = groupScheduleOccurrences(history, "desc");
          const nextGroup = upcomingGroups[0] ?? null;
          const laterGroups = upcomingGroups.slice(1);
          const startableNow = current.filter((occurrence) =>
            isOccurrenceActionable(
              {
                dueDate: occurrence.due_date,
                makeupUntil: occurrence.makeup_until,
                status: occurrence.status,
              },
              today
            )
          );
          const dueToDate = occurrences.filter((o) => o.due_date <= today);
          const completedToDate = dueToDate.filter((o) => o.status === "completed").length;
          const completedHistory = history.filter((o) => o.status === "completed").length;
          const scheduleEndKey = occurrences.reduce<string | null>(
            (latest, occurrence) => !latest || occurrence.due_date > latest ? occurrence.due_date : latest,
            null
          );
          const scheduleHasEnded = scheduleEndKey !== null && scheduleEndKey < today;
          const laterCount = laterGroups.reduce((sum, group) => sum + group.items.length, 0);

          const startable = startableNow.length;
          return (
            <div className={FIT_SCREEN}>
              <PageHeading title="Session Schedule" subtitle="See what is due now, what comes next, and when the prescription ends." />

              {scheduleActionError && (
                <div className="shrink-0 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {scheduleActionError}
                </div>
              )}

              {occurrences.length === 0 ? (
                <div className="rounded-xl bg-white p-8 text-center text-sm text-gray-500 shadow-sm">
                  No exercises assigned yet. Your therapist will assign exercises to you.
                </div>
              ) : (
                <>
                  <div id="tour-session-tiles" className="grid shrink-0 grid-cols-1 gap-3 sm:grid-cols-3">
                    <StatTile
                      label="Today"
                      value={startable > 0 ? `${startable} ready` : current.length > 0 ? "All done" : "Nothing due"}
                      icon={Glyph.dumbbell}
                      tone="green"
                    />
                    <StatTile
                      label="Next session"
                      value={nextGroup ? nextGroup.label : "None scheduled"}
                      unit={nextGroup ? `${nextGroup.items.length} exercise${nextGroup.items.length === 1 ? "" : "s"}` : undefined}
                      icon={Glyph.calendar}
                      tone="teal"
                    />
                    <StatTile
                      label={scheduleHasEnded ? "Schedule ended" : "Schedule ends"}
                      value={scheduleEndKey ? formatScheduleDate(scheduleEndKey) : "No schedule"}
                      unit={dueToDate.length > 0 ? `${completedToDate}/${dueToDate.length} done` : undefined}
                      icon={Glyph.clock}
                      tone="lime"
                    />
                  </div>

                  <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-12">
                    <Panel
                      id="tour-session-current"
                      className="lg:col-span-7"
                      title="Today & available make-ups"
                      right={<span className="text-xs text-gray-500">{current.length} item{current.length === 1 ? "" : "s"}</span>}
                      scroll
                    >
                      {currentGroups.length > 0 ? (
                        <ScheduleDateGroups
                          groups={currentGroups}
                          today={today}
                          initiallyOpen
                          sessionsByOccurrenceId={sessionsByOccurrenceId}
                          onStart={handleOccurrenceStart}
                        />
                      ) : (
                        <div className="rounded-lg bg-green-50 px-5 py-6">
                          <p className="text-sm font-semibold text-gray-800">Nothing is due today.</p>
                          <p className="mt-1 text-xs text-gray-600">
                            {nextGroup
                              ? `Your next scheduled date is ${nextGroup.label}.`
                              : scheduleHasEnded
                                ? `This prescription ended on ${formatScheduleDate(scheduleEndKey)}.`
                                : "No future sessions have been assigned."}
                          </p>
                        </div>
                      )}
                    </Panel>

                    <Panel id="tour-session-upcoming" className="lg:col-span-5" title="Upcoming & past" scroll>
                      <div className="space-y-4">
                        {nextGroup && (
                          <section aria-labelledby="next-schedule-heading">
                            <h3 id="next-schedule-heading" className="mb-2 text-sm font-semibold text-green-800">
                              Next scheduled date
                            </h3>
                            <ScheduleDateGroups
                              groups={[nextGroup]}
                              today={today}
                              sessionsByOccurrenceId={sessionsByOccurrenceId}
                              onStart={handleOccurrenceStart}
                            />
                          </section>
                        )}

                        {laterGroups.length > 0 && (
                          <details className="overflow-hidden rounded-lg border border-green-100">
                            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-green-800 hover:bg-green-50">
                              Later schedule
                              <span className="ml-2 text-xs font-normal text-gray-500">
                                {laterCount} entries across {laterGroups.length} dates
                              </span>
                            </summary>
                            <div className="border-t border-green-100 p-4">
                              <ScheduleDateGroups
                                groups={laterGroups}
                                today={today}
                                sessionsByOccurrenceId={sessionsByOccurrenceId}
                                onStart={handleOccurrenceStart}
                              />
                            </div>
                          </details>
                        )}

                        {historyGroups.length > 0 && (
                          <details className="overflow-hidden rounded-lg border border-gray-100">
                            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-gray-800 hover:bg-gray-50">
                              Past schedule
                              <span className="ml-2 text-xs font-normal text-gray-500">
                                {history.length} entries across {historyGroups.length} dates · {completedHistory} completed
                              </span>
                            </summary>
                            <div className="border-t border-gray-100 p-4">
                              <ScheduleDateGroups
                                groups={historyGroups}
                                today={today}
                                sessionsByOccurrenceId={sessionsByOccurrenceId}
                                onStart={handleOccurrenceStart}
                              />
                            </div>
                          </details>
                        )}

                        {!nextGroup && laterGroups.length === 0 && historyGroups.length === 0 && (
                          <p className="py-6 text-center text-sm text-gray-400">Nothing else is scheduled.</p>
                        )}
                      </div>
                    </Panel>
                  </div>
                </>
              )}
            </div>
          );
        })()}

        {/* ── View Profile ── */}
        {activeTab === "view-profile" && (
          <ProfileLayout
            name={patientProfile?.name ?? user?.name}
            email={patientProfile?.email}
            roleLabel="Patient"
            onChangePassword={() => setShowChangePassword(true)}
            leftTitle="Personal Information"
            left={
              !patientProfile ? (
                <p className="text-sm text-gray-400">Unable to load profile. Please contact your therapist.</p>
              ) : (
                <div className="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2">
                  <ProfileField icon={<PersonIcon />} label="Full Name" value={patientProfile.name} />
                  <ProfileField icon={<PersonIcon />} label="Age" value={patientProfile.age != null ? `${patientProfile.age} years old` : null} />
                  <ProfileField icon={<EmailIcon />} label="Email" value={patientProfile.email} />
                  <ProfileField icon={<PulseIcon />} label="Assigned Specialist" value={patientProfile.therapistName} />
                </div>
              )
            }
            rightTitle="Account Information"
            right={
              <div className="space-y-5">
                <ProfileField label="Username" value={patientProfile?.email?.split("@")[0] ?? "—"} />
                <ProfileField label="Account Type" value="Patient" />
                <ProfileField label="Member Since" value={formatMemberSince(patientProfile?.createdAt ?? null)} />
              </div>
            }
            bottomTitle="Assigned Exercises"
            bottom={
              exercises.length === 0 ? (
                <div className="rounded-lg bg-green-50 p-4 text-sm text-green-900">
                  <p className="mb-1 font-semibold">No assigned exercises</p>
                  <p>You currently have no exercises assigned. Please contact your therapist.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {exercises.map((ex) => (
                    <div key={ex.exercise_id} className="flex items-center justify-between gap-4 rounded-lg border border-green-50 bg-[#fafcfa] px-4 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-green-800">{ex.name}</p>
                        <p className="mt-0.5 text-xs text-gray-500">
                          {ex.sets} sets ×{" "}
                          {prescriptionTargetText({ exerciseId: ex.exercise_id, reps: ex.reps, holdSeconds: ex.hold_seconds })}
                        </p>
                        <p className="mt-0.5 text-xs text-gray-500">{dayCountsText(ex.occurrence_summary)}</p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${
                          PRESCRIPTION_PILLS[ex.prescription_state].classes
                        }`}
                      >
                        {PRESCRIPTION_PILLS[ex.prescription_state].label}
                      </span>
                    </div>
                  ))}
                </div>
              )
            }
          />
        )}

      {showChangePassword && patientProfile?.email && (
        <ChangePasswordModal
          email={patientProfile.email}
          onClose={() => setShowChangePassword(false)}
        />
      )}
    </AppShell>
  );
}

// ── Session helpers ────────────────────────────────────────────────────────

interface ScheduleDateGroup {
  date: string;
  label: string;
  items: PatientOccurrence[];
}

function formatScheduleDate(dateKey: string | null): string {
  if (!dateKey) return "No schedule";
  return new Date(`${dateKey}T00:00:00`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function groupScheduleOccurrences(
  items: PatientOccurrence[],
  order: "asc" | "desc"
): ScheduleDateGroup[] {
  const sorted = [...items].sort((a, b) =>
    order === "asc"
      ? a.due_date.localeCompare(b.due_date)
      : b.due_date.localeCompare(a.due_date)
  );
  const groups: ScheduleDateGroup[] = [];
  for (const occurrence of sorted) {
    const date = occurrence.due_date ?? "";
    const last = groups[groups.length - 1];
    if (last?.date === date) {
      last.items.push(occurrence);
    } else {
      groups.push({ date, label: formatScheduleDate(date), items: [occurrence] });
    }
  }
  return groups;
}

function ScheduleDateGroups({
  groups,
  today,
  onStart,
  sessionsByOccurrenceId,
  initiallyOpen = false,
}: {
  groups: ScheduleDateGroup[];
  today: string;
  onStart: (occurrence: PatientOccurrence) => Promise<void>;
  sessionsByOccurrenceId: Map<number, ScheduleSessionRecord[]>;
  initiallyOpen?: boolean;
}) {
  return (
    <div className="space-y-2">
      {groups.map((group) => {
        const isMakeup = group.date < today && group.items.some((occurrence) =>
          isOccurrenceActionable(
            {
              dueDate: occurrence.due_date,
              makeupUntil: occurrence.makeup_until,
              status: occurrence.status,
            },
            today
          )
        );
        const heading = group.date === today
          ? `Today · ${group.label}`
          : isMakeup
            ? `Make-up from ${group.label}`
            : group.label;
        const completedCount = group.items.filter(
          (occurrence) => occurrence.status === "completed"
        ).length;

        return (
          <details
            key={group.date}
            open={initiallyOpen}
            className="bg-white border border-gray-200 rounded-xl overflow-hidden"
          >
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-green-800 hover:bg-green-50">
              <span>{heading}</span>
              <span className="ml-2 text-xs font-normal text-gray-500">
                {group.items.length} exercise{group.items.length === 1 ? "" : "s"}
                {completedCount > 0 && ` · ${completedCount} completed`}
              </span>
            </summary>
            <div className="border-t border-gray-100 p-3">
              <div className="space-y-2">
                {group.items.map((occurrence) => (
                  <ScheduleOccurrenceCard
                    key={occurrence.id}
                  occurrence={occurrence}
                  today={today}
                  onStart={onStart}
                  sessionsByOccurrenceId={sessionsByOccurrenceId}
                />
                ))}
              </div>
            </div>
          </details>
        );
      })}
    </div>
  );
}

function ScheduleOccurrenceCard({
  occurrence,
  today,
  onStart,
  sessionsByOccurrenceId,
}: {
  occurrence: PatientOccurrence;
  today: string;
  onStart: (occurrence: PatientOccurrence) => Promise<void>;
  sessionsByOccurrenceId: Map<number, ScheduleSessionRecord[]>;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [showVideo, setShowVideo] = useState(false);
  // Camera exercises show their guide on the camera page; a manual one shows
  // the video its custom exercise carries, here where the patient does it.
  const guideVideo = occurrence.monitoring_mode === "manual" ? exerciseVideoFromRow(occurrence) : null;
  const style = occurrenceCardStyle(
    occurrence.status,
    occurrence.due_date,
    occurrence.makeup_until,
    today
  );
  const completedResult = occurrence.status === "completed"
    ? selectCompletedOccurrenceResult(sessionsByOccurrenceId.get(occurrence.id) ?? [])
    : null;

  return (
    <div className={`rounded-xl border px-4 py-4 transition-colors ${style.card}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h4 className="text-sm font-semibold text-gray-900 min-w-0">{occurrence.name}</h4>
          {occurrence.monitoring_mode === "manual" && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
              Manual · no Machine Learning
            </span>
          )}
        </div>
        <span className={`shrink-0 text-xs px-2.5 py-1 rounded-full font-medium ${style.badge}`}>
          {style.label}
        </span>
      </div>

      <div className="mt-3 pt-3 border-t border-black/5 flex flex-wrap items-center gap-x-5 gap-y-3">
        <p className="text-xs text-gray-500">
          Sets <strong className="ml-1 text-gray-900">{occurrence.sets}</strong>
        </p>
        <p className="text-xs text-gray-500">
          {prescriptionMetricLabel(occurrence.exercise_id)}
          <strong className="ml-1 text-gray-900">
            {prescriptionMetricValue({
              exerciseId: occurrence.exercise_id,
              reps: occurrence.reps,
              holdSeconds: occurrence.hold_seconds,
            })}
          </strong>
        </p>
        <p className="text-xs text-gray-500">
          Rest <strong className="ml-1 text-gray-900">{occurrence.rest_seconds}s</strong>
        </p>
        {guideVideo && (
          <button
            type="button"
            onClick={() => setShowVideo((shown) => !shown)}
            aria-expanded={showVideo}
            className="text-xs font-semibold text-green-700 hover:text-green-800 underline-offset-2 hover:underline"
          >
            {showVideo ? "Hide video" : "▶ Watch video"}
          </button>
        )}

        {style.action === "done" ? (
          <span className="ml-auto text-xs font-semibold text-green-700">✓ Done</span>
        ) : style.action === "pain" ? (
          <span className="ml-auto text-xs font-semibold text-red-700">
            Contact your therapist
          </span>
        ) : style.action === "start" ? (
          <button
            type="button"
            disabled={submitting}
            onClick={async () => {
              setSubmitting(true);
              try {
                await onStart(occurrence);
              } finally {
                setSubmitting(false);
              }
            }}
            className="ml-auto px-4 py-2 bg-green-700 hover:bg-green-800 disabled:bg-gray-300 text-white rounded-lg text-sm font-medium transition"
          >
            {submitting ? "Opening..." : "Start Session"}
          </button>
        ) : style.action === "upcoming" ? (
          <span className="ml-auto text-xs font-medium text-gray-500">
            Available {formatScheduleDate(occurrence.due_date)}
          </span>
        ) : (
          <span className="ml-auto text-xs font-medium text-red-600">Window closed</span>
        )}
      </div>

      {guideVideo && showVideo && (
        <div className="mt-3">
          <CustomExerciseVideo exerciseId={occurrence.exercise_id} exerciseName={occurrence.name} video={guideVideo} />
        </div>
      )}

      {completedResult && (
        <CompletedSessionSummary
          occurrence={occurrence}
          result={completedResult}
        />
      )}
    </div>
  );
}

function CompletedSessionSummary({
  occurrence,
  result,
}: {
  occurrence: PatientOccurrence;
  result: CompletedOccurrenceResult;
}) {
  const session = result.primary;
  const completedAt = formatSessionTime(session.endedAt ?? session.startedAt);
  const dose = completedSessionDoseText(session);
  const duration = formatSessionDuration(session.durationMs);

  return (
    <div className="mt-3 rounded-lg border border-green-200 bg-white/70 px-3 py-2.5">
      <p className="text-xs font-semibold text-green-800">
        Completed {completedAt}
      </p>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-600">
        {session.setCount > 0 && (
          <span>{session.setCount}/{occurrence.sets} sets</span>
        )}
        {dose && <span>{dose}</span>}
        {duration && <span>{duration}</span>}
        {result.attemptCount > 1 && (
          <span>{result.attemptCount} attempts</span>
        )}
      </div>
    </div>
  );
}

function formatSessionTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Manila",
  });
}

function formatSessionDuration(durationMs: number | null): string | null {
  if (durationMs === null || !Number.isFinite(durationMs) || durationMs <= 0) return null;
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

// Maps one currently actionable occurrence to its dashboard tag. Only an
// occurrence explicitly stored as in_progress may receive an active-looking
// label; old assignment history never reaches this helper. For in_progress we
// still distinguish a user-ended latest attempt from an open/disrupted one.
function dashboardOccurrenceStatusTag(
  occurrence: PatientOccurrence,
  today: string,
  latestEndedByUser: boolean
): { label: string; classes: string } {
  if (occurrence.status === "in_progress") {
    return latestEndedByUser
      ? { label: "Ended Early", classes: "bg-amber-100 text-amber-700" }
      : { label: "In Progress", classes: "bg-blue-100 text-blue-700" };
  }
  if (occurrence.due_date < today) {
    return { label: "Make-up", classes: "bg-amber-100 text-amber-700" };
  }
  return { label: "Due today", classes: "bg-blue-100 text-blue-700" };
}

// Card/badge styling + the action affordance for one scheduled occurrence.
// A patient may start an occurrence that is due today OR still inside its make-up
// window (overdue but not yet missed). Once today passes makeup_until it is
// "Missed" (no start); future days are disabled until their date.
function occurrenceCardStyle(
  status: OccurrenceStatus,
  dueDate: string,
  makeupUntil: string,
  today: string
): {
  label: string;
  card: string;
  badge: string;
  action: "done" | "pain" | "start" | "upcoming" | "missed";
} {
  if (status === "completed") {
    return { label: "Completed", card: "bg-green-50 border-green-200", badge: "bg-green-100 text-green-700", action: "done" };
  }
  if (status === "pain_stopped") {
    return {
      label: "Stopped for pain",
      card: "bg-red-50 border-red-200",
      badge: "bg-red-100 text-red-700",
      action: "pain",
    };
  }
  if (dueDate === today) {
    return {
      label: status === "in_progress" ? "In Progress" : "Due today",
      card: "bg-blue-50 border-blue-200",
      badge: "bg-blue-100 text-blue-700",
      action: "start",
    };
  }
  if (dueDate > today) {
    return { label: "Upcoming", card: "bg-white border-gray-200", badge: "bg-gray-100 text-gray-600", action: "upcoming" };
  }
  // Past due. Still actionable while the make-up window is open, else missed.
  if (makeupUntil >= today) {
    return { label: "Make-up", card: "bg-amber-50 border-amber-200", badge: "bg-amber-100 text-amber-700", action: "start" };
  }
  return { label: "Missed", card: "bg-red-50 border-red-200", badge: "bg-red-100 text-red-700", action: "missed" };
}

// ── Profile helpers ────────────────────────────────────────────────────────

function formatMemberSince(dateStr: string | null): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

// ── Icons ──────────────────────────────────────────────────────────────────

function PersonIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 12c2.7 0 5-2.3 5-5s-2.3-5-5-5-5 2.3-5 5 2.3 5 5 5zm0 2c-3.3 0-10 1.7-10 5v1h20v-1c0-3.3-6.7-5-10-5z"/>
    </svg>
  );
}

function EmailIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z"/>
    </svg>
  );
}

function PulseIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
      <path d="M3.5 18.49l6-6.01 4 4L22 6.92l-1.41-1.41-7.09 7.97-4-4L2 16.99l1.5 1.5z"/>
    </svg>
  );
}

// ── Sidebar nav icons ──────────────────────────────────────────────────────

function PatHomeIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
      <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>
    </svg>
  );
}

function PatProgressIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
      <path d="M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6z"/>
    </svg>
  );
}

function PatPersonIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 12c2.7 0 5-2.3 5-5s-2.3-5-5-5-5 2.3-5 5 2.3 5 5 5zm0 2c-3.3 0-10 1.7-10 5v1h20v-1c0-3.3-6.7-5-10-5z"/>
    </svg>
  );
}

function PatClockIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
      <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z"/>
    </svg>
  );
}

function PatCameraIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
      <path d="M9 2 7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 14c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/>
    </svg>
  );
}

