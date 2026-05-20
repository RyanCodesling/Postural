"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/AuthContext";

interface Exercise {
  id: string;
  name: string;
  description: string;
  is_custom: boolean;
}

interface Template {
  id: string;
  name: string;
  exercises: {
    exerciseId?: string | null;
    name: string;
    isCustom: boolean;
    sets?: number | null;
    reps?: number | null;
  }[];
}

interface PatientExercise {
  exercise_id: string;
  sets: number;
  reps: number;
}

interface PatientData {
  id: string;
  name: string;
  email: string;
}

export default function AssignExercisePage() {
  const { user } = useAuth();
  const [patients, setPatients] = useState<PatientData[]>([]);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);

  const [assignPatientId, setAssignPatientId] = useState("");
  const [assignTemplateId, setAssignTemplateId] = useState("");
  const [assignSelected, setAssignSelected] = useState<Set<string>>(new Set());
  const [assignParams, setAssignParams] = useState<Record<string, { sets?: number; reps?: number }>>({});
  const [assigning, setAssigning] = useState(false);
  const [assignSuccess, setAssignSuccess] = useState("");
  const [assignError, setAssignError] = useState("");

  useEffect(() => {
    if (!user?.id) return;
    Promise.all([
      fetch(`/api/users?role=patient&therapistId=${user.id}`).then((r) => r.json()),
      fetch("/api/exercises").then((r) => r.json()),
      fetch("/api/templates").then((r) => r.json()),
    ])
      .then(([patientsData, exercisesData, templatesData]) => {
        setPatients(patientsData.users ?? []);
        setExercises(exercisesData.exercises ?? []);
        setTemplates(templatesData.templates ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user?.id]);

  useEffect(() => {
    if (!assignPatientId) {
      setAssignSelected(new Set());
      setAssignParams({});
      setAssignTemplateId("");
      return;
    }
    fetch(`/api/patient-exercises?patientId=${assignPatientId}`)
      .then((r) => r.json())
      .then((d) => {
        const existing: PatientExercise[] = d.exercises ?? [];
        if (existing.length === 0) return;
        const selected = new Set<string>();
        const params: Record<string, { sets?: number; reps?: number }> = {};
        existing.forEach((ex) => {
          selected.add(ex.exercise_id);
          params[ex.exercise_id] = { sets: ex.sets, reps: ex.reps };
        });
        setAssignSelected(selected);
        setAssignParams(params);
      })
      .catch(() => {});
  }, [assignPatientId]);

  const handleTemplateSelect = (templateId: string) => {
    setAssignTemplateId(templateId);
    if (!templateId) return;
    const tmpl = templates.find((t) => t.id === templateId);
    if (!tmpl) return;
    setAssignSelected((prev) => {
      const next = new Set(prev);
      tmpl.exercises.forEach((ex) => { if (ex.exerciseId) next.add(ex.exerciseId); });
      return next;
    });
    setAssignParams((prev) => {
      const next = { ...prev };
      tmpl.exercises.forEach((ex) => {
        if (ex.exerciseId) {
          next[ex.exerciseId] = { sets: ex.sets ?? undefined, reps: ex.reps ?? undefined };
        }
      });
      return next;
    });
  };

  const toggleAssign = (exerciseId: string) => {
    setAssignSelected((prev) => {
      const next = new Set(prev);
      if (next.has(exerciseId)) {
        next.delete(exerciseId);
        setAssignParams((p) => { const copy = { ...p }; delete copy[exerciseId]; return copy; });
      } else {
        next.add(exerciseId);
      }
      return next;
    });
  };

  const handleAssign = async () => {
    setAssignError(""); setAssignSuccess("");
    if (!assignPatientId) { setAssignError("Please select a patient."); return; }
    if (assignSelected.size === 0) { setAssignError("Please select at least one exercise."); return; }

    const payload: { exerciseId: string; sets: number; reps: number }[] = [];
    for (const exId of assignSelected) {
      const p = assignParams[exId] ?? {};
      if (!p.sets || p.sets < 1 || !p.reps || p.reps < 1) {
        const ex = exercises.find((e) => e.id === exId);
        setAssignError(`Please enter valid sets and reps for "${ex?.name ?? exId}".`);
        return;
      }
      payload.push({ exerciseId: exId, sets: p.sets, reps: p.reps });
    }

    setAssigning(true);
    try {
      const res = await fetch("/api/patient-exercises", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId: assignPatientId, exercises: payload }),
      });
      if (!res.ok) {
        const d = await res.json();
        setAssignError(d.error ?? "Failed to assign.");
        return;
      }
      setAssignSuccess("Exercises assigned successfully.");
      setAssignPatientId(""); setAssignTemplateId("");
      setAssignSelected(new Set()); setAssignParams({});
    } catch (err) {
      console.error("Error assigning:", err);
      setAssignError("Failed to assign exercises.");
    } finally {
      setAssigning(false);
    }
  };

  const systemExercises = exercises.filter((e) => !e.is_custom);
  const customExercises = exercises.filter((e) => e.is_custom);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12 text-gray-500">
        Loading...
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Assign Exercise</h1>
      <p className="text-gray-500 mb-6">Assign exercises or a program to one of your patients.</p>

      {assignSuccess && (
        <div className="mb-4 px-4 py-3 bg-green-50 border border-green-200 text-green-800 rounded-lg text-sm">
          {assignSuccess}
        </div>
      )}
      {assignError && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
          {assignError}
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-6 max-w-2xl">

        {/* Step 1 */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            1. Select Patient <span className="text-red-500">*</span>
          </label>
          {patients.length === 0 ? (
            <p className="text-gray-400 text-sm">No patients assigned to you yet.</p>
          ) : (
            <select
              value={assignPatientId}
              onChange={(e) => setAssignPatientId(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
            >
              <option value="">— Select a patient —</option>
              {patients.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}
        </div>

        {/* Step 2 */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            2. Load from Program{" "}
            <span className="text-gray-400 font-normal">(optional — merges with existing selection)</span>
          </label>
          {templates.length === 0 ? (
            <p className="text-gray-400 text-sm">No programs yet.</p>
          ) : (
            <>
              <select
                value={assignTemplateId}
                onChange={(e) => handleTemplateSelect(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
              >
                <option value="">— None —</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>

              {assignTemplateId && (() => {
                const tmpl = templates.find((t) => t.id === assignTemplateId);
                if (!tmpl || tmpl.exercises.length === 0) return null;
                return (
                  <div className="mt-2 rounded-lg border border-green-200 bg-green-50 p-3">
                    <p className="text-xs font-medium text-green-700 mb-2">
                      {tmpl.exercises.length} exercise{tmpl.exercises.length !== 1 ? "s" : ""} in this program:
                    </p>
                    <ul className="space-y-1">
                      {tmpl.exercises.map((ex, i) => (
                        <li key={i} className="flex items-center justify-between text-xs text-gray-700">
                          <span>{ex.name}</span>
                          {(ex.sets || ex.reps) && (
                            <span className="text-gray-400 font-mono ml-4 shrink-0">
                              {ex.sets ?? "?"}×{ex.reps ?? "?"}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })()}
            </>
          )}
        </div>

        {/* Step 3 */}
        <div>
          <p className="text-sm font-semibold text-gray-700 mb-3">
            3. Select Exercises <span className="text-red-500">*</span>
          </p>

          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
            System Exercises
          </p>
          <div className="space-y-2 mb-5">
            {systemExercises.map((ex) => (
              <AssignRow
                key={ex.id}
                exercise={ex}
                checked={assignSelected.has(ex.id)}
                params={assignParams[ex.id] ?? {}}
                onToggle={() => toggleAssign(ex.id)}
                onParam={(f, v) =>
                  setAssignParams((prev) => ({ ...prev, [ex.id]: { ...prev[ex.id], [f]: v } }))
                }
              />
            ))}
          </div>

          {customExercises.length > 0 && (
            <>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                Custom Exercises
              </p>
              <div className="space-y-2">
                {customExercises.map((ex) => (
                  <AssignRow
                    key={ex.id}
                    exercise={ex}
                    checked={assignSelected.has(ex.id)}
                    params={assignParams[ex.id] ?? {}}
                    onToggle={() => toggleAssign(ex.id)}
                    onParam={(f, v) =>
                      setAssignParams((prev) => ({ ...prev, [ex.id]: { ...prev[ex.id], [f]: v } }))
                    }
                  />
                ))}
              </div>
            </>
          )}
        </div>

        <button
          onClick={handleAssign}
          disabled={assigning}
          className="px-6 py-2.5 bg-green-700 hover:bg-green-800 disabled:bg-gray-300 text-white text-sm font-medium rounded-lg transition"
        >
          {assigning ? "Assigning..." : "Assign Exercises"}
        </button>
      </div>
    </div>
  );
}

function AssignRow({
  exercise, checked, params, onToggle, onParam,
}: {
  exercise: Exercise;
  checked: boolean;
  params: { sets?: number; reps?: number };
  onToggle: () => void;
  onParam: (field: "sets" | "reps", val: number | undefined) => void;
}) {
  return (
    <div className={`rounded-xl border p-3 transition ${checked ? "border-green-300 bg-green-50" : "border-gray-200"}`}>
      <label className="flex items-start gap-3 cursor-pointer">
        <input type="checkbox" checked={checked} onChange={onToggle} className="mt-1 w-4 h-4 accent-green-600" />
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-gray-900 text-sm">{exercise.name}</span>
            <span className="text-xs text-gray-400 font-mono">{exercise.id}</span>
            {exercise.is_custom && (
              <span className="px-1.5 py-0.5 bg-green-100 text-green-700 text-xs rounded-full">custom</span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5">{exercise.description}</p>
        </div>
      </label>
      {checked && (
        <div className="mt-3 grid grid-cols-2 gap-3 pl-7">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Sets <span className="text-red-500">*</span></label>
            <input
              type="number" min={1} value={params.sets ?? ""}
              onChange={(e) => onParam("sets", e.target.value ? Number(e.target.value) : undefined)}
              placeholder="e.g. 3"
              className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Reps <span className="text-red-500">*</span></label>
            <input
              type="number" min={1} value={params.reps ?? ""}
              onChange={(e) => onParam("reps", e.target.value ? Number(e.target.value) : undefined)}
              placeholder="e.g. 12"
              className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
            />
          </div>
        </div>
      )}
    </div>
  );
}
