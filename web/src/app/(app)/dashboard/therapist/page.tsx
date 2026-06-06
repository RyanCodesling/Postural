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
  assignedCount: number;
  completedCount: number;
}

export default function TherapistDashboardPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [patients, setPatients] = useState<RosterPatient[]>([]);
  const [programCount, setProgramCount] = useState(0);
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

  const sessionsThisWeek = patients.reduce((sum, p) => sum + p.sessionsThisWeek, 0);
  const noExercises = patients.filter((p) => p.assignedCount === 0).length;
  const needsAttention = patients.filter(
    (p) => p.assignedCount > 0 && p.sessionsThisWeek === 0,
  ).length;

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-bold text-green-800">Dashboard</h1>
      <p className="text-gray-500 mt-1 mb-6">Welcome, {user?.name}.</p>

      {error && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
          Couldn&apos;t load the dashboard rollup. Check that the session tables exist and refresh.
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
        <KpiCard label="Patients" value={patients.length} />
        <KpiCard label="Sessions this week" value={sessionsThisWeek} />
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
                        {p.completedCount}/{p.assignedCount}
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

// "Needs attention" = the patient has assigned exercises but no outcome-bearing
// session in the server's 7-day window (sessionsThisWeek === 0). The window is a
// tunable heuristic, set in getTherapistRoster.
function rosterStatus(p: RosterPatient): { label: string; classes: string } {
  if (p.assignedCount === 0) {
    return { label: "No exercises", classes: "bg-gray-100 text-gray-500" };
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
  value: number;
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
