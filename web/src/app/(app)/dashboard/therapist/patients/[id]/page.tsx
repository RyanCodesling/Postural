"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

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

  const ongoingExercises = exercises.filter(
    (e) => e.status === "pending" || e.status === "in_progress"
  );
  const finishedExercises = exercises.filter((e) => e.status === "completed");

  const progressStatus = () => {
    if (exercises.length === 0) return "not started";
    if (finishedExercises.length === exercises.length) return "completed";
    if (exercises.some((e) => e.status === "in_progress")) return "in progress";
    if (finishedExercises.length > 0) return "progressing";
    return "not started";
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-500">Loading patient profile...</div>
      </div>
    );
  }

  if (!patient) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-gray-600 mb-4">Patient not found.</p>
          <Link href="/dashboard/therapist" className="text-green-700 hover:underline">
            ← Back to Patients
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 px-8 py-8 max-w-5xl mx-auto">

      {/* Back link */}
      <Link
        href="/dashboard/therapist"
        className="inline-flex items-center gap-1 text-sm text-green-700 hover:text-green-800 mb-6"
      >
        ← Back to Patients
      </Link>

      {/* Header */}
      <h1 className="text-4xl font-bold text-green-800">Patient Profile</h1>
      <p className="text-gray-500 mt-1 mb-8">{patient.name}</p>

      {/* Personal Information */}
      <div className="bg-white rounded-2xl border border-green-100 p-6 mb-6">
        <h2 className="text-green-700 font-semibold text-lg mb-6">Personal Information</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

          <div className="flex items-start gap-3">
            <span className="text-green-600 text-lg">👤</span>
            <div>
              <p className="text-xs text-gray-400">Full Name</p>
              <p className="font-semibold text-gray-900">{patient.name}</p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <span className="text-green-600 text-lg">👤</span>
            <div>
              <p className="text-xs text-gray-400">Age</p>
              <p className="font-semibold text-gray-900">
                {patient.age ? `${patient.age} years old` : "N/A"}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <span className="text-green-600 text-lg">✉️</span>
            <div>
              <p className="text-xs text-gray-400">Email</p>
              <p className="font-semibold text-gray-900">{patient.email || "N/A"}</p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <span className="text-green-600 text-lg">📊</span>
            <div>
              <p className="text-xs text-gray-400">Progress Status</p>
              <span className="inline-block mt-1 px-3 py-1 bg-green-100 text-green-700 text-xs rounded-full font-medium">
                {progressStatus()}
              </span>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <span className="text-green-600 text-lg">👤</span>
            <div>
              <p className="text-xs text-gray-400">Assigned Specialist</p>
              <p className="font-semibold text-gray-900">
                {patient.therapistName || "Not assigned"}
              </p>
            </div>
          </div>

        </div>
      </div>

      {/* Ongoing Exercises */}
      <div className="bg-white rounded-2xl border border-green-100 p-6 mb-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-green-700 font-semibold text-lg">Ongoing Exercises</h2>
          <button className="px-4 py-2 bg-green-700 hover:bg-green-800 text-white text-sm font-medium rounded-lg transition">
            View Patient Progress
          </button>
        </div>

        {ongoingExercises.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-6">No ongoing exercises.</p>
        ) : (
          <div className="space-y-4">
            {ongoingExercises.map((ex) => (
              <div
                key={ex.exercise_id}
                className="rounded-xl border border-gray-100 p-4 flex justify-between items-center"
              >
                <div>
                  <h3 className="font-semibold text-green-700">{ex.name}</h3>
                  <p className="text-sm text-gray-500 mt-1">
                    {ex.sets} sets × {ex.reps} reps
                  </p>
                  <span className="inline-block mt-2 px-3 py-1 bg-blue-50 text-blue-600 text-xs rounded-full">
                    {ex.status === "in_progress" ? "In Progress" : "Pending"}
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

      {/* Finished Exercises */}
      <div className="bg-white rounded-2xl border border-green-100 p-6 mb-6">
        <h2 className="text-green-700 font-semibold text-lg mb-6">Finished Exercises</h2>

        {finishedExercises.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-6">No completed exercises yet.</p>
        ) : (
          <div className="space-y-4">
            {finishedExercises.map((ex) => (
              <div
                key={ex.exercise_id}
                className="rounded-xl border border-gray-100 p-4 flex justify-between items-center"
              >
                <div>
                  <h3 className="font-semibold text-gray-800">{ex.name}</h3>
                  <p className="text-sm text-gray-500 mt-1">
                    {ex.sets} sets × {ex.reps} reps
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
