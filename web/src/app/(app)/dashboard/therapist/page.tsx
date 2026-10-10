"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { SkeletonBar, SkeletonKpiRow, SkeletonTable } from "../_components/Skeleton";

interface RosterPatient {
  id: string;
  name: string;
  totalSessions: number;
  sessionsThisWeek: number;
  lastSessionAt: string | null;
  assignedCount: number;  // distinct prescriptions (drives "No exercises")
  dueCount: number;       // scheduled occurrences due on or before today
  completedCount: number; // occurrences completed
  missedCount: number;    // past-due occurrences never completed
  painStoppedCount: number; // occurrences paused after a pain stop
}

interface TherapistAnalytics {
  totals: {
    totalPatients: number;
    activePatients: number;
    patientLogins14Days: number;
    newAssignments14Days: number;
    sessions14Days: number;
  };
  daily: {
    date: string;
    sessions: number;
    patientLogins: number;
    newAssignments: number;
  }[];
}

export default function TherapistDashboardPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [patients, setPatients] = useState<RosterPatient[]>([]);
  const [programCount, setProgramCount] = useState(0);
  const [analytics, setAnalytics] = useState<TherapistAnalytics | null>(null);
  const [dataLoading, setDataLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (user && user.role !== "therapist") router.push("/dashboard");
  }, [user, loading, router]);

  useEffect(() => {
    if (loading || !user?.id || user?.role !== "therapist") return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/therapist/overview");
        if (!res.ok) throw new Error("overview fetch failed");
        const d = await res.json();
        if (cancelled) return;
        setPatients(d.patients ?? []);
        setProgramCount(d.programCount ?? 0);
        setAnalytics(d.analytics ?? null);
        setError(false);
      } catch (err) {
        if (cancelled) return;
        console.error("Error loading therapist overview:", err);
        setError(true);
      } finally {
        if (!cancelled) setDataLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, user?.role, loading]);

  if (loading || dataLoading) {
    return (
      <div className="max-w-5xl">
        <SkeletonBar className="h-7 w-40" />
        <SkeletonBar className="h-4 w-56 mt-2 mb-6" />
        <SkeletonKpiRow />
        <SkeletonTable />
      </div>
    );
  }

  const noExercises = patients.filter((p) => p.assignedCount === 0).length;
  // Flag a patient when they have prescriptions but either no activity this week
  // or scheduled days that slipped past uncompleted.
  const needsAttention = patients.filter(
    (p) =>
      p.assignedCount > 0 &&
      (p.sessionsThisWeek === 0 ||
        p.missedCount > 0 ||
        p.painStoppedCount > 0),
  ).length;

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-bold text-green-800">Dashboard</h1>
      <p className="text-gray-500 mt-1 mb-6">Welcome, {user?.name}.</p>

      {error && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
          Couldn&apos;t load the dashboard rollup. Check that the required database scripts have been run, then refresh.
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Patients" value={analytics?.totals.totalPatients ?? patients.length} />
        <KpiCard label="Active (7 days)" value={analytics?.totals.activePatients ?? "—"} />
        <KpiCard label="Sessions (14 days)" value={analytics?.totals.sessions14Days ?? "—"} />
        <KpiCard label="Patient sign-ins (14 days)" value={analytics?.totals.patientLogins14Days ?? "—"} accent="blue" />
        <KpiCard label="New assignments (14 days)" value={analytics?.totals.newAssignments14Days ?? "—"} accent="blue" />
        <KpiCard label="Programs" value={programCount} />
        <KpiCard
          label="No exercises yet"
          value={noExercises}
          accent={noExercises > 0 ? "blue" : "green"}
        />
        <KpiCard
          label="Needs attention"
          value={needsAttention}
          accent={needsAttention > 0 ? "amber" : "green"}
        />
      </div>

      {analytics && <ActivityChart daily={analytics.daily} />}
      {!analytics && !error && (
        <p className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Activity metrics are unavailable until the database owner runs patient_activity_events_pg.sql.
        </p>
      )}

      {/* Patient roster */}
      <div className="bg-white rounded-2xl border border-green-100 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-green-700 font-semibold text-lg">Patients</h2>
          <Link
            href="/dashboard/therapist/patients"
            className="text-sm text-green-700 hover:underline"
          >
            Manage patients →
          </Link>
        </div>

        {patients.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-8">
            No patients assigned yet. The admin assigns patients to you.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                  <th className="py-2 pr-4 font-medium">Patient</th>
                  <th className="py-2 px-4 font-medium">Last active</th>
                  <th className="py-2 px-4 font-medium">This week</th>
                  <th className="py-2 px-4 font-medium">Progress</th>
                  <th className="py-2 pl-4 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {patients.map((p) => {
                  const status = rosterStatus(p);
                  return (
                    <tr
                      key={p.id}
                      className="border-b border-gray-50 hover:bg-green-50/40 transition"
                    >
                      <td className="py-3 pr-4">
                        <Link
                          href={`/dashboard/therapist/patients/${p.id}`}
                          className="font-semibold text-green-700 hover:underline"
                        >
                          {p.name}
                        </Link>
                      </td>
                      <td className="py-3 px-4 text-gray-600 whitespace-nowrap">
                        {fmtLastActive(p.lastSessionAt)}
                      </td>
                      <td className="py-3 px-4 text-gray-600">{p.sessionsThisWeek}</td>
                      <td className="py-3 px-4 text-gray-600">
                        {p.dueCount > 0 ? `${p.completedCount}/${p.dueCount}` : "—"}
                        {p.missedCount > 0 && (
                          <span className="ml-2 text-xs text-amber-600">
                            {p.missedCount} missed
                          </span>
                        )}
                        {p.painStoppedCount > 0 && (
                          <span className="ml-2 text-xs font-medium text-red-600">
                            {p.painStoppedCount} pain stop
                          </span>
                        )}
                      </td>
                      <td className="py-3 pl-4">
                        <span
                          className={`inline-block text-xs px-3 py-1 rounded-full font-medium whitespace-nowrap ${status.classes}`}
                        >
                          {status.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// "Needs attention" = the patient has prescriptions but either no outcome-bearing
// session in the server's 7-day window (sessionsThisWeek === 0) or scheduled days
// that slipped past uncompleted (missedCount > 0). The 7-day window is a tunable
// heuristic set in getTherapistRoster.
function rosterStatus(p: RosterPatient): { label: string; classes: string } {
  if (p.assignedCount === 0) {
    return { label: "No exercises", classes: "bg-gray-100 text-gray-500" };
  }
  if (p.painStoppedCount > 0) {
    return { label: "Pain follow-up", classes: "bg-red-100 text-red-700" };
  }
  if (p.missedCount > 0) {
    return { label: "Needs attention", classes: "bg-amber-100 text-amber-700" };
  }
  if (p.sessionsThisWeek > 0) {
    return { label: "Active", classes: "bg-green-100 text-green-700" };
  }
  return { label: "Needs attention", classes: "bg-amber-100 text-amber-700" };
}

function fmtLastActive(iso: string | null): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function KpiCard({
  label,
  value,
  accent = "green",
}: {
  label: string;
  value: number | string;
  accent?: "green" | "amber" | "blue";
}) {
  const valueColor =
    accent === "amber" ? "text-amber-600"
    : accent === "blue" ? "text-blue-600"
    : "text-green-700";
  return (
    <div className="bg-white rounded-2xl border border-green-100 p-5">
      <p className={`text-3xl font-bold ${valueColor}`}>{value}</p>
      <p className="text-xs text-gray-500 mt-1">{label}</p>
    </div>
  );
}

function ActivityChart({ daily }: { daily: TherapistAnalytics["daily"] }) {
  const maxValue = Math.max(
    1,
    ...daily.flatMap((day) => [day.sessions, day.patientLogins, day.newAssignments]),
  );
  const series = [
    { key: "sessions" as const, label: "Sessions", color: "bg-green-600" },
    { key: "patientLogins" as const, label: "Patient sign-ins", color: "bg-blue-600" },
    { key: "newAssignments" as const, label: "New assignments", color: "bg-amber-500" },
  ];

  return (
    <section className="mb-6 rounded-xl border border-green-100 bg-white p-5 sm:p-6" aria-labelledby="therapist-activity-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="therapist-activity-title" className="text-lg font-semibold text-green-800">Patient Activity</h2>
          <p className="mt-1 text-xs text-gray-500">Daily totals for the last 14 days · Manila time</p>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-gray-600">
          {series.map((item) => (
            <span key={item.key} className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-sm ${item.color}`} />
              {item.label}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-5 overflow-x-auto">
        <div className="flex h-48 min-w-[760px] items-end gap-2 border-b border-gray-200 px-1">
          {daily.map((day) => (
            <div key={day.date} className="flex h-full min-w-0 flex-1 flex-col justify-end">
              <div
                className="flex h-[calc(100%-1.5rem)] items-end justify-center gap-1"
                role="img"
                aria-label={`${formatDay(day.date)}: ${day.sessions} sessions, ${day.patientLogins} patient sign-ins, ${day.newAssignments} new assignments`}
              >
                {series.map((item) => {
                  const value = day[item.key];
                  return (
                    <div
                      key={item.key}
                      title={`${item.label}: ${value}`}
                      className={`w-2.5 rounded-t-sm ${item.color} ${value === 0 ? "opacity-20" : ""}`}
                      style={{ height: `${Math.max(value > 0 ? 4 : 0, (value / maxValue) * 100)}%` }}
                    />
                  );
                })}
              </div>
              <span className="h-6 pt-1 text-center text-[10px] text-gray-500">{formatDay(day.date)}</span>
            </div>
          ))}
        </div>
      </div>
      <p className="mt-3 text-xs text-gray-500">
        Active patients have a recorded sign-in or completed exercise session within the last 7 days. Sign-in and assignment trends begin when activity tracking is installed.
      </p>
    </section>
  );
}

function formatDay(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    month: "numeric",
    day: "numeric",
  });
}
