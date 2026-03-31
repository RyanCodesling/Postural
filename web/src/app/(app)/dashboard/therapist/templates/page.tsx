"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/AuthContext";

interface Exercise {
  id: string;
  name: string;
  description: string;
  duration: number;
  difficulty: "easy" | "medium" | "hard";
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

export default function ExerciseTemplatesPage() {
  const { user } = useAuth();
  const [templates, setTemplates] = useState<ExerciseTemplate[]>([]);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);

  // Form states
  const [templateName, setTemplateName] = useState("");
  const [selectedExercises, setSelectedExercises] = useState<Set<string>>(new Set());
  const [templateExerciseParams, setTemplateExerciseParams] = useState<
    Record<
      string,
      {
        reps?: number;
        sets?: number;
        weight?: string;
      }
    >
  >({});
  const [customExercises, setCustomExercises] = useState<{ [key: string]: TemplateExercise }>({});
  const [newCustomName, setNewCustomName] = useState("");
  const [newCustomDesc, setNewCustomDesc] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = () => {
    try {
      // Load system exercises
      const storedExercises = localStorage.getItem("admin_exercises");
      if (storedExercises) {
        const exs: Exercise[] = JSON.parse(storedExercises);
        setExercises(exs);
      }

      // Load templates
      const storedTemplates = localStorage.getItem("exercise_templates");
      if (storedTemplates) {
        const tmps: ExerciseTemplate[] = JSON.parse(storedTemplates);
        setTemplates(tmps);
      }
    } catch (error) {
      console.error("Error loading data:", error);
    }
    setLoading(false);
  };

  const handleSelectExercise = (exerciseId: string) => {
    const newSelected = new Set(selectedExercises);
    if (newSelected.has(exerciseId)) {
      newSelected.delete(exerciseId);
    } else {
      newSelected.add(exerciseId);
    }
    setSelectedExercises(newSelected);
  };

  const handleAddCustomExercise = () => {
    if (!newCustomName.trim()) return;

    const customId = `custom_${Date.now()}`;
    setCustomExercises({
      ...customExercises,
      [customId]: {
        name: newCustomName,
        description: newCustomDesc,
        isCustom: true,
      },
    });

    setNewCustomName("");
    setNewCustomDesc("");
  };

  const handleRemoveCustomExercise = (customId: string) => {
    const updated = { ...customExercises };
    delete updated[customId];
    setCustomExercises(updated);
  };

  const handleSaveTemplate = () => {
    if (!templateName.trim() || (selectedExercises.size === 0 && Object.keys(customExercises).length === 0)) {
      alert("Please enter a template name and select at least one exercise.");
      return;
    }

    // Build template exercises array
    const templateExercises: TemplateExercise[] = [];

    // Add system exercises
    selectedExercises.forEach((exerciseId) => {
      const exercise = exercises.find((e) => e.id === exerciseId);
      const params = templateExerciseParams[exerciseId] || {};
      if (exercise) {
        templateExercises.push({
          exerciseId: exercise.id,
          name: exercise.name,
          description: exercise.description,
          isCustom: false,
          reps: params.reps,
          sets: params.sets,
          weight: params.weight,
        });
      }
    });

    // Add custom exercises
    Object.values(customExercises).forEach((custom) => {
      templateExercises.push(custom);
    });

    const newTemplate: ExerciseTemplate = {
      id: editingTemplateId || `template_${Date.now()}`,
      name: templateName,
      exercises: templateExercises,
      createdDate: editingTemplateId ? templates.find((t) => t.id === editingTemplateId)?.createdDate || new Date().toISOString() : new Date().toISOString(),
      updatedDate: new Date().toISOString(),
    };

    let updatedTemplates: ExerciseTemplate[];
    if (editingTemplateId) {
      updatedTemplates = templates.map((t) => (t.id === editingTemplateId ? newTemplate : t));
    } else {
      updatedTemplates = [...templates, newTemplate];
    }

    setTemplates(updatedTemplates);
    localStorage.setItem("exercise_templates", JSON.stringify(updatedTemplates));

    // Reset form
    resetForm();
  };

  const resetForm = () => {
    setTemplateName("");
    setSelectedExercises(new Set());
    setTemplateExerciseParams({});
    setCustomExercises({});
    setNewCustomName("");
    setNewCustomDesc("");
    setShowCreateForm(false);
    setEditingTemplateId(null);
  };

  const handleEditTemplate = (template: ExerciseTemplate) => {
    setEditingTemplateId(template.id);
    setTemplateName(template.name);

    // Populate selected exercises
    const selected = new Set<string>();
    const params: Record<string, { reps?: number; sets?: number; weight?: string }> = {};
    const customs: { [key: string]: TemplateExercise } = {};

    template.exercises.forEach((ex) => {
      if (ex.isCustom) {
        customs[`custom_${Date.now()}_${Math.random()}`] = ex;
      } else if (ex.exerciseId) {
        selected.add(ex.exerciseId);
        if (ex.reps !== undefined || ex.sets !== undefined || ex.weight !== undefined) {
          params[ex.exerciseId] = {
            reps: ex.reps,
            sets: ex.sets,
            weight: ex.weight,
          };
        }
      }
    });

    setSelectedExercises(selected);
    setTemplateExerciseParams(params);
    setCustomExercises(customs);
    setShowCreateForm(true);
  };

  const handleDeleteTemplate = (templateId: string) => {
    if (confirm("Are you sure you want to delete this template?")) {
      const updatedTemplates = templates.filter((t) => t.id !== templateId);
      setTemplates(updatedTemplates);
      localStorage.setItem("exercise_templates", JSON.stringify(updatedTemplates));
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="text-gray-600">Loading templates...</div>
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
          <h1 className="text-3xl font-bold text-gray-900">Exercise Templates</h1>
          <p className="text-gray-600 mt-1">Create and manage exercise templates for your patients.</p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Create/Edit Form */}
        {showCreateForm ? (
          <div className="bg-white rounded shadow p-6 mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">
              {editingTemplateId ? "Edit Template" : "Create New Template"}
            </h2>

            {/* Template Name */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Template Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="e.g., Lower Body Strengthening"
                className="w-full border border-gray-300 rounded px-3 py-2"
              />
            </div>

            {/* System Exercises */}
            <div className="mb-8">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Select System Exercises</h3>
              {exercises.length === 0 ? (
                <p className="text-gray-600 text-sm mb-4">No exercises available in the system.</p>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
                  {exercises.map((exercise) => {
                    const params = templateExerciseParams[exercise.id] || {};
                    return (
                      <div
                        key={exercise.id}
                        className="border border-gray-200 rounded p-4 hover:bg-gray-50 transition"
                      >
                        <label className="flex items-start cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedExercises.has(exercise.id)}
                            onChange={() => handleSelectExercise(exercise.id)}
                            className="mt-1 w-4 h-4 mr-3"
                          />
                          <div>
                            <div className="font-medium text-gray-900">{exercise.name}</div>
                            <div className="text-sm text-gray-600">{exercise.description}</div>
                            <div className="text-xs text-gray-500 mt-1">
                              {exercise.difficulty} • {exercise.duration}s
                            </div>
                          </div>
                        </label>

                        {selectedExercises.has(exercise.id) && (
                          <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
                            <div>
                              <label className="block text-xs text-gray-500">Reps</label>
                              <input
                                type="number"
                                min={0}
                                value={params.reps ?? ""}
                                onChange={(e) =>
                                  setTemplateExerciseParams((prev) => ({
                                    ...prev,
                                    [exercise.id]: {
                                      ...prev[exercise.id],
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
                                value={params.sets ?? ""}
                                onChange={(e) =>
                                  setTemplateExerciseParams((prev) => ({
                                    ...prev,
                                    [exercise.id]: {
                                      ...prev[exercise.id],
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
                                value={params.weight ?? ""}
                                onChange={(e) =>
                                  setTemplateExerciseParams((prev) => ({
                                    ...prev,
                                    [exercise.id]: {
                                      ...prev[exercise.id],
                                      weight: e.target.value || undefined,
                                    },
                                  }))
                                }
                                className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
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

            {/* Custom Exercises */}
            <div className="mb-8">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Custom Exercises</h3>

              {/* Add Custom Exercise Form */}
              <div className="bg-blue-50 p-4 rounded mb-4">
                <h4 className="font-medium text-gray-900 mb-3">Add Custom Exercise</h4>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Exercise Name
                    </label>
                    <input
                      type="text"
                      value={newCustomName}
                      onChange={(e) => setNewCustomName(e.target.value)}
                      placeholder="e.g., Personalized Stretch"
                      className="w-full border border-gray-300 rounded px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Description
                    </label>
                    <textarea
                      value={newCustomDesc}
                      onChange={(e) => setNewCustomDesc(e.target.value)}
                      placeholder="Describe the exercise..."
                      className="w-full border border-gray-300 rounded px-3 py-2"
                      rows={2}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleAddCustomExercise}
                    className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition"
                  >
                    Add Custom Exercise
                  </button>
                </div>
              </div>

              {/* Display Added Custom Exercises */}
              {Object.keys(customExercises).length > 0 && (
                <div className="space-y-2">
                  {Object.entries(customExercises).map(([customId, custom]) => (
                    <div key={customId} className="p-3 border border-blue-200 bg-blue-50 rounded">
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="font-medium text-gray-900">{custom.name}</div>
                          <div className="text-sm text-gray-600">{custom.description}</div>
                        </div>
                        <button
                          onClick={() => handleRemoveCustomExercise(customId)}
                          className="text-red-600 hover:text-red-800 font-medium ml-2"
                        >
                          Remove
                        </button>
                      </div>
                      <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <div>
                          <label className="block text-xs text-gray-500">Reps</label>
                          <input
                            type="number"
                            min={0}
                            value={custom.reps ?? ""}
                            onChange={(e) =>
                              setCustomExercises((prev) => ({
                                ...prev,
                                [customId]: {
                                  ...prev[customId],
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
                            value={custom.sets ?? ""}
                            onChange={(e) =>
                              setCustomExercises((prev) => ({
                                ...prev,
                                [customId]: {
                                  ...prev[customId],
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
                            value={custom.weight ?? ""}
                            onChange={(e) =>
                              setCustomExercises((prev) => ({
                                ...prev,
                                [customId]: {
                                  ...prev[customId],
                                  weight: e.target.value || undefined,
                                },
                              }))
                            }
                            className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Form Actions */}
            <div className="flex gap-3">
              <button
                onClick={handleSaveTemplate}
                className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded transition font-medium"
              >
                {editingTemplateId ? "Update Template" : "Create Template"}
              </button>
              <button
                onClick={resetForm}
                className="flex-1 px-4 py-2 bg-gray-400 hover:bg-gray-500 text-white rounded transition font-medium"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowCreateForm(true)}
            className="mb-8 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition"
          >
            + Create New Template
          </button>
        )}

        {/* Templates List */}
        <div>
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Your Templates ({templates.length})</h2>

          {templates.length === 0 ? (
            <div className="bg-gray-50 p-6 rounded text-center text-gray-600">
              <p>No templates created yet. Click "Create New Template" to get started.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {templates.map((template) => (
                <div key={template.id} className="bg-white rounded shadow p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">{template.name}</h3>
                  <p className="text-sm text-gray-600 mb-4">
                    Exercises: {template.exercises.length}
                  </p>

                  {/* Exercises Preview */}
                  <div className="mb-4 space-y-1 max-h-32 overflow-y-auto">
                    {template.exercises.map((ex, idx) => (
                      <div key={idx} className="text-sm text-gray-700">
                        <span className={ex.isCustom ? "font-medium text-blue-600" : ""}>
                          {ex.name}
                        </span>
                        {ex.isCustom && <span className="text-xs text-blue-600 ml-1">(custom)</span>}
                      </div>
                    ))}
                  </div>

                  {/* Template Info */}
                  <div className="text-xs text-gray-500 mb-4">
                    Updated: {new Date(template.updatedDate).toLocaleDateString()}
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleEditTemplate(template)}
                      className="flex-1 px-3 py-2 text-sm bg-blue-100 hover:bg-blue-200 text-blue-700 rounded transition"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDeleteTemplate(template.id)}
                      className="flex-1 px-3 py-2 text-sm bg-red-100 hover:bg-red-200 text-red-700 rounded transition"
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
    </div>
  );
}
