"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/AuthContext";

interface User {
  id: string;
  name: string;
  email?: string;
  role: "patient" | "therapist";
  therapistId?: string;
  dateOfBirth?: string;
  age?: number;
  gender?: string;
  diagnosis?: string;
  prescription?: string;
  condition?: string;
  therapistIDNum?: string;
  specialty?: string;
}

interface Exercise {
  id: string;
  name: string;
  description: string;
}

interface PatientExercise {
  exerciseId: string;
  patientId: string;
  assignedDate: string;
  status: "pending" | "in-progress" | "completed";
  reps?: number;
  sets?: number;
  weight?: string;
  therapistNotes?: string;
  lastEditedAt?: string;
  editReason?: string;
}

interface SessionData {
  date: string;
  duration: number;
  notes: string;
}

interface TemplateExercise {
  exerciseId?: string;
  name: string;
  description: string;
  isCustom: boolean;
  reps?: number;
  sets?: number;
  weight?: string;
}

interface ExerciseTemplate {
  id: string;
  name: string;
  exercises: TemplateExercise[];
  createdDate: string;
  updatedDate: string;
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
  const [templates, setTemplates] = useState<ExerciseTemplate[]>([]);
  const [showAssignForm, setShowAssignForm] = useState(false);
  const [selectedExerciseId, setSelectedExerciseId] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [templateOverrides, setTemplateOverrides] = useState<Record<string, { reps?: number; sets?: number; weight?: string }>>({});
  const [reps, setReps] = useState<number | "">("");
  const [sets, setSets] = useState<number | "">("");
  const [weight, setWeight] = useState<string>("");
  const [therapistNotes, setTherapistNotes] = useState<string>("");
  const [editMedicalInfo, setEditMedicalInfo] = useState(false);
  const [editedDiagnosis, setEditedDiagnosis] = useState<string>("");
  const [editedPrescription, setEditedPrescription] = useState<string>("");
  const [editedCondition, setEditedCondition] = useState<string>("");

  const [editingAssignmentId, setEditingAssignmentId] = useState<string | null>(null);
  const [editReps, setEditReps] = useState<number | "">("");
  const [editSets, setEditSets] = useState<number | "">("");
  const [editWeight, setEditWeight] = useState<string>("");
  const [editNotes, setEditNotes] = useState<string>("");
  const [editReason, setEditReason] = useState<string>("");

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

      // Load exercise templates
      const storedTemplates = localStorage.getItem("exercise_templates");
      if (storedTemplates) {
        const tmps: ExerciseTemplate[] = JSON.parse(storedTemplates);
        setTemplates(tmps);
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
      reps: reps !== "" ? Number(reps) : undefined,
      sets: sets !== "" ? Number(sets) : undefined,
      weight: weight || undefined,
      therapistNotes: therapistNotes || undefined,
    };

    const updatedAssignments = [...assignedExercises, newAssignment];
    setAssignedExercises(updatedAssignments);
    localStorage.setItem("patient_exercises", JSON.stringify(updatedAssignments));

    setSelectedExerciseId(null);
    setReps("");
    setSets("");
    setWeight("");
    setTherapistNotes("");
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

  const handleStartEditAssignment = (assignment: PatientExercise) => {
    setEditingAssignmentId(assignment.exerciseId);
    setEditReps(assignment.reps ?? "");
    setEditSets(assignment.sets ?? "");
    setEditWeight(assignment.weight ?? "");
    setEditNotes(assignment.therapistNotes ?? "");
    setEditReason("");
  };

  const handleCancelEditAssignment = () => {
    setEditingAssignmentId(null);
    setEditReps("");
    setEditSets("");
    setEditWeight("");
    setEditNotes("");
    setEditReason("");
  };

  const handleSaveEditAssignment = (exerciseId: string) => {
    const updatedAssignments = assignedExercises.map((a) =>
      a.exerciseId === exerciseId
        ? {
            ...a,
            reps: editReps !== "" ? Number(editReps) : undefined,
            sets: editSets !== "" ? Number(editSets) : undefined,
            weight: editWeight || undefined,
            therapistNotes: editNotes || undefined,
            lastEditedAt: new Date().toLocaleString(),
            editReason: editReason || undefined,
          }
        : a
    );
    setAssignedExercises(updatedAssignments);
    localStorage.setItem("patient_exercises", JSON.stringify(updatedAssignments));
    handleCancelEditAssignment();
  };

  const handleApplyTemplate = () => {
    if (!selectedTemplateId) return;

    const template = templates.find((t) => t.id === selectedTemplateId);
    if (!template) return;

    const assignedExerciseIds = new Set(assignedExercises.map((a) => a.exerciseId));

    const newAssignments: PatientExercise[] = template.exercises
      .filter((templateEx) => templateEx.exerciseId && !assignedExerciseIds.has(templateEx.exerciseId))
      .map((templateEx, index) => {
        const key = templateEx.exerciseId || `custom_${index}`;
        const override = templateOverrides[key] || {};

        return {
          exerciseId: templateEx.exerciseId as string,
          patientId: patientId,
          assignedDate: new Date().toISOString().split("T")[0],
          status: "pending",
          reps: override.reps ?? templateEx.reps,
          sets: override.sets ?? templateEx.sets,
          weight: override.weight ?? templateEx.weight,
        };
      });

    if (newAssignments.length === 0) {
      alert(`No new exercises from template "${template.name}" can be added, all items already assigned.`);
      return;
    }

    const updatedAssignments = [...assignedExercises, ...newAssignments];
    setAssignedExercises(updatedAssignments);
    localStorage.setItem("patient_exercises", JSON.stringify(updatedAssignments));

    setSelectedTemplateId("");
    setTemplateOverrides({});
    alert(`${template.name} has been applied! ${newAssignments.length} exercise(s) assigned.`);
  };

  const getExerciseName = (exerciseId: string | undefined) => {
    if (!exerciseId) return "Custom Exercise";
    return exercises.find((e) => e.id === exerciseId)?.name || "Unknown Exercise";
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

  const isTemplateFullyApplied = (template: ExerciseTemplate) => {
    const assignedExerciseIds = new Set(assignedExercises.map((a) => a.exerciseId));

    const zapIds = template.exercises
      .map((ex) => ex.exerciseId)
      .filter((id): id is string => Boolean(id));

    if (zapIds.length === 0) {
      return false;
    }

    return zapIds.every((id) => assignedExerciseIds.has(id));
  };

  const handleEditMedicalInfo = () => {
    setEditedDiagnosis(patient?.diagnosis || "");
    setEditedPrescription(patient?.prescription || "");
    setEditedCondition(patient?.condition || "");
    setEditMedicalInfo(true);
  };

  const handleSaveMedicalInfo = () => {
    if (!patient) return;

    const updatedPatient = {
      ...patient,
      diagnosis: editedDiagnosis,
      prescription: editedPrescription,
      condition: editedCondition,
    };

    setPatient(updatedPatient);

    // Update localStorage
    const storedUsers = localStorage.getItem("admin_users");
    if (storedUsers) {
      const users: User[] = JSON.parse(storedUsers);
      const updatedUsers = users.map((u) => (u.id === patient.id ? updatedPatient : u));
      localStorage.setItem("admin_users", JSON.stringify(updatedUsers));
    }

    setEditMedicalInfo(false);
  };

  const handleCancelEditMedicalInfo = () => {
    setEditMedicalInfo(false);
    setEditedDiagnosis("");
    setEditedPrescription("");
    setEditedCondition("");
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
                  <div className="font-medium text-gray-900">{patient.email || "N/A"}</div>
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

            {/* Medical Information */}
            <div className="bg-white rounded shadow p-6 mt-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-semibold text-gray-900">Medical Information</h3>
                <button
                  onClick={() => {
                    if (editMedicalInfo) {
                      handleCancelEditMedicalInfo();
                    } else {
                      handleEditMedicalInfo();
                    }
                  }}
                  className={`text-sm px-3 py-1 rounded transition ${
                    editMedicalInfo
                      ? "bg-gray-400 hover:bg-gray-500 text-white"
                      : "bg-blue-100 hover:bg-blue-200 text-blue-700"
                  }`}
                >
                  {editMedicalInfo ? "Cancel" : "✏️ Edit"}
                </button>
              </div>

              {editMedicalInfo ? (
                <form className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Diagnosis
                    </label>
                    <textarea
                      value={editedDiagnosis}
                      onChange={(e) => setEditedDiagnosis(e.target.value)}
                      className="w-full border border-gray-300 rounded px-3 py-2"
                      rows={3}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Condition
                    </label>
                    <textarea
                      value={editedCondition}
                      onChange={(e) => setEditedCondition(e.target.value)}
                      className="w-full border border-gray-300 rounded px-3 py-2"
                      rows={3}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Prescription
                    </label>
                    <textarea
                      value={editedPrescription}
                      onChange={(e) => setEditedPrescription(e.target.value)}
                      className="w-full border border-gray-300 rounded px-3 py-2"
                      rows={3}
                    />
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleSaveMedicalInfo}
                      className="flex-1 px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded transition"
                    >
                      Save Changes
                    </button>
                    <button
                      type="button"
                      onClick={handleCancelEditMedicalInfo}
                      className="flex-1 px-3 py-2 bg-gray-400 hover:bg-gray-500 text-white rounded transition"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <div className="space-y-4">
                  <div>
                    <div className="text-sm text-gray-600 mb-1">Diagnosis</div>
                    <div className="bg-gray-50 p-3 rounded text-sm text-gray-900 whitespace-pre-wrap break-words">
                      {patient?.diagnosis || "Not specified"}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-600 mb-1">Condition</div>
                    <div className="bg-gray-50 p-3 rounded text-sm text-gray-900 whitespace-pre-wrap break-words">
                      {patient?.condition || "Not specified"}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-600 mb-1">Prescription</div>
                    <div className="bg-gray-50 p-3 rounded text-sm text-gray-900 whitespace-pre-wrap break-words">
                      {patient?.prescription || "Not specified"}
                    </div>
                  </div>
                </div>
              )}
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
                  {/* Template Selection Section */}
                  <div className="mb-6 p-4 bg-blue-100 border border-blue-300 rounded-lg">
                    <label className="block text-sm font-semibold text-blue-900 mb-3">
                      Or Apply an Exercise Template
                    </label>
                    <div className="flex gap-3 items-end">
                      <div className="flex-1">
                        <select
                          value={selectedTemplateId}
                          onChange={(e) => setSelectedTemplateId(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">-- Select a Template --</option>
                          {templates.map((template) => {
                            const disabled = isTemplateFullyApplied(template);
                            return (
                              <option
                                key={template.id}
                                value={template.id}
                                disabled={disabled}
                              >
                                {template.name} ({template.exercises.length} exercises)
                                {disabled ? " — already applied" : ""}
                              </option>
                            );
                          })}
                        </select>
                      </div>
                      <button
                        type="button"
                        onClick={handleApplyTemplate}
                        disabled={!selectedTemplateId}
                        className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
                      >
                        Apply Template
                      </button>
                    </div>
                    {selectedTemplateId && (
                      <div className="mt-3 p-3 bg-white border border-blue-200 rounded">
                        <p className="text-sm font-medium text-gray-700 mb-2">Preview & adjust settings:</p>
                        <div className="space-y-3">
                          {templates
                            .find((t) => t.id === selectedTemplateId)
                            ?.exercises.map((ex, idx) => {
                              const key = ex.exerciseId || `custom_${idx}`;
                              const override = templateOverrides[key] || {};
                              return (
                                <div key={key} className="p-2 border rounded bg-gray-50">
                                  <div className="font-medium text-gray-800">• {getExerciseName(ex.exerciseId)}</div>
                                  <div className="text-sm text-gray-600 mb-2">{ex.description}</div>
                                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                    <div>
                                      <label className="block text-xs text-gray-500">Reps</label>
                                      <input
                                        type="number"
                                        min={0}
                                        value={override.reps ?? ex.reps ?? ""}
                                        onChange={(e) =>
                                          setTemplateOverrides((prev) => ({
                                            ...prev,
                                            [key]: {
                                              ...prev[key],
                                              reps: e.target.value ? Number(e.target.value) : undefined,
                                            },
                                          }))
                                        }
                                        className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-xs text-gray-500">Sets</label>
                                      <input
                                        type="number"
                                        min={0}
                                        value={override.sets ?? ex.sets ?? ""}
                                        onChange={(e) =>
                                          setTemplateOverrides((prev) => ({
                                            ...prev,
                                            [key]: {
                                              ...prev[key],
                                              sets: e.target.value ? Number(e.target.value) : undefined,
                                            },
                                          }))
                                        }
                                        className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-xs text-gray-500">Weight</label>
                                      <input
                                        type="text"
                                        value={override.weight ?? ex.weight ?? ""}
                                        onChange={(e) =>
                                          setTemplateOverrides((prev) => ({
                                            ...prev,
                                            [key]: {
                                              ...prev[key],
                                              weight: e.target.value || undefined,
                                            },
                                          }))
                                        }
                                        placeholder="e.g., 10kg"
                                        className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                                      />
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Manual Exercise Selection Section */}
                  <div className="border-t-2 border-blue-300 pt-4">
                    <label className="block text-sm font-semibold text-gray-700 mb-3">
                      Or Add Individual Exercises
                    </label>
                  </div>

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
                            {ex.name}
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

                  {selectedExerciseId && (
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Reps
                        </label>
                        <input
                          type="number"
                          value={reps}
                          onChange={(e) => setReps(e.target.value ? parseInt(e.target.value) : "")}
                          className="w-full border border-gray-300 rounded px-3 py-2"
                          placeholder="e.g., 10"
                          min="0"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Sets
                        </label>
                        <input
                          type="number"
                          value={sets}
                          onChange={(e) => setSets(e.target.value ? parseInt(e.target.value) : "")}
                          className="w-full border border-gray-300 rounded px-3 py-2"
                          placeholder="e.g., 3"
                          min="0"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Weight
                        </label>
                        <input
                          type="text"
                          value={weight}
                          onChange={(e) => setWeight(e.target.value)}
                          className="w-full border border-gray-300 rounded px-3 py-2"
                          placeholder="e.g., 10 lbs"
                        />
                      </div>
                    </div>
                  )}

                  {selectedExerciseId && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Notes for Patient
                      </label>
                      <textarea
                        value={therapistNotes}
                        onChange={(e) => setTherapistNotes(e.target.value)}
                        className="w-full border border-gray-300 rounded px-3 py-2"
                        placeholder="Add instructions or notes for the patient..."
                        rows={3}
                      />
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

                    const isEditing = editingAssignmentId === assignment.exerciseId;

                    return (
                      <div
                        key={assignment.exerciseId}
                        className={`p-4 rounded border-l-4 ${getStatusColor(assignment.status)}`}
                      >
                        {isEditing ? (
                          <div className="space-y-3">
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                              <div>
                                <label className="text-xs text-gray-500">Reps</label>
                                <input
                                  type="number"
                                  min={0}
                                  value={editReps}
                                  onChange={(e) => setEditReps(e.target.value ? Number(e.target.value) : "")}
                                  className="w-full border border-gray-300 rounded px-2 py-1"
                                />
                              </div>
                              <div>
                                <label className="text-xs text-gray-500">Sets</label>
                                <input
                                  type="number"
                                  min={0}
                                  value={editSets}
                                  onChange={(e) => setEditSets(e.target.value ? Number(e.target.value) : "")}
                                  className="w-full border border-gray-300 rounded px-2 py-1"
                                />
                              </div>
                              <div>
                                <label className="text-xs text-gray-500">Weight</label>
                                <input
                                  type="text"
                                  value={editWeight}
                                  onChange={(e) => setEditWeight(e.target.value)}
                                  className="w-full border border-gray-300 rounded px-2 py-1"
                                />
                              </div>
                            </div>

                            <div>
                              <label className="text-xs text-gray-500">Notes</label>
                              <textarea
                                value={editNotes}
                                onChange={(e) => setEditNotes(e.target.value)}
                                className="w-full border border-gray-300 rounded px-2 py-1"
                                rows={2}
                              />
                            </div>

                            <div>
                              <label className="text-xs text-gray-500">Reason for edit</label>
                              <textarea
                                value={editReason}
                                onChange={(e) => setEditReason(e.target.value)}
                                className="w-full border border-gray-300 rounded px-2 py-1"
                                rows={2}
                                placeholder="Why did you update this assignment?"
                              />
                            </div>

                            <div className="flex gap-2">
                              <button
                                onClick={() => handleSaveEditAssignment(assignment.exerciseId)}
                                className="px-3 py-1 bg-green-600 text-white rounded"
                              >
                                Save
                              </button>
                              <button
                                onClick={handleCancelEditAssignment}
                                className="px-3 py-1 bg-gray-300 text-gray-700 rounded"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="flex justify-between items-start">
                              <div className="flex-1">
                                <h3 className="font-semibold text-gray-900">{exercise.name}</h3>
                                <p className="text-sm text-gray-600 mt-1">{exercise.description}</p>
                                <div className="flex gap-3 mt-3 flex-wrap">
                                  <span className="text-xs text-gray-600">Assigned: {assignment.assignedDate}</span>
                                  {assignment.reps !== undefined && <span className="text-xs text-gray-600">📊 {assignment.reps} reps</span>}
                                  {assignment.sets !== undefined && <span className="text-xs text-gray-600">📋 {assignment.sets} sets</span>}
                                  {assignment.weight && <span className="text-xs text-gray-600">⚖️ {assignment.weight}</span>}
                                </div>
                                {assignment.therapistNotes && (
                                  <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded">
                                    <div className="text-xs font-medium text-blue-900 mb-1">📝 Therapist Notes:</div>
                                    <div className="text-sm text-blue-700 whitespace-pre-wrap break-words">{assignment.therapistNotes}</div>
                                  </div>
                                )}
                                {assignment.lastEditedAt && (
                                  <div className="mt-3 p-3 bg-gray-50 border border-gray-200 rounded">
                                    <div className="text-xs font-medium text-gray-700 mb-1">✍️ Last Edited</div>
                                    <div className="text-sm text-gray-600">{assignment.lastEditedAt}</div>
                                    {assignment.editReason && (
                                      <div className="text-sm text-gray-600 mt-1">Reason: {assignment.editReason}</div>
                                    )}
                                  </div>
                                )}
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
                                  {assignment.status.charAt(0).toUpperCase() + assignment.status.slice(1).replace("-", " ")}
                                </span>
                                <button
                                  onClick={() => handleStartEditAssignment(assignment)}
                                  className="px-3 py-1 text-sm bg-indigo-100 hover:bg-indigo-200 text-indigo-700 rounded"
                                >
                                  Edit
                                </button>
                                <button
                                  onClick={() => handleUnassignExercise(assignment.exerciseId)}
                                  className="px-3 py-1 text-sm bg-red-100 hover:bg-red-200 text-red-700 rounded"
                                >
                                  Remove
                                </button>
                              </div>
                            </div>
                          </>
                        )}
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
