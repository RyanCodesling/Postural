"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/AuthContext";

interface User {
  id: string;
  name: string;
  email: string;
  role: "patient" | "therapist";
  therapistId?: string;
}

interface Exercise {
  id: string;
  name: string;
  description: string;
  duration: number;
  difficulty: "easy" | "medium" | "hard";
}

interface PatientExercise {
  exerciseId: string;
  patientId: string;
  assignedDate: string;
  status: "pending" | "in-progress" | "completed";
}

interface SessionData {
  date: string;
  duration: number;
  notes: string;
}

export default function PatientDetailPage() {
  const router = useRouter();
  const params = useParams();
  const patientId = params?.id as string;
  const { user } = useAuth();

  const [patient, setPatient] = useState<User | null>(null);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [assignedExercises, setAssignedExercises] = useState<PatientExercise[]>([]);
  const [availableExercises, setAvailableExercises] = useState<Exercise[]>([]);
  const [sessions, setSessions] = useState<SessionData[]>([]);
  const [showAssignForm, setShowAssignForm] = useState(false);
  const [selectedExerciseId, setSelectedExerciseId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPatientData();
  }, [patientId]);

  const loadPatientData = () => {
    try {
      // Load patient info
      const storedUsers = localStorage.getItem("admin_users");
      if (storedUsers) {
        const users: User[] = JSON.parse(storedUsers);
        const foundPatient = users.find((u) => u.id === patientId);
        setPatient(foundPatient || null);
      }

      // Load exercises
      const storedExercises = localStorage.getItem("admin_exercises");
      if (storedExercises) {
        const exs: Exercise[] = JSON.parse(storedExercises);
        setExercises(exs);
      }

      // Load patient-exercise assignments
      const storedAssignments = localStorage.getItem("patient_exercises");
      if (storedAssignments) {
        const assignments: PatientExercise[] = JSON.parse(storedAssignments);
        const patientAssignments = assignments.filter((a) => a.patientId === patientId);
        setAssignedExercises(patientAssignments);
      }

      // Load sessions
      const storedSessions = localStorage.getItem(`patient_sessions_${patientId}`);
      if (storedSessions) {
        const sess: SessionData[] = JSON.parse(storedSessions);
        setSessions(sess);
      }
    } catch (error) {
      console.error("Error loading patient data:", error);
    }
    setLoading(false);
  };

  useEffect(() => {
    // Update available exercises (those not already assigned)
    const assignedExerciseIds = assignedExercises.map((ae) => ae.exerciseId);
    const available = exercises.filter((ex) => !assignedExerciseIds.includes(ex.id));
    setAvailableExercises(available);
  }, [exercises, assignedExercises]);

  const handleAssignExercise = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedExerciseId) return;

    const newAssignment: PatientExercise = {
      exerciseId: selectedExerciseId,
      patientId: patientId,
      assignedDate: new Date().toISOString().split("T")[0],
      status: "pending",
    };

    const updatedAssignments = [...assignedExercises, newAssignment];
    setAssignedExercises(updatedAssignments);
    localStorage.setItem("patient_exercises", JSON.stringify(updatedAssignments));

    setSelectedExerciseId(null);
    setShowAssignForm(false);
  };

  const handleUnassignExercise = (exerciseId: string) => {
    const updatedAssignments = assignedExercises.filter(
      (a) => a.exerciseId !== exerciseId
    );
    setAssignedExercises(updatedAssignments);
    localStorage.setItem("patient_exercises", JSON.stringify(updatedAssignments));
  };

  const handleUpdateExerciseStatus = (
    exerciseId: string,
    newStatus: "pending" | "in-progress" | "completed"
  ) => {
    const updatedAssignments = assignedExercises.map((a) =>
      a.exerciseId === exerciseId ? { ...a, status: newStatus } : a
    );
    setAssignedExercises(updatedAssignments);
    localStorage.setItem("patient_exercises", JSON.stringify(updatedAssignments));
  };

  const getExerciseName = (exerciseId: string) => {
    return exercises.find((e) => e.id === exerciseId)?.name || "Unknown Exercise";
  };

  const getDifficultyColor = (difficulty: string) => {
    switch (difficulty) {
      case "easy":
        return "text-green-600 bg-green-50";
      case "medium":
        return "text-yellow-600 bg-yellow-50";
      case "hard":
        return "text-red-600 bg-red-50";
      default:
        return "text-gray-600 bg-gray-50";
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "pending":
        return "bg-gray-100";
      case "in-progress":
        return "bg-blue-100";
      case "completed":
        return "bg-green-100";
      default:
        return "bg-gray-100";
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="text-gray-600">Loading patient details...</div>
      </div>
    );
  }

  if (!patient) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="bg-white p-8 rounded shadow text-center">
          <p className="text-gray-600 mb-4">Patient not found</p>
          <Link href="/dashboard/therapist" className="text-blue-600 hover:underline">
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <Link href="/dashboard/therapist" className="text-blue-600 hover:underline mb-4 inline-block">
            ← Back to Dashboard
          </Link>
          <h1 className="text-3xl font-bold text-gray-900">Patient Details</h1>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          {/* Patient Information */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded shadow p-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">{patient.name}</h2>
              <div className="space-y-3">
                <div>
                  <div className="text-sm text-gray-600">Email</div>
                  <div className="font-medium text-gray-900">{patient.email}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-600">Patient ID</div>
                  <div className="font-medium text-gray-900 font-mono text-sm">{patient.id}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-600">Status</div>
                  <div className="inline-block mt-1 px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-medium">
                    Active
                  </div>
                </div>
              </div>
            </div>

            {/* Quick Stats */}
            <div className="bg-white rounded shadow p-6 mt-6">
              <h3 className="font-semibold text-gray-900 mb-4">Quick Stats</h3>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Total Sessions</span>
                  <span className="font-bold text-xl text-gray-900">{sessions.length}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Exercises Assigned</span>
                  <span className="font-bold text-xl text-gray-900">{assignedExercises.length}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Completed</span>
                  <span className="font-bold text-xl text-green-600">
                    {assignedExercises.filter((a) => a.status === "completed").length}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Assigned Exercises */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded shadow p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold text-gray-900">Assigned Exercises</h2>
                <button
                  onClick={() => setShowAssignForm(!showAssignForm)}
                  className={`px-4 py-2 rounded transition text-white ${
                    showAssignForm
                      ? "bg-gray-600 hover:bg-gray-700"
                      : "bg-blue-600 hover:bg-blue-700"
                  }`}
                >
                  {showAssignForm ? "Cancel" : "+ Assign Exercise"}
                </button>
              </div>

              {/* Assign Exercise Form */}
              {showAssignForm && (
                <form onSubmit={handleAssignExercise} className="bg-blue-50 p-4 rounded mb-6 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Select Exercise
                    </label>
                    {availableExercises.length === 0 ? (
                      <p className="text-gray-600 text-sm">All exercises are already assigned.</p>
                    ) : (
                      <select
                        value={selectedExerciseId || ""}
                        onChange={(e) => setSelectedExerciseId(e.target.value || null)}
                        className="w-full border border-gray-300 rounded px-3 py-2"
                        required
                      >
                        <option value="">-- Select an exercise --</option>
                        {availableExercises.map((ex) => (
                          <option key={ex.id} value={ex.id}>
                            {ex.name} ({ex.difficulty})
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  {selectedExerciseId && (
                    <div className="bg-white p-3 rounded border border-blue-200">
                      {exercises.find((e) => e.id === selectedExerciseId) && (
                        <>
                          <div className="font-medium text-gray-900">
                            {exercises.find((e) => e.id === selectedExerciseId)?.name}
                          </div>
                          <div className="text-sm text-gray-600 mt-1">
                            {exercises.find((e) => e.id === selectedExerciseId)?.description}
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={!selectedExerciseId}
                    className="w-full px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white rounded transition"
                  >
                    Assign Exercise
                  </button>
                </form>
              )}

              {/* Exercises List */}
              {assignedExercises.length === 0 ? (
                <div className="bg-gray-50 p-6 rounded text-center text-gray-600">
                  No exercises assigned yet. Click "Assign Exercise" to add one.
                </div>
              ) : (
                <div className="space-y-3">
                  {assignedExercises.map((assignment) => {
                    const exercise = exercises.find((e) => e.id === assignment.exerciseId);
                    if (!exercise) return null;

                    return (
                      <div
                        key={assignment.exerciseId}
                        className={`p-4 rounded border-l-4 ${getStatusColor(assignment.status)}`}
                      >
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <h3 className="font-semibold text-gray-900">{exercise.name}</h3>
                            <p className="text-sm text-gray-600 mt-1">{exercise.description}</p>
                            <div className="flex gap-3 mt-3">
                              <span className={`px-2 py-1 text-xs font-medium rounded ${getDifficultyColor(exercise.difficulty)}`}>
                                {exercise.difficulty.charAt(0).toUpperCase() + exercise.difficulty.slice(1)}
                              </span>
                              <span className="text-xs text-gray-600">⏱ {exercise.duration}s</span>
                              <span className="text-xs text-gray-600">Assigned: {assignment.assignedDate}</span>
                            </div>
                          </div>
                          <div className="flex gap-2 ml-4">
                            <span
                              className={`px-3 py-1 text-sm font-medium rounded inline-block ${
                                assignment.status === "pending"
                                  ? "bg-gray-100 text-gray-700"
                                  : assignment.status === "in-progress"
                                  ? "bg-blue-100 text-blue-700"
                                  : "bg-green-100 text-green-700"
                              }`}
                            >
                              {assignment.status.charAt(0).toUpperCase() +
                                assignment.status.slice(1).replace("-", " ")}
                            </span>
                            <button
                              onClick={() => handleUnassignExercise(assignment.exerciseId)}
                              className="px-3 py-1 text-sm bg-red-100 hover:bg-red-200 text-red-700 rounded transition"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Sessions & Progress */}
        <div className="bg-white rounded shadow p-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">Session History</h2>

          {sessions.length === 0 ? (
            <div className="bg-blue-50 border border-blue-200 p-6 rounded text-center text-blue-800">
              <p className="font-semibold mb-2">No sessions yet</p>
              <p className="text-sm">Sessions will appear here when the patient completes them.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Date</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Duration</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {sessions.map((session, index) => (
                    <tr key={index} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm text-gray-900">{session.date}</td>
                      <td className="px-6 py-4 text-sm text-gray-600">{session.duration} minutes</td>
                      <td className="px-6 py-4 text-sm text-gray-600">{session.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
