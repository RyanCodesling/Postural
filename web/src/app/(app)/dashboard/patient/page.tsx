"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import NotificationBell from "../_components/NotificationBell";
import {
  prescriptionMetricLabel,
  prescriptionMetricValue,
  prescriptionTargetText,
} from "@/lib/exercises/prescriptionDisplay";
import ConsistencyCalendar from "./ConsistencyCalendar";
import { groupSessionsByExercise, ExerciseTrendCard } from "../_components/ExerciseTrends";
import { SkeletonBar, SkeletonCard } from "../_components/Skeleton";
import ChangePasswordModal from "../_components/ChangePasswordModal";
import {
  classifyScheduleOccurrence,
  isOccurrenceActionable,
  type OccurrenceStatus,
} from "@/lib/exercises/occurrences";
import {
  groupSessionsByOccurrence,
  selectCompletedOccurrenceResult,
  type CompletedOccurrenceResult,
  type ScheduleSessionRecord,
} from "@/lib/exercises/scheduleSessionSummary";

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
  status: string;
  sets: number;
  reps: number;
  rest_seconds: number;
  hold_seconds: number;
  assigned_date: string;
}

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
  monitoring_mode: "camera" | "manual";
}

// Per-session summary from /api/sessions. Carries the fields the calendar, the
// exercise tags, and the My Progress trend charts all need (this shape
// structurally satisfies the shared TrendSession type).
interface SessionLite extends ScheduleSessionRecord {
  exerciseId: string;
  exerciseName: string;
  avgPeakValue: number | null;
}

type ActiveTab = "dashboard" | "my-progress" | "view-profile" | "session";

export default function PatientDashboardPage() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<ActiveTab>("dashboard");
  const [pageLoading, setPageLoading] = useState(true);
  const [patientProfile, setPatientProfile] = useState<PatientProfile | null>(null);
  const [exercises, setExercises] = useState<AssignedExercise[]>([]);
  const [occurrences, setOccurrences] = useState<PatientOccurrence[]>([]);
  const [sessions, setSessions] = useState<SessionLite[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [scheduleActionError, setScheduleActionError] = useState("");

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

  const handleOccurrenceStart = async (occurrence: PatientOccurrence) => {
    setScheduleActionError("");
    if (occurrence.monitoring_mode === "camera") {
      router.push(`/camera?exerciseId=${occurrence.exercise_id}`);
      return;
    }

    const response = await fetch(`/api/exercise-occurrences/${occurrence.id}`, {
      method: "PATCH",
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setScheduleActionError(body?.error ?? "Could not complete the manual exercise.");
      return;
    }
    await loadData();
  };

  useEffect(() => {
    if (!loading && user?.id) void loadData();
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

  const today = sessionTodayPH();
  const actionableOccurrences = occurrences.filter((occurrence) =>
    isOccurrenceActionable(
      {
        dueDate: occurrence.due_date,
        makeupUntil: occurrence.makeup_until,
        status: occurrence.status,
      },
      today
    )
  );

  return (
    <div
      className="min-h-screen flex bg-green-50 text-gray-900"
      style={{ colorScheme: "light" }}
    >

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-40 w-64 bg-green-900 text-white p-6 flex flex-col transform transition-transform duration-200
        ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
        md:static md:translate-x-0 md:flex md:flex-col md:flex-shrink-0`}>
        <div className="mb-8">
          <div className="text-lg font-semibold text-white">{user?.name || "Patient"}</div>
        </div>

        <nav>
          <ul className="space-y-1">
            {NAV_TABS.map(({ key, label, Icon }) => (
              <li key={key}>
                <button
                  onClick={() => { setActiveTab(key); setSidebarOpen(false); }}
                  className={`w-full text-left flex items-center gap-2 px-3 py-2 rounded text-sm transition ${
                    activeTab === key
                      ? "bg-green-700 text-white font-medium"
                      : "text-green-200 hover:bg-green-800"
                  }`}
                >
                  <Icon />
                  {label}
                </button>
              </li>
            ))}
            <li>
              <button
                onClick={() => { setActiveTab("session"); setSidebarOpen(false); }}
                className={`w-full text-left flex items-center gap-2 px-3 py-2 rounded text-sm transition ${
                  activeTab === "session"
                    ? "bg-green-700 text-white font-medium"
                    : "text-green-200 hover:bg-green-800"
                }`}
              >
                <PatClockIcon />
                Session
              </button>
            </li>
            <li>
              <Link
                href="/camera"
                className="flex items-center gap-2 px-3 py-2 rounded text-sm text-green-200 hover:bg-green-800"
                onClick={() => setSidebarOpen(false)}
              >
                <PatCameraIcon />
                Camera
              </Link>
            </li>
          </ul>
        </nav>

        <div className="mt-auto pt-6 mb-4">
          <button
            onClick={async () => { await logout(); router.push("/"); }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded bg-red-600 hover:bg-red-700 text-white text-sm font-medium transition"
          >
            <PatLogoutIcon />
            Log Out
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 p-4 sm:p-6 overflow-y-auto min-w-0">
        <div className="flex justify-between items-center mb-6">
          <button
            className="md:hidden flex items-center gap-2 px-3 py-2 bg-green-700 hover:bg-green-800 text-white text-sm font-medium rounded transition"
            onClick={() => setSidebarOpen(true)}
          >
            ☰ Menu
          </button>
          <div className="md:hidden flex-1" />
          <div className="ml-auto">
            <NotificationBell />
          </div>
        </div>

        {/* ── Dashboard ── */}
        {activeTab === "dashboard" && (
          <div className="max-w-5xl">
            <h1 className="text-2xl font-bold text-green-800">Dashboard</h1>
            <p className="text-gray-500 mt-1 mb-6">
              Welcome to your postural monitoring dashboard, {user?.name}.
            </p>

            {/* Consistency + Your Exercises, side by side on wide screens. */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
              {/* Consistency calendar */}
              <ConsistencyCalendar sessions={sessions} occurrences={occurrences} />

              {/* Your Exercises — status-at-a-glance list (the Session tab is the
                  date-scheduled, actionable view). Start Session lives here. */}
              <div className="bg-white border border-green-200 rounded-2xl p-6">
                <div className="flex items-center justify-between gap-3 mb-4">
                  <h2 className="text-base font-semibold text-green-700">Your Exercises</h2>
                  {actionableOccurrences.length > 0 ? (
                    <Link
                      href={`/camera?exerciseId=${encodeURIComponent(actionableOccurrences[0].exercise_id)}`}
                      className="shrink-0 px-4 py-2 bg-green-700 hover:bg-green-800 text-white rounded-lg text-sm font-medium transition"
                    >
                      Start Session
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setActiveTab("session")}
                      className="shrink-0 px-4 py-2 border border-green-200 text-green-700 hover:bg-green-50 rounded-lg text-sm font-medium transition"
                    >
                      View Schedule
                    </button>
                  )}
                </div>
                {actionableOccurrences.length === 0 ? (
                  <div className="text-center py-6">
                    <p className="text-gray-600 text-sm font-medium">
                      No exercises scheduled for today.
                    </p>
                    <p className="text-gray-400 text-xs mt-1">
                      View your schedule for upcoming or previous prescriptions.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {actionableOccurrences.map((occurrence) => {
                      const latest = latestSessionByExercise.get(occurrence.exercise_id);
                      const tag = dashboardOccurrenceStatusTag(
                        occurrence,
                        today,
                        latest?.endReason === "user"
                      );
                      return (
                        <div
                          key={occurrence.id}
                          className="flex items-center justify-between gap-4 border border-gray-100 rounded-xl px-4 py-3"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-green-700">{occurrence.name}</p>
                            <p className="text-xs text-gray-500 mt-0.5">
                              {occurrence.sets} sets ×{" "}
                              {prescriptionTargetText({
                                exerciseId: occurrence.exercise_id,
                                reps: occurrence.reps,
                                holdSeconds: occurrence.hold_seconds,
                              })}
                            </p>
                          </div>
                          <span className={`shrink-0 text-xs px-3 py-1 rounded-full font-medium ${tag.classes}`}>
                            {tag.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── My Progress ── */}
        {activeTab === "my-progress" && (() => {
          const trendGroups = groupSessionsByExercise(sessions);
          return (
            <div className="max-w-4xl">
              <h1 className="text-2xl font-bold text-green-800">My Progress</h1>
              <p className="text-gray-500 mt-1">Your session-over-session trends per exercise.</p>
              <p className="text-xs text-gray-400 mt-1 mb-6">Descriptive trends — not a diagnosis.</p>

              {trendGroups.length === 0 ? (
                <div className="bg-white border border-green-200 rounded-2xl p-8 text-center text-gray-500 text-sm">
                  Finish a few sessions to see your progress here.
                </div>
              ) : (
                <div className="space-y-5">
                  {trendGroups.map((g) => (
                    <ExerciseTrendCard key={g.exerciseId} group={g} />
                  ))}
                </div>
              )}
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

          return (
            <div className="max-w-5xl">
              <h1 className="text-2xl font-bold text-green-800 mb-1">Session Schedule</h1>
              <p className="text-gray-500 mb-6">
                See what is due now, what comes next, and when the prescription ends.
              </p>

              {scheduleActionError && (
                <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {scheduleActionError}
                </div>
              )}

              {occurrences.length === 0 ? (
                <div className="bg-white border border-green-200 rounded-2xl p-8 text-center text-gray-500 text-sm">
                  No exercises assigned yet. Your therapist will assign exercises to you.
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <ScheduleSummaryCard
                      label="Today"
                      value={
                        startableNow.length > 0
                          ? `${startableNow.length} ready`
                          : current.length > 0
                            ? "All done"
                            : "Nothing due"
                      }
                      detail={
                        startableNow.some((occurrence) => occurrence.due_date < today)
                          ? "Includes available make-up work"
                          : "Only current work appears below"
                      }
                    />
                    <ScheduleSummaryCard
                      label="Next session"
                      value={nextGroup ? nextGroup.label : "None scheduled"}
                      detail={
                        nextGroup
                          ? `${nextGroup.items.length} exercise${nextGroup.items.length === 1 ? "" : "s"}`
                          : "No future prescription dates"
                      }
                    />
                    <ScheduleSummaryCard
                      label={scheduleHasEnded ? "Schedule ended" : "Schedule ends"}
                      value={scheduleEndKey ? formatScheduleDate(scheduleEndKey) : "No schedule"}
                      detail={
                        dueToDate.length > 0
                          ? `${completedToDate} of ${dueToDate.length} completed to date`
                          : "No sessions due yet"
                      }
                    />
                  </div>

                  <section aria-labelledby="current-schedule-heading">
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <h2 id="current-schedule-heading" className="text-base font-semibold text-green-800">
                        Today & available make-ups
                      </h2>
                      <span className="text-xs text-gray-500">
                        {current.length} item{current.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    {currentGroups.length > 0 ? (
                      <ScheduleDateGroups
                        groups={currentGroups}
                        today={today}
                        initiallyOpen
                        sessionsByOccurrenceId={sessionsByOccurrenceId}
                        onStart={handleOccurrenceStart}
                      />
                    ) : (
                      <div className="bg-white border border-green-200 rounded-2xl px-5 py-6">
                        <p className="text-sm font-semibold text-gray-800">Nothing is due today.</p>
                        <p className="text-xs text-gray-500 mt-1">
                          {nextGroup
                            ? `Your next scheduled date is ${nextGroup.label}.`
                            : scheduleHasEnded
                              ? `This prescription ended on ${formatScheduleDate(scheduleEndKey)}.`
                              : "No future sessions have been assigned."}
                        </p>
                      </div>
                    )}
                  </section>

                  {nextGroup && (
                    <section aria-labelledby="next-schedule-heading">
                      <h2 id="next-schedule-heading" className="text-base font-semibold text-green-800 mb-3">
                        Next scheduled date
                      </h2>
                      <ScheduleDateGroups
                        groups={[nextGroup]}
                        today={today}
                        sessionsByOccurrenceId={sessionsByOccurrenceId}
                        onStart={handleOccurrenceStart}
                      />
                    </section>
                  )}

                  {laterGroups.length > 0 && (
                    <details className="bg-white border border-green-200 rounded-2xl overflow-hidden">
                      <summary className="cursor-pointer px-5 py-4 text-sm font-semibold text-green-800 hover:bg-green-50">
                        Later schedule
                        <span className="ml-2 text-xs font-normal text-gray-500">
                          {laterCount} exercise entries across {laterGroups.length} dates
                        </span>
                      </summary>
                      <div className="border-t border-green-100 p-5">
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
                    <details className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
                      <summary className="cursor-pointer px-5 py-4 text-sm font-semibold text-gray-800 hover:bg-gray-50">
                        Past schedule
                        <span className="ml-2 text-xs font-normal text-gray-500">
                          {history.length} exercise entries across {historyGroups.length} dates · {completedHistory} completed
                        </span>
                      </summary>
                      <div className="border-t border-gray-100 p-5">
                        <ScheduleDateGroups
                          groups={historyGroups}
                          today={today}
                          sessionsByOccurrenceId={sessionsByOccurrenceId}
                          onStart={handleOccurrenceStart}
                        />
                      </div>
                    </details>
                  )}
                </div>
              )}
            </div>
          );
        })()}

        {/* ── View Profile ── */}
        {activeTab === "view-profile" && (
          <div>
            <h1 className="text-2xl font-bold text-green-800 mb-1">My Profile</h1>
            <p className="text-gray-500 mb-6">Manage your personal and account information</p>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

              {/* Left column */}
              <div className="lg:col-span-2 flex flex-col gap-4">

                {/* Personal Information */}
                <div className="bg-white border border-green-200 rounded-2xl p-6">
                  <h2 className="text-base font-semibold text-green-700 mb-5">
                    Personal Information
                  </h2>
                  {!patientProfile ? (
                    <p className="text-sm text-gray-400">
                      Unable to load profile. Please contact your therapist.
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5">
                      <PatInfoField icon={<PersonIcon />} label="Full Name"
                        value={patientProfile.name} />
                      <PatInfoField icon={<PersonIcon />} label="Age"
                        value={patientProfile.age != null ? `${patientProfile.age} years old` : null} />
                      <PatInfoField icon={<EmailIcon />} label="Email"
                        value={patientProfile.email} />
                      <PatInfoField icon={<PulseIcon />} label="Assigned Specialist"
                        value={patientProfile.therapistName} />
                    </div>
                  )}
                </div>

                {/* Assigned Exercises */}
                <div className="bg-white border border-green-200 rounded-2xl p-6">
                  <h2 className="text-base font-semibold text-green-700 mb-4">
                    Assigned Exercises
                  </h2>
                  {exercises.length === 0 ? (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
                      <p className="font-semibold mb-1">No assigned exercises</p>
                      <p>You currently have no exercises assigned. Please contact your therapist.</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {exercises.map((ex) => (
                        <div
                          key={ex.exercise_id}
                          className="flex items-center justify-between gap-4 border border-gray-100 rounded-xl px-4 py-3"
                        >
                          <div>
                            <p className="text-sm font-semibold text-green-700">{ex.name}</p>
                            <p className="text-xs text-gray-500 mt-0.5">
                              {ex.sets} sets ×{" "}
                              {prescriptionTargetText({
                                exerciseId: ex.exercise_id,
                                reps: ex.reps,
                                holdSeconds: ex.hold_seconds,
                              })}
                            </p>
                          </div>
                          <span className={`shrink-0 text-xs px-3 py-1 rounded-full font-medium ${
                            ex.status === "completed"
                              ? "bg-green-100 text-green-700"
                              : ex.status === "in_progress"
                              ? "bg-blue-100 text-blue-700"
                              : "bg-red-100 text-red-700"
                          }`}>
                            {ex.status === "completed"
                              ? "Completed"
                              : ex.status === "in_progress"
                              ? "In Progress"
                              : "Not Started"}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

              </div>

              {/* Right column */}
              <div className="flex flex-col gap-4">

                {/* Account Information */}
                <div className="bg-white border border-green-200 rounded-2xl p-6">
                  <h2 className="text-base font-semibold text-green-700 mb-4">
                    Account Information
                  </h2>
                  <div className="space-y-4">
                    <PatAccountField label="Username"
                      value={patientProfile?.email?.split("@")[0] ?? "—"} />
                    <PatAccountField label="Account Type" value="Patient" />
                    <PatAccountField label="Member Since"
                      value={formatMemberSince(patientProfile?.createdAt ?? null)} />
                  </div>
                </div>

                {/* Account Actions */}
                <div className="bg-white border border-green-200 rounded-2xl p-6">
                  <h2 className="text-base font-semibold text-green-700 mb-4">
                    Account Actions
                  </h2>
                  <div className="space-y-3">
                    <button
                      type="button"
                      onClick={() => setShowChangePassword(true)}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-green-700 hover:bg-green-800 text-white text-sm font-medium transition"
                    >
                      <KeyIcon />
                      Change Password
                    </button>
                    <button
                      type="button"
                      onClick={async () => { await logout(); router.push("/"); }}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-red-500 text-red-600 text-sm font-medium hover:bg-red-50 transition"
                    >
                      <LogoutIcon />
                      Log Out
                    </button>
                  </div>
                </div>

              </div>
            </div>
          </div>
        )}

      </main>

      {showChangePassword && patientProfile?.email && (
        <ChangePasswordModal
          email={patientProfile.email}
          onClose={() => setShowChangePassword(false)}
        />
      )}
    </div>
  );
}

// ── Session helpers ────────────────────────────────────────────────────────

function sessionTodayPH(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }); // YYYY-MM-DD
}

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

function ScheduleSummaryCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="bg-white border border-green-200 rounded-xl px-4 py-3 min-w-0">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className="text-base font-bold text-green-800 mt-1 truncate" title={value}>{value}</p>
      <p className="text-xs text-gray-500 mt-1">{detail}</p>
    </div>
  );
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
              Manual · no camera
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

        {style.action === "done" ? (
          <span className="ml-auto text-xs font-semibold text-green-700">✓ Done</span>
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
            {submitting
              ? "Saving..."
              : occurrence.monitoring_mode === "manual"
                ? "Mark Complete"
                : "Start Session"}
          </button>
        ) : style.action === "upcoming" ? (
          <span className="ml-auto text-xs font-medium text-gray-500">
            Available {formatScheduleDate(occurrence.due_date)}
          </span>
        ) : (
          <span className="ml-auto text-xs font-medium text-red-600">Window closed</span>
        )}
      </div>

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

function completedSessionDoseText(session: ScheduleSessionRecord): string | null {
  if (session.exerciseKind === "isometric" && (session.totalPairedHoldMs ?? 0) > 0) {
    return `${formatSessionDuration(session.totalPairedHoldMs)} paired hold`;
  }
  if (session.completeLeftReps > 0 || session.completeRightReps > 0) {
    return `L ${session.completeLeftReps} / R ${session.completeRightReps} complete`;
  }
  if (session.completeReps > 0) return `${session.completeReps} complete reps`;
  if (session.totalReps > 0) return `${session.totalReps} recorded reps`;
  return null;
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
): { label: string; card: string; badge: string; action: "done" | "start" | "upcoming" | "missed" } {
  if (status === "completed") {
    return { label: "Completed", card: "bg-green-50 border-green-200", badge: "bg-green-100 text-green-700", action: "done" };
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

function PatInfoField({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 shrink-0 text-green-600">{icon}</div>
      <div>
        <p className="text-xs text-gray-500 mb-0.5">{label}</p>
        <p className="text-sm font-semibold text-gray-900">{value ?? "—"}</p>
      </div>
    </div>
  );
}

function PatAccountField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-gray-500 mb-0.5">{label}</p>
      <p className="text-sm font-semibold text-gray-900">{value}</p>
    </div>
  );
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

function KeyIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12.65 10C11.83 7.67 9.61 6 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6c2.61 0 4.83-1.67 5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/>
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4C2.9 3 2 3.9 2 5v14c0 1.1.9 2 2 2h8v-2H4V5z"/>
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

function PatLogoutIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4C2.9 3 2 3.9 2 5v14c0 1.1.9 2 2 2h8v-2H4V5z"/>
    </svg>
  );
}
