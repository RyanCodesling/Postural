"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/AuthContext";
import { prescriptionTargetText } from "@/lib/exercises/prescriptionDisplay";
import { FIT_SCREEN, Glyph, PageHeading, Panel, StatTile } from "../../_components/DashboardKit";

interface PatientExercise {
  exercise_id: string;
  name: string;
  status: string;
  sets: number;
  reps: number;
  hold_seconds: number;
}

interface PatientData {
  id: string;
  name: string;
  email: string;
  exercises: PatientExercise[];
}

export default function ManagePatientsPage() {
  const { user } = useAuth();
  const [patients, setPatients] = useState<PatientData[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/users?role=patient&therapistId=${user.id}`);
      if (res.ok) {
        const data = await res.json();
        const users: { id: string; name: string; email: string }[] = data.users ?? [];
        const exResults = await Promise.all(
          users.map((p) =>
            fetch(`/api/patient-exercises?patientId=${p.id}`)
              .then((r) => r.json())
              .then((d) => ({ patientId: p.id, exercises: d.exercises ?? [] }))
              .catch(() => ({ patientId: p.id, exercises: [] }))
          )
        );
        const exMap: Record<string, PatientExercise[]> = {};
        exResults.forEach(({ patientId, exercises }) => { exMap[patientId] = exercises; });
        setPatients(users.map((p) => ({ ...p, exercises: exMap[p.id] ?? [] })));
      }
    } catch (err) {
      console.error("Error loading patients:", err);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    const initialTimeout = window.setTimeout(() => {
      void loadData();
    }, 0);
    return () => clearTimeout(initialTimeout);
  }, [loadData]);

  const statusColor = (s: string) =>
    s === "completed" ? "bg-green-100 text-green-700 border border-green-200"
    : s === "in_progress" ? "bg-green-50 text-green-600 border border-green-200"
    : "bg-green-50 text-green-600 border border-green-100";

  const filtered = patients.filter((p) =>
    p.name.toLowerCase().includes(query.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12 text-gray-500">
        Loading patients...
      </div>
    );
  }

  const withExercises = patients.filter((p) => p.exercises.length > 0).length;
  const totalPrescriptions = patients.reduce((n, p) => n + p.exercises.length, 0);

  return (
    <div className={FIT_SCREEN}>
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-3">
        <PageHeading title="Manage Patients" subtitle="Manage your patients and sessions." />
        <button
          onClick={loadData}
          className="flex items-center gap-2 rounded-lg bg-green-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-green-800"
        >
          <RefreshIcon />
          Refresh
        </button>
      </div>

      <div id="tour-tiles" className="grid shrink-0 grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Patients" value={patients.length} icon={Glyph.users} tone="green" />
        <StatTile label="With exercises" value={withExercises} icon={Glyph.dumbbell} tone="teal" />
        <StatTile label="No exercises yet" value={patients.length - withExercises} icon={Glyph.alert} tone={patients.length - withExercises > 0 ? "amber" : "green"} />
        <StatTile label="Prescriptions" value={totalPrescriptions} icon={Glyph.list} tone="lime" />
      </div>

      <Panel
        id="tour-table"
        className="flex-1"
        title={`Patients (${filtered.length})`}
        scroll
        right={
          <div id="tour-search" className="relative w-full max-w-xs">
            <svg xmlns="http://www.w3.org/2000/svg" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" viewBox="0 0 24 24" fill="currentColor">
              <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search patients"
              className="w-full rounded-lg border border-green-200 py-2 pl-9 pr-3 text-sm outline-none transition focus:border-green-500 focus:ring-2 focus:ring-green-100"
            />
          </div>
        }
      >
        {patients.length === 0 ? (
          <div className="rounded-lg bg-green-50 p-5 text-center text-green-900">
            <p className="font-semibold">No patients assigned yet</p>
            <p className="mt-1 text-sm">The admin will assign patients to you. Check back here once patients are assigned.</p>
            <button onClick={loadData} className="mt-3 text-sm font-medium text-green-700 underline">
              Click to refresh
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-500">No patients found matching your search.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-gray-100 text-left text-xs text-gray-400">
                <th className="py-2 pr-4 font-medium">Patient</th>
                <th className="px-4 py-2 font-medium">Assigned exercises</th>
                <th className="py-2 pl-4 text-right font-medium" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} className="border-b border-gray-50 align-top transition hover:bg-green-50/40">
                  <td className="py-3 pr-4">
                    <p className="font-semibold text-gray-900">{p.name}</p>
                    <p className="text-xs text-gray-500">{p.email}</p>
                  </td>
                  <td className="px-4 py-3">
                    {p.exercises.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {p.exercises.map((ex) => (
                          <span key={ex.exercise_id} className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusColor(ex.status)}`}>
                            {ex.name} — {ex.sets}×
                            {prescriptionTargetText({ exerciseId: ex.exercise_id, reps: ex.reps, holdSeconds: ex.hold_seconds })}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400">No exercises assigned yet</span>
                    )}
                  </td>
                  <td className="py-3 pl-4 text-right">
                    <Link
                      href={`/dashboard/therapist/patients/${p.id}`}
                      className="inline-block rounded-lg bg-green-700 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-green-800"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}

function RefreshIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
    </svg>
  );
}
