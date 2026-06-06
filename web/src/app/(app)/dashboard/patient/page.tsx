"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import {
  prescriptionMetricLabel,
  prescriptionMetricValue,
  prescriptionTargetText,
} from "@/lib/exercises/prescriptionDisplay";
import ConsistencyCalendar from "./ConsistencyCalendar";
import { groupSessionsByExercise, ExerciseTrendCard } from "../_components/ExerciseTrends";
import { SkeletonBar, SkeletonCard } from "../_components/Skeleton";

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

// Per-session summary from /api/sessions. Carries the fields the calendar, the
// exercise tags, and the My Progress trend charts all need (this shape
// structurally satisfies the shared TrendSession type).
interface SessionLite {
  id: number;
  exerciseId: string;
  exerciseName: string;
  exerciseKind: "dynamic" | "isometric" | null;
  startedAt: string;
  endedAt: string | null;
  endReason: string | null;
  setCount: number;
  totalReps: number;
  avgPeakValue: number | null;
  completeLeftReps: number;
  completeRightReps: number;
  totalPairedHoldMs: number | null;
}

type ActiveTab = "dashboard" | "my-progress" | "view-profile" | "session";

export default function PatientDashboardPage() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<ActiveTab>("dashboard");
  const [pageLoading, setPageLoading] = useState(true);
  const [patientProfile, setPatientProfile] = useState<PatientProfile | null>(null);
  const [exercises, setExercises] = useState<AssignedExercise[]>([]);
  const [sessions, setSessions] = useState<SessionLite[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (user && user.role !== "patient") { router.push("/dashboard"); return; }
    setPageLoading(false);
  }, [user, loading, router]);

  const loadData = async () => {
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
  };

  useEffect(() => {
    if (!loading && user?.id) loadData();
  }, [user?.id, loading]);

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

  return (
    <div className="min-h-screen flex bg-green-50">

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
        <button
          className="md:hidden mb-4 flex items-center gap-2 px-3 py-2 bg-green-700 hover:bg-green-800 text-white text-sm font-medium rounded transition"
          onClick={() => setSidebarOpen(true)}
        >
          ☰ Menu
        </button>

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
              <ConsistencyCalendar sessions={sessions} />

              {/* Your Exercises — status-at-a-glance list (the Session tab is the
                  date-scheduled, actionable view). Start Session lives here. */}
              <div className="bg-white border border-green-200 rounded-2xl p-6">
                <div className="flex items-center justify-between gap-3 mb-4">
                  <h2 className="text-base font-semibold text-green-700">Your Exercises</h2>
                  <Link
                    href="/camera"
                    className="shrink-0 px-4 py-2 bg-green-700 hover:bg-green-800 text-white rounded-lg text-sm font-medium transition"
                  >
                    Start Session
                  </Link>
                </div>
                {exercises.length === 0 ? (
                  <p className="text-gray-400 text-sm text-center py-6">
                    No exercises assigned yet. Your therapist will assign exercises to you.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {exercises.map((ex) => {
                      const latest = latestSessionByExercise.get(ex.exercise_id);
                      const tag = exerciseStatusTag(
                        ex.status,
                        latest?.endReason === "user"
                      );
                      return (
                        <div
                          key={ex.exercise_id}
                          className="flex items-center justify-between gap-4 border border-gray-100 rounded-xl px-4 py-3"
                        >
                          <div className="min-w-0">
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
          // Sort ascending by assigned_date then group by date
          const sorted = [...exercises].sort((a, b) =>
            (a.assigned_date ?? "").localeCompare(b.assigned_date ?? "")
          );
          const groups: { date: string; label: string; items: AssignedExercise[] }[] = [];
          for (const ex of sorted) {
            const date = ex.assigned_date ?? "";
            const label = date
              ? new Date(date + "T00:00:00").toLocaleDateString("en-US", {
                  month: "long", day: "numeric", year: "numeric",
                })
              : "No Date";
            const last = groups[groups.length - 1];
            if (last && last.date === date) {
              last.items.push(ex);
            } else {
              groups.push({ date, label, items: [ex] });
            }
          }

          const completed = exercises.filter((e) => e.status === "completed").length;
          const total = exercises.length;
          const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

          return (
            <div>
              <h1 className="text-2xl font-bold text-green-800 mb-1">Session Schedule</h1>
              <p className="text-gray-500 mb-6">Track your exercises by scheduled date</p>

              {/* Progress card */}
              {total > 0 && (
                <div className="bg-white border border-green-200 rounded-2xl p-6 mb-6">
                  <div className="flex justify-between items-center mb-3">
                    <h2 className="text-base font-semibold text-green-700">Overall Progress</h2>
                    <span className="text-xl font-bold text-green-700">{completed}/{total}</span>
                  </div>
                  <div className="w-full bg-green-100 rounded-full h-3 overflow-hidden">
                    <div className="bg-green-700 h-full rounded-full transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="text-xs text-green-700 mt-2">{pct}% complete</p>
                </div>
              )}

              {/* Exercise groups */}
              {total === 0 ? (
                <div className="bg-white border border-green-200 rounded-2xl p-8 text-center text-gray-500 text-sm">
                  No exercises assigned yet. Your therapist will assign exercises to you.
                </div>
              ) : (
                <div className="space-y-6">
                  {groups.map((group) => (
                    <div key={group.date}>
                      {/* Date header */}
                      <div className="flex items-center gap-3 mb-3">
                        <span className="text-sm font-semibold text-green-800">
                          Scheduled: {group.label}
                        </span>
                        <div className="flex-1 h-px bg-green-200" />
                      </div>

                      {/* Exercises under this date */}
                      <div className="space-y-3">
                        {group.items.map((ex) => {
                          const available = !!ex.assigned_date && ex.assigned_date <= sessionTodayPH();
                          return (
                            <div
                              key={ex.exercise_id}
                              className={`rounded-2xl border p-5 transition-all ${
                                ex.status === "completed"
                                  ? "bg-green-50 border-green-200"
                                  : ex.status === "in_progress"
                                  ? "bg-blue-50 border-blue-200"
                                  : "bg-red-50 border-red-200"
                              }`}
                            >
                              <div className="flex items-start justify-between mb-3">
                                <h3 className="text-base font-semibold text-gray-900">{ex.name}</h3>
                                <span className={`text-xs px-3 py-1 rounded-full font-medium ${
                                  ex.status === "completed"
                                    ? "bg-green-100 text-green-700"
                                    : ex.status === "in_progress"
                                    ? "bg-blue-100 text-blue-700"
                                    : "bg-red-100 text-red-700"
                                }`}>
                                  {ex.status === "completed" ? "Completed" : ex.status === "in_progress" ? "In Progress" : "Not Started"}
                                </span>
                              </div>

                              <div className="flex items-center gap-6">
                                <div>
                                  <p className="text-xs text-gray-500 mb-1">Sets</p>
                                  <p className="text-lg font-bold text-gray-900">{ex.sets}</p>
                                </div>
                                <div>
                                  <p className="text-xs text-gray-500 mb-1">
                                    {prescriptionMetricLabel(ex.exercise_id)}
                                  </p>
                                  <p className="text-lg font-bold text-gray-900">
                                    {prescriptionMetricValue({
                                      exerciseId: ex.exercise_id,
                                      reps: ex.reps,
                                      holdSeconds: ex.hold_seconds,
                                    })}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-xs text-gray-500 mb-1">Rest</p>
                                  <p className="text-lg font-bold text-gray-900">{ex.rest_seconds}s</p>
                                </div>
                                {ex.status === "completed" ? (
                                  <div className="ml-auto flex items-center gap-2">
                                    <svg className="w-5 h-5 text-green-700" fill="currentColor" viewBox="0 0 20 20">
                                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                    </svg>
                                    <span className="text-green-700 text-sm font-medium">Done</span>
                                  </div>
                                ) : available ? (
                                  <button
                                    onClick={() => router.push(`/camera?exerciseId=${ex.exercise_id}`)}
                                    className="ml-auto px-4 py-2 bg-green-700 hover:bg-green-800 text-white rounded-lg text-sm font-medium transition"
                                  >
                                    Start Session
                                  </button>
                                ) : (
                                  <button
                                    disabled
                                    title={`Available on ${ex.assigned_date}`}
                                    className="ml-auto px-4 py-2 bg-gray-200 text-gray-400 rounded-lg text-sm font-medium cursor-not-allowed"
                                  >
                                    Start Session
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
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
                      disabled
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-green-700 text-white text-sm font-medium cursor-not-allowed opacity-90"
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
    </div>
  );
}

// ── Session helpers ────────────────────────────────────────────────────────

function sessionTodayPH(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }); // YYYY-MM-DD
}

// Maps a patient-exercise status to a dashboard tag. For in_progress we look at
// the patient's MOST RECENT session and its end_reason: 'user' means the camera
// End button was pressed → "Ended Early"; anything else (still open = a tab
// close / navigation / exit, or ended by an exercise-switch / supersession) →
// "In Progress". Keying on the latest session keeps an old superseded or open
// row from mislabeling a later End.
function exerciseStatusTag(
  status: string,
  latestEndedByUser: boolean
): { label: string; classes: string } {
  switch (status) {
    case "completed":
      return { label: "Completed", classes: "bg-green-100 text-green-700" };
    case "in_progress":
      return latestEndedByUser
        ? { label: "Ended Early", classes: "bg-amber-100 text-amber-700" }
        : { label: "In Progress", classes: "bg-blue-100 text-blue-700" };
    default:
      return { label: "Not Started", classes: "bg-gray-100 text-gray-600" };
  }
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
