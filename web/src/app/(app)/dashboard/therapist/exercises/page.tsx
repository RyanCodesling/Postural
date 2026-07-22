"use client";

import { useState, useEffect } from "react";

interface Exercise {
  id: string;
  name: string;
  description: string;
  is_custom: boolean;
  monitoring_mode: "camera" | "manual";
}

export default function ManageExercisesPage() {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDesc, setEditDesc] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [viewingExercise, setViewingExercise] = useState<Exercise | null>(null);
  const [actionError, setActionError] = useState("");

  // Styled modal states for custom exercise deletion
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleteTargetName, setDeleteTargetName] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/exercises");
      if (res.ok) {
        const d = await res.json();
        setExercises(d.exercises ?? []);
      }
    } catch (err) {
      console.error("Error loading exercises:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const startEdit = (ex: Exercise) => {
    setActionError("");
    setEditingId(ex.id);
    setEditDesc(ex.description);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDesc("");
  };

  const saveExercise = async (id: string) => {
    if (!editDesc.trim()) return;
    const original = exercises.find((e) => e.id === id);
    if (!original) return;
    setSaving(true);
    setActionError("");
    try {
      const res = await fetch(`/api/exercises/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: original.name, description: editDesc.trim() }),
      });
      if (res.ok) {
        const { exercise } = await res.json();
        setExercises((prev) => prev.map((e) => (e.id === id ? { ...e, ...exercise } : e)));
        cancelEdit();
      } else {
        const body = await res.json().catch(() => null);
        setActionError(body?.error ?? "Failed to save the exercise.");
      }
    } catch (err) {
      console.error("Error saving exercise:", err);
      setActionError("Failed to save the exercise.");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteClick = (id: string, name: string) => {
    setActionError("");
    setDeleteTargetId(id);
    setDeleteTargetName(name);
    setShowDeleteModal(true);
  };

  const confirmDeleteExercise = async () => {
    if (!deleteTargetId) return;
    try {
      const res = await fetch(`/api/exercises/${deleteTargetId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setExercises((prev) => prev.filter((e) => e.id !== deleteTargetId));
        setShowDeleteModal(false);
      } else {
        const body = await res.json().catch(() => null);
        setActionError(body?.error ?? "Failed to archive the exercise.");
        setShowDeleteModal(false);
      }
    } catch (err) {
      console.error("Error deleting exercise:", err);
      setActionError("Failed to archive the exercise.");
      setShowDeleteModal(false);
    } finally {
      setDeleteTargetId(null);
      setDeleteTargetName(null);
    }
  };

  const filtered = exercises.filter((e) =>
    e.name.toLowerCase().includes(query.toLowerCase()) ||
    e.description.toLowerCase().includes(query.toLowerCase())
  );

  const systemExercises = filtered.filter((e) => !e.is_custom);
  const customExercises = filtered.filter((e) => e.is_custom);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12 text-gray-500">
        Loading exercises...
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Manage Exercises</h1>
          <p className="text-gray-600 mt-1">View built-in exercises and manage your manual custom tasks.</p>
        </div>
        <button
          onClick={loadData}
          className="flex items-center gap-2 px-4 py-2 bg-green-700 hover:bg-green-800 text-white rounded text-sm font-medium transition"
        >
          <RefreshIcon />
          Refresh
        </button>
      </div>

      {actionError && (
        <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {actionError}
        </div>
      )}

      <div className="mb-6">
        <div className="relative w-full max-w-sm">
          <svg xmlns="http://www.w3.org/2000/svg" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="currentColor">
            <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
          </svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search exercises"
            className="w-full border border-gray-200 rounded-xl pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent transition"
          />
        </div>
      </div>

      <div className="grid gap-6">
        {exercises.length === 0 ? (
          <div className="text-gray-500">No exercises found.</div>
        ) : filtered.length === 0 ? (
          <div className="text-gray-500">No exercises found matching your search.</div>
        ) : (
          <>
            {systemExercises.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">
                  System Exercises ({systemExercises.length})
                </h2>
                <div className="grid gap-4">
                  {systemExercises.map((ex) => (
                    <ExerciseRow
                      key={ex.id}
                      exercise={ex}
                      isEditing={editingId === ex.id}
                      editDesc={editDesc}
                      saving={saving}
                      onEdit={() => startEdit(ex)}
                      onCancel={cancelEdit}
                      onSave={() => saveExercise(ex.id)}
                      onEditDesc={setEditDesc}
                      onView={() => setViewingExercise(ex)}
                    />
                  ))}
                </div>
              </section>
            )}

            {customExercises.length > 0 ? (
              <section className="mt-4">
                <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">
                  Custom Exercises ({customExercises.length})
                </h2>
                <div className="grid gap-4">
                  {customExercises.map((ex) => (
                    <ExerciseRow
                      key={ex.id}
                      exercise={ex}
                      isEditing={editingId === ex.id}
                      editDesc={editDesc}
                      saving={saving}
                      onEdit={() => startEdit(ex)}
                      onCancel={cancelEdit}
                      onSave={() => saveExercise(ex.id)}
                      onEditDesc={setEditDesc}
                      onView={() => setViewingExercise(ex)}
                      onDelete={() => handleDeleteClick(ex.id, ex.name)}
                    />
                  ))}
                </div>
              </section>
            ) : query === "" ? (
              <section className="mt-4">
                <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">
                  Custom Exercises (0)
                </h2>
                <p className="text-gray-400 text-sm">No custom exercises yet. Add them in Exercise Program.</p>
              </section>
            ) : null}
          </>
        )}
      </div>

      {/* View Exercise Details Modal */}
      {viewingExercise && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setViewingExercise(null)}
          />

          {/* Modal Content */}
          <div className="relative z-10 w-full max-w-lg bg-white rounded-2xl shadow-xl p-6 overflow-hidden max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="flex justify-between items-start mb-4 shrink-0">
              <h3 className="text-xl font-bold text-gray-900">{viewingExercise.name}</h3>
              <button
                onClick={() => setViewingExercise(null)}
                className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Scrollable content area */}
            <div className="overflow-y-auto pr-1 flex-1 space-y-4">
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                <p className="text-sm font-semibold text-gray-700">Reference video unavailable</p>
                <p className="mt-1 text-xs text-gray-500">
                  Use the written instructions below. No demonstration video is published for this exercise yet.
                </p>
              </div>

              {/* Description */}
              <div>
                <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-1">
                  Description
                </h4>
                <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                  {viewingExercise.description}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Styled Delete Confirmation Modal */}
      {showDeleteModal && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50" onClick={() => setShowDeleteModal(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 text-center">
              <div className="flex items-center justify-center w-12 h-12 rounded-full bg-red-100 mx-auto mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-red-600" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                </svg>
              </div>
              <h2 className="text-lg font-bold text-gray-900 mb-1">Archive Custom Exercise</h2>
              <p className="text-sm text-gray-500 mb-5">
                Archive <span className="font-semibold text-gray-900">{deleteTargetName}</span>? Existing prescriptions and session history will remain, while future pending tasks are ended.
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => { setShowDeleteModal(false); setDeleteTargetId(null); setDeleteTargetName(null); }}
                  className="flex-1 px-4 py-2 border border-gray-300 bg-white text-sm text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmDeleteExercise}
                  className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition"
                >
                  Archive
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ExerciseRow({
  exercise, isEditing, editDesc, saving,
  onEdit, onCancel, onSave, onEditDesc, onView, onDelete,
}: {
  exercise: Exercise;
  isEditing: boolean;
  editDesc: string;
  saving: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  onEditDesc: (v: string) => void;
  onView: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="border border-gray-200 rounded-xl p-4 transition hover:shadow-sm">
      {isEditing ? (
        <div className="space-y-3">
          <div className="font-semibold text-gray-900 text-sm">{exercise.name}</div>
          <textarea
            value={editDesc}
            onChange={(e) => onEditDesc(e.target.value)}
            placeholder="Description"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent transition"
            rows={3}
          />
          <div className="flex gap-2">
            <button
              onClick={onSave}
              disabled={saving}
              className="px-3 py-1.5 bg-green-700 hover:bg-green-800 disabled:bg-gray-300 text-white text-xs font-medium rounded-lg transition"
            >
              {saving ? "Saving..." : "Save"}
            </button>
            <button
              onClick={onCancel}
              className="px-3 py-1.5 border border-gray-300 text-gray-600 text-xs rounded-lg hover:bg-gray-50 transition"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold text-gray-900 text-sm">{exercise.name}</p>
              {exercise.is_custom ? (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                  Manual · no camera
                </span>
              ) : (
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600">
                  Built-in · view only
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-1">{exercise.description}</p>
          </div>
          <div className="flex gap-2 ml-4 shrink-0">
            <button
              onClick={onView}
              className="px-3 py-1.5 bg-green-700 hover:bg-green-800 text-white text-xs font-medium rounded-lg transition"
            >
              View
            </button>
            {exercise.is_custom && (
              <button
                onClick={onEdit}
                className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-medium rounded-lg transition"
              >
                Edit
              </button>
            )}
            {exercise.is_custom && onDelete && (
              <button
                onClick={onDelete}
                className="px-3 py-1.5 border border-red-300 text-red-600 text-xs rounded-lg hover:bg-red-50 transition"
              >
                Archive
              </button>
            )}
          </div>
        </div>
      )}
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
