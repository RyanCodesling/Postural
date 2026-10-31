"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { SkeletonBar, SkeletonKpiRow, SkeletonTable } from "../_components/Skeleton";
import { FIT_SCREEN, Glyph, PageHeading, Panel, StatTile } from "../_components/DashboardKit";
import { RosterProgress, RosterStatusBadge, rosterStatus, type RosterPatient } from "../_components/rosterStatus";

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
  // Flag a patient when they have prescriptions but either no activity this week
  // or scheduled days that slipped past uncompleted.
  const needsAttention = patients.filter(
    (p) =>
      p.assignedCount > 0 &&
      (p.sessionsThisWeek === 0 ||
        p.missedCount > 0 ||
        p.painStoppedCount > 0),
  ).length;

  const attention = patients.filter((p) => {
    const label = rosterStatus(p).label;
    return label === "Needs attention" || label === "Pain follow-up";
  });

  return (
    <div className={FIT_SCREEN}>
      <PageHeading title="Dashboard" subtitle={`Welcome, ${user?.name ?? ""}.`} />

      {error && (
        <div className="shrink-0 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
          Couldn&apos;t load the dashboard rollup. Check that the session tables exist and refresh.
        </div>
      )}

      <div id="tour-tiles" className="grid shrink-0 grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatTile label="Patients" value={patients.length} icon={Glyph.users} tone="green" />
        <StatTile label="Sessions this week" value={sessionsThisWeek} icon={Glyph.pulse} tone="teal" />
        <StatTile label="Programs" value={programCount} icon={Glyph.list} tone="lime" />
        <StatTile label="No exercises yet" value={noExercises} icon={Glyph.dumbbell} tone={noExercises > 0 ? "teal" : "green"} />
        <StatTile label="Needs attention" value={needsAttention} icon={Glyph.alert} tone={needsAttention > 0 ? "amber" : "green"} />
      </div>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-12">
        <Panel
          id="tour-roster"
          className="lg:col-span-8"
          title="Patients"
          right={
            <Link href="/dashboard/therapist/patients" className="text-sm text-green-700 hover:underline">
              Manage patients →
            </Link>
          }
          scroll
        >
          {patients.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400">
              No patients assigned yet. The admin assigns patients to you.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-gray-100 text-left text-xs text-gray-400">
                  <th className="py-2 pr-2 font-medium sm:pr-4">Patient</th>
                  <th className="hidden px-4 py-2 font-medium sm:table-cell">Last active</th>
                  <th className="hidden px-4 py-2 font-medium sm:table-cell">This week</th>
                  <th className="px-2 py-2 font-medium sm:px-4">Progress</th>
                  <th className="py-2 pl-2 font-medium sm:pl-4">Status</th>
                </tr>
              </thead>
              <tbody>
                {patients.map((p) => {
                  return (
                    <tr key={p.id} className="border-b border-gray-50 transition hover:bg-green-50/40">
                      <td className="py-2.5 pr-2 sm:pr-4">
                        <Link href={`/dashboard/therapist/patients/${p.id}`} className="font-semibold text-green-700 hover:underline">
                          {p.name}
                        </Link>
                      </td>
                      <td className="hidden whitespace-nowrap px-4 py-2.5 text-gray-600 sm:table-cell">{fmtLastActive(p.lastSessionAt)}</td>
                      <td className="hidden px-4 py-2.5 text-gray-600 sm:table-cell">{p.sessionsThisWeek}</td>
                      <td className="px-2 py-2.5 text-gray-600 sm:px-4">
                        <RosterProgress patient={p} />
                      </td>
                      <td className="py-2.5 pl-2 sm:pl-4">
                        <RosterStatusBadge patient={p} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Panel>

        <div className="flex min-h-0 flex-col gap-4 lg:col-span-4">
          <Panel id="tour-attention" className="flex-1" title="Needs attention" scroll>
            {attention.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-400">Everyone is on track.</p>
            ) : (
              <ul className="divide-y divide-gray-50">
                {attention.map((p) => {
                  const reason =
                    p.painStoppedCount > 0
                      ? `${p.painStoppedCount} pain stop${p.painStoppedCount === 1 ? "" : "s"} to review`
                      : p.missedCount > 0
                        ? `${p.missedCount} missed exercise${p.missedCount === 1 ? "" : "s"}`
                        : "No session this week";
                  return (
                    <li key={p.id}>
                      <Link
                        href={`/dashboard/therapist/patients/${p.id}`}
                        className="flex items-center justify-between gap-3 py-2.5 hover:bg-green-50/40"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-gray-900">{p.name}</span>
                          <span className="block truncate text-xs text-gray-500">{reason}</span>
                        </span>
                        <span className="text-green-700">›</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <Panel id="tour-actions" className="shrink-0" title="Quick actions">
            <div className="grid gap-2">
              {[
                { href: "/dashboard/therapist/assign", label: "Assign exercise" },
                { href: "/dashboard/therapist/exercises", label: "Manage exercises" },
                { href: "/dashboard/therapist/programs", label: "Exercise programs" },
              ].map((action) => (
                <Link
                  key={action.href}
                  href={action.href}
                  className="flex items-center justify-between rounded-lg border border-green-100 px-3 py-2 text-sm font-medium text-green-800 transition hover:bg-green-50"
                >
                  {action.label}
                  <span>→</span>
                </Link>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtLastActive(iso: string | null): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
