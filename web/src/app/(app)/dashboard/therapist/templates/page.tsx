"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface Exercise {
  id: string;
  name: string;
  description: string;
  is_custom: boolean;
}

interface TemplateExercise {
  id?: number;
  exerciseId?: string | null;
  name: string;
  description?: string | null;
  isCustom: boolean;
  sets?: number | null;
  reps?: number | null;
}

interface ExerciseTemplate {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  exercises: TemplateExercise[];
}

export default function ExerciseTemplatesPage() {
  const [templates, setTemplates] = useState<ExerciseTemplate[]>([]);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [addingCustom, setAddingCustom] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Template form state
  const [templateName, setTemplateName] = useState("");
  const [selectedExercises, setSelectedExercises] = useState<Set<string>>(new Set());
  const [exerciseParams, setExerciseParams] = useState<
    Record<string, { sets?: number; reps?: number }>
  >({});

  // Custom exercise form state
  const [customName, setCustomName] = useState("");
  const [customDesc, setCustomDesc] = useState("");
  const [customSets, setCustomSets] = useState<number | "">("");
  const [customReps, setCustomReps] = useState<number | "">("");
  const [customError, setCustomError] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [exRes, tmplRes] = await Promise.all([
        fetch("/api/exercises"),
        fetch("/api/templates"),
      ]);
      if (exRes.ok) {
        const d = await exRes.json();
        setExercises(d.exercises ?? []);
      }
      if (tmplRes.ok) {
        const d = await tmplRes.json();
        setTemplates(d.templates ?? []);
      }
    } catch (err) {
      console.error("Error loading data:", err);
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setTemplateName("");
    setSelectedExercises(new Set());
    setExerciseParams({});
    resetCustomForm();
    setShowForm(false);
    setEditingId(null);
  };

  const resetCustomForm = () => {
    setCustomName("");
    setCustomDesc("");
    setCustomSets("");
    setCustomReps("");
    setCustomError("");
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
    setCustomError("");

    if (!customName.trim()) {
      setCustomError("Exercise name is required.");
      return;
    }
    if (!customDesc.trim()) {
      setCustomError("Description is required.");
      return;
    }
    if (!customSets || Number(customSets) < 1) {
      setCustomError("Sets is required (minimum 1).");
      return;
    }
    if (!customReps || Number(customReps) < 1) {
      setCustomError("Reps is required (minimum 1).");
      return;
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
        setCustomError(d.error ?? "Failed to add custom exercise.");
        return;
      }

      const { exercise } = await res.json();

      // Add to exercises list and auto-select with provided sets/reps
      setExercises((prev) => [...prev, exercise]);
      setSelectedExercises((prev) => new Set(prev).add(exercise.id));
      setExerciseParams((prev) => ({
        ...prev,
        [exercise.id]: {
          sets: Number(customSets),
          reps: Number(customReps),
        },
      }));

      resetCustomForm();
    } catch (err) {
      console.error("Error adding custom exercise:", err);
      setCustomError("Failed to add custom exercise.");
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
    }[] = [];

    selectedExercises.forEach((exId) => {
      const ex = exercises.find((e) => e.id === exId);
      if (!ex) return;
      const p = exerciseParams[exId] ?? {};
      result.push({
        exerciseId: ex.id,
        name: ex.name,
        description: ex.description,
        isCustom: ex.is_custom,
        sets: p.sets,
        reps: p.reps,
      });
    });

    return result;
  };

  const handleSave = async () => {
    if (!templateName.trim()) {
      alert("Please enter a template name.");
      return;
    }
    const exPayload = buildExercisePayload();
    if (exPayload.length === 0) {
      alert("Please select at least one exercise.");
      return;
    }

    setSaving(true);
    try {
      const body = { name: templateName.trim(), exercises: exPayload };
      const res = editingId
        ? await fetch(`/api/templates/${editingId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : await fetch("/api/templates", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });

      if (!res.ok) {
        const d = await res.json();
        alert(d.error ?? "Failed to save template.");
        return;
      }

      resetForm();
      await loadData();
    } catch (err) {
      console.error("Error saving template:", err);
      alert("Failed to save template.");
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (template: ExerciseTemplate) => {
    setEditingId(template.id);
    setTemplateName(template.name);

    const selected = new Set<string>();
    const params: Record<string, { sets?: number; reps?: number }> = {};

    template.exercises.forEach((ex) => {
      if (ex.exerciseId) {
        selected.add(ex.exerciseId);
        if (ex.sets != null || ex.reps != null) {
          params[ex.exerciseId] = {
            sets: ex.sets ?? undefined,
            reps: ex.reps ?? undefined,
          };
        }
      }
    });

    setSelectedExercises(selected);
    setExerciseParams(params);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this template?")) return;
    try {
      const res = await fetch(`/api/templates/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json();
        alert(d.error ?? "Failed to delete template.");
        return;
      }
      setTemplates((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      console.error("Error deleting template:", err);
    }
  };

  const systemExercises = exercises.filter((e) => !e.is_custom);
  const customExercises = exercises.filter((e) => e.is_custom);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-500">Loading templates...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 px-8 py-8 max-w-5xl mx-auto">

      <Link
        href="/dashboard/therapist"
        className="inline-flex items-center gap-1 text-sm text-green-700 hover:text-green-800 mb-6"
      >
        ← Back to Dashboard
      </Link>

      <h1 className="text-4xl font-bold text-green-800">Exercise Templates</h1>
      <p className="text-gray-500 mt-1 mb-8">Create and manage reusable exercise templates.</p>

      {/* Create / Edit form */}
      {showForm ? (
        <div className="bg-white rounded-2xl border border-green-100 p-6 mb-8">
          <h2 className="text-green-700 font-semibold text-lg mb-6">
            {editingId ? "Edit Template" : "Create New Template"}
          </h2>

          {/* Template name */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Template Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
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
                        <div className="mt-3 grid grid-cols-2 gap-3 pl-7">
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
                        <div className="mt-3 grid grid-cols-2 gap-3 pl-7">
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
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Add new custom exercise */}
          <div className="mb-8">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Add New Custom Exercise</h3>
            <div className="rounded-xl border border-dashed border-green-300 bg-green-50 p-4">
              <p className="text-xs text-gray-500 mb-4">
                Creates a new exercise and saves it. All fields are required.
              </p>

              {customError && (
                <p className="text-sm text-red-600 mb-3">{customError}</p>
              )}

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
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
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Description <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={customDesc}
                    onChange={(e) => setCustomDesc(e.target.value)}
                    placeholder="Describe the exercise..."
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Sets <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={customSets}
                      onChange={(e) =>
                        setCustomSets(e.target.value ? Number(e.target.value) : "")
                      }
                      placeholder="e.g. 3"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Reps <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={customReps}
                      onChange={(e) =>
                        setCustomReps(e.target.value ? Number(e.target.value) : "")
                      }
                      placeholder="e.g. 12"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
                    />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleAddCustomExercise}
                  disabled={addingCustom}
                  className="w-full px-4 py-2 bg-green-700 hover:bg-green-800 disabled:bg-gray-300 text-white text-sm font-medium rounded-lg transition"
                >
                  {addingCustom ? "Saving..." : "Add Custom Exercise"}
                </button>
              </div>
            </div>
          </div>

          {/* Save / Cancel */}
          <div className="flex gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 px-4 py-2 bg-green-700 hover:bg-green-800 disabled:bg-gray-300 text-white text-sm font-medium rounded-lg transition"
            >
              {saving ? "Saving..." : editingId ? "Update Template" : "Create Template"}
            </button>
            <button
              onClick={resetForm}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowForm(true)}
          className="mb-8 px-5 py-2.5 bg-green-700 hover:bg-green-800 text-white text-sm font-medium rounded-lg transition"
        >
          + Create New Template
        </button>
      )}

      {/* Templates list */}
      <div className="bg-white rounded-2xl border border-green-100 p-6">
        <h2 className="text-green-700 font-semibold text-lg mb-6">
          Your Templates ({templates.length})
        </h2>

        {templates.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-6">
            No templates yet. Click &quot;Create New Template&quot; to get started.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {templates.map((t) => (
              <div key={t.id} className="rounded-xl border border-gray-100 p-4">
                <h3 className="font-semibold text-green-700 text-base">{t.name}</h3>
                <p className="text-xs text-gray-400 mt-0.5 mb-3">
                  {t.exercises.length} exercise{t.exercises.length !== 1 ? "s" : ""} ·
                  Updated {new Date(t.updatedAt).toLocaleDateString()}
                </p>

                <div className="space-y-1 mb-4 max-h-28 overflow-y-auto">
                  {t.exercises.map((ex, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm text-gray-700">
                      <span className="flex-1">{ex.name}</span>
                      {(ex.sets || ex.reps) && (
                        <span className="text-xs text-gray-400">
                          {ex.sets ? `${ex.sets}×` : ""}{ex.reps ?? ""}
                        </span>
                      )}
                      {ex.isCustom && (
                        <span className="px-1.5 py-0.5 bg-green-100 text-green-700 text-xs rounded-full">
                          custom
                        </span>
                      )}
                    </div>
                  ))}
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => handleEdit(t)}
                    className="flex-1 px-3 py-1.5 text-sm border border-green-700 text-green-700 rounded-lg hover:bg-green-50 transition"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(t.id)}
                    className="flex-1 px-3 py-1.5 text-sm border border-red-300 text-red-600 rounded-lg hover:bg-red-50 transition"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
