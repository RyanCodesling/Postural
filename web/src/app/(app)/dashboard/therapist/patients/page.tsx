"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/AuthContext";
import { prescriptionTargetText } from "@/lib/exercises/prescriptionDisplay";

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

  const loadData = async () => {
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
  };

  useEffect(() => {
    loadData();
  }, [user?.id]);

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

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Manage Patients</h1>
          <p className="text-gray-600 mt-1">Manage your patients and sessions.</p>
        </div>
        <button
          onClick={loadData}
          className="flex items-center gap-2 px-4 py-2 bg-green-700 hover:bg-green-800 text-white rounded text-sm font-medium transition"
        >
          <RefreshIcon />
          Refresh
        </button>
      </div>

      <div className="mb-6">
        <div className="relative w-full max-w-sm">
          <svg xmlns="http://www.w3.org/2000/svg" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="currentColor">
            <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
          </svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search patients"
            className="w-full border border-gray-200 rounded-xl pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent transition"
          />
        </div>
      </div>

      <div className="grid gap-4">
        {patients.length === 0 ? (
          <div className="bg-blue-50 border border-blue-200 p-4 rounded text-blue-800">
            <p className="font-semibold mb-1">No patients assigned yet</p>
            <p className="text-sm mb-3">
              The admin will assign patients to you. Check back here once patients are assigned.
            </p>
            <button
              onClick={loadData}
              className="text-blue-600 hover:text-blue-800 font-medium underline"
            >
              Click to refresh
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-gray-500">No patients found matching your search.</div>
        ) : (
          filtered.map((p) => (
            <div key={p.id} className="border border-gray-200 rounded-xl p-4 transition hover:shadow-sm">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="font-semibold text-gray-900">{p.name}</div>
                  <div className="text-sm text-gray-500">{p.email}</div>

                  {p.exercises.length > 0 ? (
                    <div className="mt-3">
                      <div className="text-xs font-medium text-gray-500 mb-1">
                        Assigned Exercises ({p.exercises.length})
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {p.exercises.map((ex) => (
                          <span
                            key={ex.exercise_id}
                            className={`text-xs px-2 py-1 rounded-full font-medium ${statusColor(ex.status)}`}
                          >
                            {ex.name} — {ex.sets}×
                            {prescriptionTargetText({
                              exerciseId: ex.exercise_id,
                              reps: ex.reps,
                              holdSeconds: ex.hold_seconds,
                            })}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 text-xs text-gray-400">No exercises assigned yet</div>
                  )}
                </div>

                <div className="flex gap-2 ml-4 shrink-0">
                  <Link
                    href={`/dashboard/therapist/patients/${p.id}`}
                    className="px-3 py-1 bg-green-700 hover:bg-green-800 text-white rounded text-sm font-medium transition"
                  >
                    View
                  </Link>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
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
