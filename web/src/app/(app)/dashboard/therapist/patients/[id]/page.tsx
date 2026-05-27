"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { prescriptionTargetText } from "@/lib/exercises/prescriptionDisplay";

interface Patient {
  id: string;
  name: string;
  email?: string;
  age?: number;
  gender?: string;
  diagnosis?: string;
  prescription?: string;
  condition?: string;
  therapistId?: string;
  therapistName?: string;
}

interface PatientExercise {
  exercise_id: string;
  name: string;
  description: string;
  status: "pending" | "in_progress" | "completed";
  sets: number;
  reps: number;
  rest_seconds: number;
  hold_seconds: number;
  assigned_date: string;
}

export default function PatientDetailPage() {
  const params = useParams();
  const patientId = params?.id as string;

  const [patient, setPatient] = useState<Patient | null>(null);
  const [exercises, setExercises] = useState<PatientExercise[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!patientId) return;
    loadData();
  }, [patientId]);

  const loadData = async () => {
    try {
      const [patientRes, exercisesRes] = await Promise.all([
        fetch(`/api/users/${patientId}`),
        fetch(`/api/patient-exercises?patientId=${patientId}`),
      ]);

      if (patientRes.ok) {
        const d = await patientRes.json();
        setPatient(d.user);
      }
      if (exercisesRes.ok) {
        const d = await exercisesRes.json();
        setExercises(d.exercises ?? []);
      }
    } catch (err) {
      console.error("Error loading patient data:", err);
    } finally {
      setLoading(false);
    }
  };

  const assignedExercises = exercises.filter(
    (e) => e.status === "pending" || e.status === "in_progress"
  );
const completedExercises = exercises.filter((e) => e.status === "completed");

  const progressStatus = () => {
    if (exercises.length === 0) return "not started";
    if (completedExercises.length === exercises.length) return "completed";
    if (exercises.some((e) => e.status === "in_progress")) return "in progress";
    if (completedExercises.length > 0) return "progressing";
    return "not started";
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12 text-gray-500">
        Loading patient profile...
      </div>
    );
  }

  if (!patient) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="text-center">
          <p className="text-gray-600 mb-4">Patient not found.</p>
          <Link href="/dashboard/therapist/patients" className="text-green-700 hover:underline">
            ← Back to Patients
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-8 py-8">

      {/* Back link */}
      <Link
        href="/dashboard/therapist/patients"
        className="inline-flex items-center gap-1 text-sm text-green-700 hover:text-green-800 mb-6"
      >
        ← Back to Manage Patients
      </Link>

      {/* Header */}
      <h1 className="text-4xl font-bold text-green-800">Patient Profile</h1>
      <p className="text-gray-500 mt-1 mb-8">{patient.name}</p>

      {/* Personal Information */}
      <div className="bg-white rounded-2xl border border-green-100 p-6 mb-6">
        <h2 className="text-green-700 font-semibold text-lg mb-6">Personal Information</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

          <div className="flex items-start gap-3">
            <div className="mt-0.5 shrink-0 text-green-600"><PersonIcon /></div>
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Full Name</p>
              <p className="text-sm font-semibold text-gray-900">{patient.name}</p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="mt-0.5 shrink-0 text-green-600"><PersonIcon /></div>
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Age</p>
              <p className="text-sm font-semibold text-gray-900">
                {patient.age ? `${patient.age} years old` : "—"}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="mt-0.5 shrink-0 text-green-600"><EmailIcon /></div>
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Email</p>
              <p className="text-sm font-semibold text-gray-900">{patient.email || "—"}</p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="mt-0.5 shrink-0 text-green-600"><TrendingIcon /></div>
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Progress Status</p>
              <span className={`inline-block mt-1 px-3 py-1 text-xs rounded-full font-medium ${
                progressStatus() === "completed"
                  ? "bg-green-100 text-green-700"
                  : progressStatus() === "not started"
                  ? "bg-red-100 text-red-700"
                  : "bg-blue-100 text-blue-700"
              }`}>
                {progressStatus()}
              </span>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="mt-0.5 shrink-0 text-green-600"><PulseIcon /></div>
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Assigned Specialist</p>
              <p className="text-sm font-semibold text-gray-900">
                {patient.therapistName || "—"}
              </p>
            </div>
          </div>

        </div>
      </div>

      {/* Assigned Exercises */}
      <div className="bg-white rounded-2xl border border-green-100 p-6 mb-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-green-700 font-semibold text-lg">Assigned Exercises</h2>
          <button className="px-4 py-2 bg-green-700 hover:bg-green-800 text-white text-sm font-medium rounded-lg transition">
            View Patient Progress
          </button>
        </div>

        {assignedExercises.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-6">No assigned exercises.</p>
        ) : (
          <div className="space-y-4">
            {assignedExercises.map((ex) => (
              <div
                key={ex.exercise_id}
                className="rounded-xl border border-gray-100 p-4 flex justify-between items-center"
              >
                <div>
                  <h3 className="font-semibold text-green-700">{ex.name}</h3>
                  <p className="text-sm text-gray-500 mt-1">
                    {ex.sets} sets ×{" "}
                    {prescriptionTargetText({
                      exerciseId: ex.exercise_id,
                      reps: ex.reps,
                      holdSeconds: ex.hold_seconds,
                    })} · {ex.rest_seconds}s rest
                  </p>
                  <span className={`inline-block mt-2 px-3 py-1 text-xs rounded-full font-medium ${
                    ex.status === "in_progress"
                      ? "bg-blue-100 text-blue-700"
                      : "bg-red-100 text-red-700"
                  }`}>
                    {ex.status === "in_progress" ? "In Progress" : "Not Started"}
                  </span>
                </div>
                <button className="px-4 py-2 border border-green-700 text-green-700 text-sm rounded-lg hover:bg-green-50 transition">
                  View Exercise
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Completed Exercises */}
      <div className="bg-white rounded-2xl border border-green-100 p-6 mb-6">
        <h2 className="text-green-700 font-semibold text-lg mb-6">Completed Exercises</h2>

        {completedExercises.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-6">No completed exercises yet.</p>
        ) : (
          <div className="space-y-4">
            {completedExercises.map((ex) => (
              <div
                key={ex.exercise_id}
                className="rounded-xl border border-gray-100 p-4 flex justify-between items-center"
              >
                <div>
                  <h3 className="font-semibold text-gray-800">{ex.name}</h3>
                  <p className="text-sm text-gray-500 mt-1">
                    {ex.sets} sets ×{" "}
                    {prescriptionTargetText({
                      exerciseId: ex.exercise_id,
                      reps: ex.reps,
                      holdSeconds: ex.hold_seconds,
                    })} · {ex.rest_seconds}s rest
                  </p>
                </div>
                <span className="px-3 py-1 bg-green-100 text-green-700 text-sm rounded-full font-medium">
                  Completed
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Sessions Record */}
      <div className="bg-white rounded-2xl border border-green-100 p-6">
        <h2 className="text-green-700 font-semibold text-lg mb-6">Sessions Record</h2>
        <p className="text-gray-400 text-sm text-center py-6">No sessions recorded</p>
      </div>

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

function TrendingIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
      <path d="M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6z"/>
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
