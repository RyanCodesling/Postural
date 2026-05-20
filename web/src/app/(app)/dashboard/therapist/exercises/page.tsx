"use client";

import { useState, useEffect } from "react";

interface Exercise {
  id: string;
  name: string;
  description: string;
  is_custom: boolean;
}

export default function ManageExercisesPage() {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/exercises")
      .then((r) => r.json())
      .then((d) => { setExercises(d.exercises ?? []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const startEdit = (ex: Exercise) => {
    setEditingId(ex.id);
    setEditName(ex.name);
    setEditDesc(ex.description);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName("");
    setEditDesc("");
  };

  const saveExercise = async (id: string) => {
    if (!editName.trim() || !editDesc.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/exercises/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName.trim(), description: editDesc.trim() }),
      });
      if (res.ok) {
        const { exercise } = await res.json();
        setExercises((prev) => prev.map((e) => (e.id === id ? { ...e, ...exercise } : e)));
        cancelEdit();
      }
    } catch (err) {
      console.error("Error saving exercise:", err);
    } finally {
      setSaving(false);
    }
  };

  const systemExercises = exercises.filter((e) => !e.is_custom);
  const customExercises = exercises.filter((e) => e.is_custom);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12 text-gray-500">
        Loading exercises...
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Manage Exercises</h1>
      <p className="text-gray-500 mb-6">View and edit system and custom exercises.</p>

      <section className="mb-8">
        <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">
          System Exercises ({systemExercises.length})
        </h2>
        <div className="space-y-2">
          {systemExercises.map((ex) => (
            <ExerciseRow
              key={ex.id}
              exercise={ex}
              isEditing={editingId === ex.id}
              editName={editName}
              editDesc={editDesc}
              saving={saving}
              onEdit={() => startEdit(ex)}
              onCancel={cancelEdit}
              onSave={() => saveExercise(ex.id)}
              onEditName={setEditName}
              onEditDesc={setEditDesc}
            />
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">
          Custom Exercises ({customExercises.length})
        </h2>
        {customExercises.length === 0 ? (
          <p className="text-gray-400 text-sm">No custom exercises yet. Add them in Exercise Program.</p>
        ) : (
          <div className="space-y-2">
            {customExercises.map((ex) => (
              <ExerciseRow
                key={ex.id}
                exercise={ex}
                isEditing={editingId === ex.id}
                editName={editName}
                editDesc={editDesc}
                saving={saving}
                onEdit={() => startEdit(ex)}
                onCancel={cancelEdit}
                onSave={() => saveExercise(ex.id)}
                onEditName={setEditName}
                onEditDesc={setEditDesc}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ExerciseRow({
  exercise, isEditing, editName, editDesc, saving,
  onEdit, onCancel, onSave, onEditName, onEditDesc,
}: {
  exercise: Exercise;
  isEditing: boolean;
  editName: string;
  editDesc: string;
  saving: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  onEditName: (v: string) => void;
  onEditDesc: (v: string) => void;
}) {
  return (
    <div className="rounded-xl border border-gray-100 p-4">
      {isEditing ? (
        <div className="space-y-2">
          <input
            value={editName}
            onChange={(e) => onEditName(e.target.value)}
            placeholder="Exercise name"
            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
          />
          <input
            value={editDesc}
            onChange={(e) => onEditDesc(e.target.value)}
            placeholder="Description"
            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
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
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400 font-mono">{exercise.id}</span>
              {exercise.is_custom && (
                <span className="px-1.5 py-0.5 bg-green-100 text-green-700 text-xs rounded-full">custom</span>
              )}
            </div>
            <p className="font-medium text-gray-900 text-sm mt-0.5">{exercise.name}</p>
            <p className="text-xs text-gray-500 mt-0.5">{exercise.description}</p>
          </div>
          <button
            onClick={onEdit}
            className="px-3 py-1.5 border border-gray-300 text-gray-600 text-xs rounded-lg hover:bg-gray-50 transition shrink-0"
          >
            Edit
          </button>
        </div>
      )}
    </div>
  );
}
