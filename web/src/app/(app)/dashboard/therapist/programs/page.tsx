"use client";

import { useState, useEffect } from "react";
import {
  DEFAULT_DISPLAY_HOLD_SECONDS,
  getDisplayHoldSeconds,
  isIsometricExercise,
  prescriptionTargetText,
} from "@/lib/exercises/prescriptionDisplay";

interface Exercise {
  id: string;
  name: string;
  description: string;
  is_custom: boolean;
}

interface ProgramExercise {
  id?: number;
  exerciseId?: string | null;
  name: string;
  description?: string | null;
  isCustom: boolean;
  sets?: number | null;
  reps?: number | null;
  restSeconds?: number | null;
  holdSeconds?: number | null;
}

interface ExerciseProgram {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  exercises: ProgramExercise[];
}

type ExerciseParams = {
  sets?: number;
  reps?: number;
  restSeconds?: number;
  holdSeconds?: number;
};

export default function ExerciseProgramsPage() {
  const [programs, setPrograms] = useState<ExerciseProgram[]>([]);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [addingCustom, setAddingCustom] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Program form state
  const [programName, setProgramName] = useState("");
  const [selectedExercises, setSelectedExercises] = useState<Set<string>>(new Set());
  const [exerciseParams, setExerciseParams] = useState<Record<string, ExerciseParams>>({});

  // Custom exercise form state
  const [customName, setCustomName] = useState("");
  const [customDesc, setCustomDesc] = useState("");
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [showSuccessModal,  setShowSuccessModal]  = useState(false);
  const [successMsg,        setSuccessMsg]        = useState("");
  const [showErrorModal,    setShowErrorModal]    = useState(false);
  const [errorMsg,          setErrorMsg]          = useState("");
  const [errorTitle,        setErrorTitle]        = useState("");
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [confirmDeleteId,   setConfirmDeleteId]   = useState<string | null>(null);

  // Custom exercise inline edit/delete state
  const [editingCustomId, setEditingCustomId] = useState<string | null>(null);
  const [editCustomDesc, setEditCustomDesc] = useState("");
  const [savingCustom, setSavingCustom] = useState(false);

  // Styled modal states for custom exercise deletion
  const [showConfirmDeleteCustom, setShowConfirmDeleteCustom] = useState(false);
  const [confirmDeleteCustomId, setConfirmDeleteCustomId] = useState<string | null>(null);
  const [confirmDeleteCustomName, setConfirmDeleteCustomName] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [exRes, tmplRes] = await Promise.all([
        fetch("/api/exercises"),
        fetch("/api/programs"),
      ]);
      if (exRes.ok) {
        const d = await exRes.json();
        setExercises(d.exercises ?? []);
      }
      if (tmplRes.ok) {
        const d = await tmplRes.json();
        setPrograms(d.programs ?? []);
      }
    } catch (err) {
      console.error("Error loading data:", err);
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setProgramName("");
    setSelectedExercises(new Set());
    setExerciseParams({});
    setShowForm(false);
    setEditingId(null);
  };

  const resetCustomForm = () => {
    setCustomName("");
    setCustomDesc("");
  };

  const handleToggleExercise = (exerciseId: string) => {
    setSelectedExercises((prev) => {
      const next = new Set(prev);
      if (next.has(exerciseId)) {
        next.delete(exerciseId);
        setExerciseParams((p) => {
          const copy = { ...p };
          delete copy[exerciseId];
          return copy;
        });
      } else {
        next.add(exerciseId);
      }
      return next;
    });
  };

  const handleAddCustomExercise = async () => {
    if (!customName.trim()) {
      setErrorTitle("Required Fields"); setErrorMsg("Exercise name is required."); setShowErrorModal(true); return;
    }
    if (!customDesc.trim()) {
      setErrorTitle("Required Fields"); setErrorMsg("Description is required."); setShowErrorModal(true); return;
    }

    setAddingCustom(true);
    try {
      const res = await fetch("/api/exercises", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: customName.trim(),
          description: customDesc.trim(),
          isCustom: true,
        }),
      });

      if (!res.ok) {
        const d = await res.json();
        setErrorTitle("Something Went Wrong"); setErrorMsg(d.error ?? "Failed to add custom exercise."); setShowErrorModal(true); return;
      }

      const { exercise } = await res.json();
      setExercises((prev) => [...prev, exercise]);
      resetCustomForm();
      setShowCustomForm(false);
      setSuccessMsg(`"${exercise.name}" added to your custom exercises.`);
      setShowSuccessModal(true);
    } catch (err) {
      console.error("Error adding custom exercise:", err);
      setErrorTitle("Something Went Wrong"); setErrorMsg("Failed to add custom exercise."); setShowErrorModal(true);
    } finally {
      setAddingCustom(false);
    }
  };

  const buildExercisePayload = () => {
    const result: {
      exerciseId: string;
      name: string;
      description: string;
      isCustom: boolean;
      sets?: number;
      reps?: number;
      restSeconds: number;
      holdSeconds?: number;
    }[] = [];

    selectedExercises.forEach((exId) => {
      const ex = exercises.find((e) => e.id === exId);
      if (!ex) return;
      const p = exerciseParams[exId] ?? {};
      const isIsometric = isIsometricExercise(ex.id);
      const restSeconds = p.restSeconds == null || p.restSeconds < 0 ? 60 : p.restSeconds;
      result.push({
        exerciseId: ex.id,
        name: ex.name,
        description: ex.description,
        isCustom: ex.is_custom,
        sets: p.sets,
        reps: isIsometric ? undefined : p.reps,
        restSeconds,
        holdSeconds: isIsometric ? getDisplayHoldSeconds(p.holdSeconds) : undefined,
      });
    });

    return result;
  };

  const handleSave = async () => {
    if (!programName.trim()) {
      setErrorTitle("Required Fields"); setErrorMsg("Please enter a program name."); setShowErrorModal(true); return;
    }
    const exPayload = buildExercisePayload();
    if (exPayload.length === 0) {
      setErrorTitle("Required Fields"); setErrorMsg("Please select at least one exercise."); setShowErrorModal(true); return;
    }

    setSaving(true);
    try {
      const wasEditing = !!editingId;
      const body = { name: programName.trim(), exercises: exPayload };
      const res = editingId
        ? await fetch(`/api/programs/${editingId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : await fetch("/api/programs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });

      if (!res.ok) {
        const d = await res.json();
        setErrorTitle("Something Went Wrong"); setErrorMsg(d.error ?? "Failed to save program."); setShowErrorModal(true); return;
      }

      resetForm();
      await loadData();
      setSuccessMsg(wasEditing ? "Program updated successfully." : "Program created successfully.");
      setShowSuccessModal(true);
    } catch (err) {
      console.error("Error saving program:", err);
      setErrorTitle("Something Went Wrong"); setErrorMsg("Failed to save program."); setShowErrorModal(true);
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (program: ExerciseProgram) => {
    setEditingId(program.id);
    setProgramName(program.name);

    const selected = new Set<string>();
    const params: Record<string, ExerciseParams> = {};

    program.exercises.forEach((ex) => {
      if (ex.exerciseId) {
        selected.add(ex.exerciseId);
        params[ex.exerciseId] = {
          sets: ex.sets ?? undefined,
          reps: ex.reps ?? undefined,
          restSeconds: ex.restSeconds ?? undefined,
          holdSeconds: ex.holdSeconds ?? undefined,
        };
      }
    });

    setSelectedExercises(selected);
    setExerciseParams(params);
    setShowForm(true);
  };

  const handleDelete = (id: string) => {
    setConfirmDeleteId(id);
    setShowConfirmDelete(true);
  };

  const handleConfirmDeleteProgram = async () => {
    if (!confirmDeleteId) return;
    setShowConfirmDelete(false);
    try {
      const res = await fetch(`/api/programs/${confirmDeleteId}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json();
        setErrorTitle("Something Went Wrong"); setErrorMsg(d.error ?? "Failed to delete program."); setShowErrorModal(true); return;
      }
      setPrograms((prev) => prev.filter((p) => p.id !== confirmDeleteId));
      setSuccessMsg("Program deleted successfully.");
      setShowSuccessModal(true);
    } catch (err) {
      console.error("Error deleting program:", err);
      setErrorTitle("Something Went Wrong"); setErrorMsg("Failed to delete program."); setShowErrorModal(true);
    } finally {
      setConfirmDeleteId(null);
    }
  };

  const startEditCustom = (ex: Exercise) => {
    setEditingCustomId(ex.id);
    setEditCustomDesc(ex.description);
  };

  const cancelEditCustom = () => {
    setEditingCustomId(null);
    setEditCustomDesc("");
  };

  const handleSaveCustomExercise = async (id: string) => {
    if (!editCustomDesc.trim()) return;
    const original = exercises.find((e) => e.id === id);
    if (!original) return;
    setSavingCustom(true);
    try {
      const res = await fetch(`/api/exercises/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: original.name, description: editCustomDesc.trim() }),
      });
      if (res.ok) {
        const { exercise } = await res.json();
        setExercises((prev) => prev.map((e) => (e.id === id ? { ...e, ...exercise } : e)));
        cancelEditCustom();
        setSuccessMsg(`"${original.name}" updated successfully.`);
        setShowSuccessModal(true);
      } else {
        const d = await res.json();
        setErrorTitle("Failed to Save"); setErrorMsg(d.error ?? "Could not save custom exercise."); setShowErrorModal(true);
      }
    } catch (err) {
      console.error("Error saving custom exercise:", err);
      setErrorTitle("Something Went Wrong"); setErrorMsg("Failed to save custom exercise."); setShowErrorModal(true);
    } finally {
      setSavingCustom(false);
    }
  };

  const handleDeleteCustomExerciseClick = (id: string, name: string) => {
    setConfirmDeleteCustomId(id);
    setConfirmDeleteCustomName(name);
    setShowConfirmDeleteCustom(true);
  };

  const handleConfirmDeleteCustomExercise = async () => {
    if (!confirmDeleteCustomId) return;
    setShowConfirmDeleteCustom(false);
    try {
      const res = await fetch(`/api/exercises/${confirmDeleteCustomId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setExercises((prev) => prev.filter((e) => e.id !== confirmDeleteCustomId));
        // Remove from selected set as well if it was checked
        setSelectedExercises((prev) => {
          const next = new Set(prev);
          next.delete(confirmDeleteCustomId);
          return next;
        });
        setSuccessMsg(`"${confirmDeleteCustomName}" deleted successfully.`);
        setShowSuccessModal(true);
      } else {
        const d = await res.json();
        setErrorTitle("Failed to Delete"); setErrorMsg(d.error ?? "Could not delete custom exercise."); setShowErrorModal(true);
      }
    } catch (err) {
      console.error("Error deleting custom exercise:", err);
      setErrorTitle("Something Went Wrong"); setErrorMsg("Failed to delete custom exercise."); setShowErrorModal(true);
    } finally {
      setConfirmDeleteCustomId(null);
      setConfirmDeleteCustomName(null);
    }
  };

  const systemExercises = exercises.filter((e) => !e.is_custom);
  const customExercises = exercises.filter((e) => e.is_custom);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12 text-gray-500">
        Loading programs...
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Exercise Program</h1>
          <p className="text-gray-600 mt-1">Create and manage reusable exercise programs.</p>
        </div>
      </div>

      {/* Create / Edit form */}
      {showForm ? (
        <div className="bg-white rounded-2xl border border-green-100 p-6 mb-8">
          <h2 className="text-green-700 font-semibold text-lg mb-6">
            {editingId ? "Edit Program" : "Create New Program"}
          </h2>

          {/* Program name */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Program Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={programName}
              onChange={(e) => setProgramName(e.target.value)}
              placeholder="e.g., Lower Body Strengthening"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
            />
          </div>

          {/* System exercises */}
          <div className="mb-8">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">
              System Exercises ({systemExercises.length})
            </h3>
            {systemExercises.length === 0 ? (
              <p className="text-gray-400 text-sm">No system exercises available.</p>
            ) : (
              <div className="space-y-3">
                {systemExercises.map((ex) => {
                  const checked = selectedExercises.has(ex.id);
                  const p = exerciseParams[ex.id] ?? {};
                  const isIsometric = isIsometricExercise(ex.id);
                  return (
                    <div
                      key={ex.id}
                      className={`rounded-xl border p-4 transition ${
                        checked ? "border-green-300 bg-green-50" : "border-gray-200"
                      }`}
                    >
                      <label className="flex items-start gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => handleToggleExercise(ex.id)}
                          className="mt-1 w-4 h-4 accent-green-600"
                        />
                        <div className="flex-1">
                          <p className="font-medium text-gray-900 text-sm">
                            {ex.name}
                            <span className="ml-2 text-xs text-gray-400">{ex.id}</span>
                          </p>
                          <p className="text-xs text-gray-500 mt-0.5">{ex.description}</p>
                        </div>
                      </label>

                      {checked && (
                        <div className="mt-3 grid grid-cols-3 gap-3 pl-7">
                          <div>
                            <label className="block text-xs text-gray-500 mb-1">Sets</label>
                            <input
                              type="number"
                              min={1}
                              value={p.sets ?? ""}
                              onChange={(e) =>
                                setExerciseParams((prev) => ({
                                  ...prev,
                                  [ex.id]: {
                                    ...prev[ex.id],
                                    sets: e.target.value ? Number(e.target.value) : undefined,
                                  },
                                }))
                              }
                              placeholder="e.g. 3"
                              className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
                            />
                          </div>
                          {isIsometric ? (
                            <div>
                              <label className="block text-xs text-gray-500 mb-1">Hold (sec)</label>
                              <input
                                type="number"
                                min={1}
                                value={p.holdSeconds ?? ""}
                                onChange={(e) =>
                                  setExerciseParams((prev) => ({
                                    ...prev,
                                    [ex.id]: {
                                      ...prev[ex.id],
                                      holdSeconds: e.target.value ? Number(e.target.value) : undefined,
                                    },
                                  }))
                                }
                                placeholder={`${DEFAULT_DISPLAY_HOLD_SECONDS}`}
                                className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
                              />
                            </div>
                          ) : (
                            <div>
                              <label className="block text-xs text-gray-500 mb-1">Reps</label>
                              <input
                                type="number"
                                min={1}
                                value={p.reps ?? ""}
                                onChange={(e) =>
                                  setExerciseParams((prev) => ({
                                    ...prev,
                                    [ex.id]: {
                                      ...prev[ex.id],
                                      reps: e.target.value ? Number(e.target.value) : undefined,
                                    },
                                  }))
                                }
                                placeholder="e.g. 12"
                                className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
                              />
                            </div>
                          )}
                          <div>
                            <label className="block text-xs text-gray-500 mb-1">Rest (sec)</label>
                            <input
                              type="number"
                              min={0}
                              value={p.restSeconds ?? ""}
                              onChange={(e) =>
                                setExerciseParams((prev) => ({
                                  ...prev,
                                  [ex.id]: {
                                    ...prev[ex.id],
                                    restSeconds: e.target.value ? Number(e.target.value) : undefined,
                                  },
                                }))
                              }
                              placeholder="60"
                              className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Custom exercises already in DB */}
          {customExercises.length > 0 && (
            <div className="mb-8">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">
                Custom Exercises ({customExercises.length})
              </h3>
              <div className="space-y-3">
                {customExercises.map((ex) => {
                  const checked = selectedExercises.has(ex.id);
                  const p = exerciseParams[ex.id] ?? {};
                  const isIsometric = isIsometricExercise(ex.id);
                  return (
                    <div
                      key={ex.id}
                      className={`rounded-xl border p-4 transition ${
                        checked ? "border-green-300 bg-green-50" : "border-gray-200"
                      }`}
                    >
                      <label className="flex items-start gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => handleToggleExercise(ex.id)}
                          className="mt-1 w-4 h-4 accent-green-600"
                        />
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-gray-900 text-sm">{ex.name}</p>
                            <span className="px-1.5 py-0.5 bg-green-100 text-green-700 text-xs rounded-full">
                              custom
                            </span>
                            <span className="text-xs text-gray-400">{ex.id}</span>
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5">{ex.description}</p>
                        </div>
                      </label>

                      {checked && (
                        <div className="mt-3 grid grid-cols-3 gap-3 pl-7">
                          <div>
                            <label className="block text-xs text-gray-500 mb-1">Sets</label>
                            <input
                              type="number"
                              min={1}
                              value={p.sets ?? ""}
                              onChange={(e) =>
                                setExerciseParams((prev) => ({
                                  ...prev,
                                  [ex.id]: {
                                    ...prev[ex.id],
                                    sets: e.target.value ? Number(e.target.value) : undefined,
                                  },
                                }))
                              }
                              placeholder="e.g. 3"
                              className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
                            />
                          </div>
                          {isIsometric ? (
                            <div>
                              <label className="block text-xs text-gray-500 mb-1">Hold (sec)</label>
                              <input
                                type="number"
                                min={1}
                                value={p.holdSeconds ?? ""}
                                onChange={(e) =>
                                  setExerciseParams((prev) => ({
                                    ...prev,
                                    [ex.id]: {
                                      ...prev[ex.id],
                                      holdSeconds: e.target.value ? Number(e.target.value) : undefined,
                                    },
                                  }))
                                }
                                placeholder={`${DEFAULT_DISPLAY_HOLD_SECONDS}`}
                                className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
                              />
                            </div>
                          ) : (
                            <div>
                              <label className="block text-xs text-gray-500 mb-1">Reps</label>
                              <input
                                type="number"
                                min={1}
                                value={p.reps ?? ""}
                                onChange={(e) =>
                                  setExerciseParams((prev) => ({
                                    ...prev,
                                    [ex.id]: {
                                      ...prev[ex.id],
                                      reps: e.target.value ? Number(e.target.value) : undefined,
                                    },
                                  }))
                                }
                                placeholder="e.g. 12"
                                className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
                              />
                            </div>
                          )}
                          <div>
                            <label className="block text-xs text-gray-500 mb-1">Rest (sec)</label>
                            <input
                              type="number"
                              min={0}
                              value={p.restSeconds ?? ""}
                              onChange={(e) =>
                                setExerciseParams((prev) => ({
                                  ...prev,
                                  [ex.id]: {
                                    ...prev[ex.id],
                                    restSeconds: e.target.value ? Number(e.target.value) : undefined,
                                  },
                                }))
                              }
                              placeholder="60"
                              className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Save / Cancel */}
          <div className="flex gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="w-40 h-10 flex items-center justify-center bg-green-700 hover:bg-green-800 disabled:bg-gray-300 text-white text-sm font-medium rounded-lg transition"
            >
              {saving ? "Saving..." : editingId ? "Update Program" : "Create Program"}
            </button>
            <button
              onClick={resetForm}
              className="w-40 h-10 flex items-center justify-center border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-3 mb-8">
          <button
            onClick={() => { setShowForm(true); setShowCustomForm(false); }}
            className="w-60 h-10 flex items-center justify-center bg-green-700 hover:bg-green-800 text-white text-sm font-medium rounded-lg transition"
          >
            + Create New Program
          </button>
          <button
            onClick={() => setShowCustomForm((v) => !v)}
            className="w-60 h-10 flex items-center justify-center border border-green-700 text-green-700 hover:bg-green-50 text-sm font-medium rounded-lg transition"
          >
            {showCustomForm ? "✕ Cancel" : "+ Add New Custom Exercise"}
          </button>
        </div>
      )}

      {/* Standalone custom exercise form */}
      {!showForm && showCustomForm && (
        <div className="bg-white rounded-2xl border border-green-100 p-6 mb-8">
          <h2 className="text-green-700 font-semibold text-lg mb-6">Add New Custom Exercise</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Exercise Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="e.g., Personalized Stretch"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description <span className="text-red-500">*</span>
              </label>
              <textarea
                value={customDesc}
                onChange={(e) => setCustomDesc(e.target.value)}
                placeholder="Describe the exercise..."
                rows={3}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
              />
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleAddCustomExercise}
                disabled={addingCustom}
                className="w-48 h-10 flex items-center justify-center bg-green-700 hover:bg-green-800 disabled:bg-gray-300 text-white text-sm font-medium rounded-lg transition"
              >
                {addingCustom ? "Saving..." : "Add Custom Exercise"}
              </button>
              <button
                type="button"
                onClick={() => { resetCustomForm(); setShowCustomForm(false); }}
                className="w-48 h-10 flex items-center justify-center border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Programs list */}
      <div className="bg-white rounded-2xl border border-green-100 p-6">
        <h2 className="text-green-700 font-semibold text-lg mb-6">
          Your Programs ({programs.length})
        </h2>

        {programs.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-6">
            No programs yet. Click &quot;Create New Program&quot; to get started.
          </p>
        ) : (
          <div className="grid gap-4">
            {programs.map((p) => (
              <div key={p.id} className="rounded-xl border border-gray-100 p-4 transition hover:shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <h3 className="font-semibold text-green-700 text-base">{p.name}</h3>
                    <p className="text-xs text-gray-400 mt-0.5 mb-3">
                      {p.exercises.length} exercise{p.exercises.length !== 1 ? "s" : ""} ·
                      Updated {new Date(p.updatedAt).toLocaleDateString()}
                    </p>

                    {p.exercises.length > 0 && (
                      <div className="mb-4">
                        <div className="text-xs font-medium text-gray-500 mb-2">
                          Exercises ({p.exercises.length})
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {p.exercises.map((ex, i) => {
                            const isIsometric = isIsometricExercise(ex.exerciseId);
                            const hasPrescription = !!(ex.sets || ex.reps || (isIsometric && ex.holdSeconds));
                            return (
                              <span
                                key={i}
                                className="text-xs px-2 py-1 rounded-full font-medium bg-green-50 text-green-600 border border-green-200"
                              >
                                {ex.name}
                                {hasPrescription && (
                                  <>
                                    {" — "}
                                    {ex.sets ? `${ex.sets}×` : ""}
                                    {prescriptionTargetText({
                                      exerciseId: ex.exerciseId,
                                      reps: ex.reps,
                                      holdSeconds: ex.holdSeconds,
                                    })}
                                  </>
                                )}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2 ml-4 shrink-0">
                    <button
                      onClick={() => handleEdit(p)}
                      className="px-3 py-1.5 text-sm border border-green-700 text-green-700 rounded-lg hover:bg-green-50 transition"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(p.id)}
                      className="px-3 py-1.5 text-sm border border-red-300 text-red-600 rounded-lg hover:bg-red-50 transition"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Your Custom Exercises */}
      <div className="bg-white rounded-2xl border border-green-100 p-6 mt-8">
        <h2 className="text-green-700 font-semibold text-lg mb-6">
          Your Custom Exercises ({customExercises.length})
        </h2>
        {customExercises.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-6">
            No custom exercises yet. Click &quot;+ Add New Custom Exercise&quot; to create one.
          </p>
        ) : (
          <div className="grid gap-4">
            {customExercises.map((ex) => {
              const isEditingCustom = editingCustomId === ex.id;
              return (
                <div key={ex.id} className="rounded-xl border border-gray-100 p-4 flex flex-col justify-between">
                  {isEditingCustom ? (
                    <div className="space-y-3 w-full">
                      <div className="font-semibold text-gray-900 text-sm">{ex.name}</div>
                      <textarea
                        value={editCustomDesc}
                        onChange={(e) => setEditCustomDesc(e.target.value)}
                        placeholder="Description"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent transition"
                        rows={3}
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleSaveCustomExercise(ex.id)}
                          disabled={savingCustom}
                          className="px-3 py-1.5 bg-green-700 hover:bg-green-800 disabled:bg-gray-300 text-white text-sm font-medium rounded-lg transition"
                        >
                          {savingCustom ? "Saving..." : "Save"}
                        </button>
                        <button
                          onClick={cancelEditCustom}
                          className="px-3 py-1.5 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50 transition"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-semibold text-gray-900 text-sm">{ex.name}</h3>
                          <span className="px-1.5 py-0.5 bg-green-100 text-green-700 text-xs rounded-full font-medium">custom</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">{ex.description}</p>
                      </div>
                      <div className="flex gap-2 ml-4 shrink-0">
                        <button
                          onClick={() => startEditCustom(ex)}
                          className="px-3 py-1.5 text-sm border border-green-700 text-green-700 rounded-lg hover:bg-green-50 transition"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteCustomExerciseClick(ex.id, ex.name)}
                          className="px-3 py-1.5 text-sm border border-red-300 text-red-600 rounded-lg hover:bg-red-50 transition"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Success Modal ─────────────────────────────────────────────────── */}
      {showSuccessModal && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50" onClick={() => setShowSuccessModal(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 text-center">
              <div className="flex items-center justify-center w-12 h-12 rounded-full bg-green-100 mx-auto mb-4">
                <svg className="w-6 h-6 text-green-700" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
              </div>
              <h2 className="text-lg font-bold text-gray-900 mb-1">Success</h2>
              <p className="text-sm text-gray-500 mb-5">{successMsg}</p>
              <button
                onClick={() => setShowSuccessModal(false)}
                className="px-6 py-2 bg-green-700 hover:bg-green-800 text-white text-sm font-medium rounded-lg transition"
              >
                OK
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Error Modal ───────────────────────────────────────────────────── */}
      {showErrorModal && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50" onClick={() => setShowErrorModal(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 text-center">
              <div className="flex items-center justify-center w-12 h-12 rounded-full bg-red-100 mx-auto mb-4">
                <svg className="w-6 h-6 text-red-600" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
              </div>
              <h2 className="text-lg font-bold text-gray-900 mb-1">{errorTitle}</h2>
              <p className="text-sm text-gray-500 mb-5">{errorMsg}</p>
              <button
                onClick={() => setShowErrorModal(false)}
                className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition"
              >
                OK
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Confirm Delete Modal ──────────────────────────────────────────── */}
      {showConfirmDelete && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50" onClick={() => setShowConfirmDelete(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 text-center">
              <div className="flex items-center justify-center w-12 h-12 rounded-full bg-red-100 mx-auto mb-4">
                <svg className="w-6 h-6 text-red-600" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
              </div>
              <h2 className="text-lg font-bold text-gray-900 mb-1">Confirm Delete</h2>
              <p className="text-sm text-gray-500 mb-5">Are you sure you want to delete this program? This action cannot be undone.</p>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={() => setShowConfirmDelete(false)}
                  className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmDeleteProgram}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        </>
      )}
      {/* ── Confirm Delete Custom Exercise Modal ─────────────────────────── */}
      {showConfirmDeleteCustom && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50" onClick={() => setShowConfirmDeleteCustom(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 text-center">
              <div className="flex items-center justify-center w-12 h-12 rounded-full bg-red-100 mx-auto mb-4">
                <svg className="w-6 h-6 text-red-600" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
              </div>
              <h2 className="text-lg font-bold text-gray-900 mb-1">Delete Custom Exercise</h2>
              <p className="text-sm text-gray-500 mb-5">
                Are you sure you want to delete <span className="font-semibold text-gray-900">{confirmDeleteCustomName}</span>? This will also remove it from any programs.
              </p>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={() => { setShowConfirmDeleteCustom(false); setConfirmDeleteCustomId(null); setConfirmDeleteCustomName(null); }}
                  className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmDeleteCustomExercise}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
