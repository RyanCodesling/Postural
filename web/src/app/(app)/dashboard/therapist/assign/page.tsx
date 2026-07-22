"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/AuthContext";
import { useToast } from "@/lib/ToastContext";
import { getExerciseDefinition } from "@/lib/exercises/registry";
import { prescriptionTargetText } from "@/lib/exercises/prescriptionDisplay";
import {
  WEEKDAY_SHORT,
  MAX_RECURRENCE_SPAN_DAYS,
  MAX_INTERVAL_DAYS,
  formatCadence,
  spanDays,
  type Recurrence,
} from "@/lib/exercises/occurrences";

interface Exercise {
  id: string;
  name: string;
  description: string;
  is_custom: boolean;
  monitoring_mode: "camera" | "manual";
}

interface Program {
  id: string;
  name: string;
  exercises: {
    exerciseId?: string | null;
    name: string;
    isCustom: boolean;
    sets?: number | null;
    reps?: number | null;
    restSeconds?: number | null;
    holdSeconds?: number | null;
  }[];
}

interface PatientExercise {
  exercise_id: string;
  name: string;
  sets: number;
  reps: number;
  rest_seconds: number;
  assigned_date: string;
  hold_seconds: number;
  recurrence: Recurrence | null;
  interval_days: number | null;
  weekdays: number[] | null;
  start_date: string | null;
  end_date: string | null;
}

type AssignmentParams = {
  sets?: number;
  reps?: number;
  restSeconds?: number;
  holdSeconds?: number;
  scheduledDate?: string; // recurrence start date
  recurrence?: Recurrence;
  intervalDays?: number;
  weekdays?: number[];
  endDate?: string;
};

type AssignmentPayload = {
  exerciseId: string;
  sets: number;
  reps: number;
  restSeconds: number;
  holdSeconds: number;
  scheduledDate: string;
  recurrence: Recurrence;
  intervalDays: number | null;
  weekdays: number[];
  endDate: string;
};

type PreviewSnapshot = {
  sets: number;
  reps: number;
  restSeconds: number;
  holdSeconds: number;
  scheduledDate: string;
  recurrence: Recurrence;
  intervalDays: number | null;
  weekdays: number[];
  endDate: string;
};

// Friendly cadence presets shown in the Repeat dropdown. Each maps to either an
// 'interval' (every N days) or 'weekly' (specific weekdays, with a default set
// the therapist can adjust) rule.
type CadencePreset = {
  id: string;
  label: string;
  recurrence: Recurrence;
  intervalDays?: number;
  defaultWeekdays?: number[];
};
const CADENCE_PRESETS: CadencePreset[] = [
  { id: "every_day",        label: "Every day",        recurrence: "interval", intervalDays: 1 },
  { id: "every_other_day",  label: "Every other day",  recurrence: "interval", intervalDays: 2 },
  { id: "every_3_days",     label: "Every 3 days",     recurrence: "interval", intervalDays: 3 },
  { id: "twice_a_week",     label: "Twice a week",     recurrence: "weekly",   defaultWeekdays: [1, 4] },
  { id: "three_a_week",     label: "3 times a week",   recurrence: "weekly",   defaultWeekdays: [1, 3, 5] },
  { id: "custom_weekdays",  label: "Custom weekdays",  recurrence: "weekly" },
];

// Pick the preset id that matches the current params (for the dropdown value).
function presetIdFor(p: AssignmentParams): string {
  if ((p.recurrence ?? "interval") === "interval") {
    const n = p.intervalDays ?? 1;
    return CADENCE_PRESETS.find((c) => c.recurrence === "interval" && c.intervalDays === n)?.id
      ?? "every_day";
  }
  const count = (p.weekdays ?? []).length;
  if (count === 2) return "twice_a_week";
  if (count === 3) return "three_a_week";
  return "custom_weekdays";
}

type PreviewItem = {
  exerciseId: string;
  name: string;
  type: "new" | "updated" | "unchanged";
  before?: PreviewSnapshot;
  after: PreviewSnapshot;
};

// Default rest between sets (seconds) when the therapist leaves the field blank.
const DEFAULT_REST_SECONDS = 60;
// Default per-side hold (seconds) for isometric exercises when left blank.
// Mirrors the patient_exercises.hold_seconds DB default.
const DEFAULT_HOLD_SECONDS = 30;

interface PatientData {
  id: string;
  name: string;
  email: string;
}

function todayStr(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
}

function fmtDate(d: string) {
  if (!d) return "—";
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

// Order-insensitive equality for weekday sets (used by change detection).
function sameWeekdays(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort((x, y) => x - y);
  const sb = [...b].sort((x, y) => x - y);
  return sa.every((v, i) => v === sb[i]);
}

// Build editable params from a saved assignment. Single source of truth so the
// initial load and Cancel-Edit restore identical values (Cancel-Edit previously
// dropped the recurrence fields, silently reverting recurring rows to one-time).
function paramsFromExisting(ex: PatientExercise): AssignmentParams {
  return {
    sets: ex.sets,
    reps: ex.reps,
    restSeconds: ex.rest_seconds,
    holdSeconds: ex.hold_seconds,
    scheduledDate: ex.start_date ?? ex.assigned_date,
    // Anything that isn't 'weekly' (null, or a legacy 'once') edits as interval.
    recurrence: ex.recurrence === "weekly" ? "weekly" : "interval",
    intervalDays: ex.interval_days ?? 1,
    weekdays: ex.weekdays ?? [],
    endDate: ex.end_date ?? (ex.start_date ?? ex.assigned_date),
  };
}

function PrescriptionDetails({
  exerciseId,
  snapshot,
}: {
  exerciseId: string;
  snapshot: PreviewSnapshot;
}) {
  const isIsometric = getExerciseDefinition(exerciseId)?.kind === "isometric";
  return (
    <>
      <p>Sets: {snapshot.sets}</p>
      {isIsometric ? (
        <p>Hold: {snapshot.holdSeconds}s</p>
      ) : (
        <p>Reps: {snapshot.reps}</p>
      )}
      <p>Rest: {snapshot.restSeconds}s</p>
      <p>Repeat: {formatCadence({ recurrence: snapshot.recurrence, intervalDays: snapshot.intervalDays, weekdays: snapshot.weekdays })}</p>
      <p>From {fmtDate(snapshot.scheduledDate)} to {fmtDate(snapshot.endDate)}</p>
    </>
  );
}

export default function AssignExercisePage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [patients, setPatients]   = useState<PatientData[]>([]);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [loading, setLoading]     = useState(true);

  const [assignPatientId,   setAssignPatientId]   = useState("");
  const [assignProgramId,   setAssignProgramId]   = useState("");
  const [assignSelected,    setAssignSelected]    = useState<Set<string>>(new Set());
  const [assignParams,      setAssignParams]      = useState<Record<string, AssignmentParams>>({});
  const [assigning,         setAssigning]         = useState(false);
  const [showAssignError,   setShowAssignError]   = useState(false);
  const [assignErrorMsg,    setAssignErrorMsg]    = useState("");

  // Existing assignments (loaded when patient changes)
  const [existingAssignments, setExistingAssignments] = useState<PatientExercise[]>([]);

  // Delete state
  const [deleteSelected,  setDeleteSelected]  = useState<Set<string>>(new Set());
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting,        setDeleting]        = useState(false);
  const [deleteError,     setDeleteError]     = useState("");

  // Assign preview modal
  const [showAssignPreview, setShowAssignPreview] = useState(false);
  const [previewItems,      setPreviewItems]      = useState<PreviewItem[]>([]);
  const [pendingPayload,    setPendingPayload]    = useState<AssignmentPayload[]>([]);

  // Edit mode per exercise (unlocks fields for existing assignments)
  const [editingExercises, setEditingExercises] = useState<Set<string>>(new Set());


  // ── Load patients / exercises / programs ─────────────────────────────────
  useEffect(() => {
    if (!user?.id) return;
    Promise.all([
      fetch(`/api/users?role=patient&therapistId=${user.id}`).then((r) => r.json()),
      fetch("/api/exercises").then((r) => r.json()),
      fetch("/api/programs").then((r) => r.json()),
    ])
      .then(([patientsData, exercisesData, programsData]) => {
        setPatients(patientsData.users ?? []);
        setExercises(exercisesData.exercises ?? []);
        setPrograms(programsData.programs ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user?.id]);

  // ── Load existing assignments when patient changes ───────────────────────
  useEffect(() => {
    if (!assignPatientId) {
      setAssignSelected(new Set());
      setAssignParams({});
      setAssignProgramId("");
      setExistingAssignments([]);
      setDeleteSelected(new Set());
      setEditingExercises(new Set());
      return;
    }
    fetch(`/api/patient-exercises?patientId=${assignPatientId}`)
      .then((r) => r.json())
      .then((d) => {
        const existing: PatientExercise[] = d.exercises ?? [];
        setExistingAssignments(existing);
        if (existing.length === 0) return;
        const selected = new Set<string>();
        const params: Record<string, AssignmentParams> = {};
        existing.forEach((ex) => {
          selected.add(ex.exercise_id);
          params[ex.exercise_id] = paramsFromExisting(ex);
        });
        setAssignSelected(selected);
        setAssignParams(params);
        setEditingExercises(new Set());
      })
      .catch(() => {});
  }, [assignPatientId]);

  // ── Program merge ─────────────────────────────────────────────────────────
  const handleProgramSelect = (programId: string) => {
    setAssignProgramId(programId);
    if (!programId) return;
    const tmpl = programs.find((t) => t.id === programId);
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
          next[ex.exerciseId] = {
            ...next[ex.exerciseId],
            sets: ex.sets ?? undefined,
            reps: ex.reps ?? undefined,
            restSeconds: ex.restSeconds ?? next[ex.exerciseId]?.restSeconds,
            holdSeconds: ex.holdSeconds ?? next[ex.exerciseId]?.holdSeconds,
          };
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
        // Only wipe params for non-assigned exercises; assigned ones keep their values so
        // re-checking the box restores the filled-in fields exactly as they were.
        const isExisting = existingAssignments.some((e) => e.exercise_id === exerciseId);
        if (!isExisting) {
          setAssignParams((p) => { const copy = { ...p }; delete copy[exerciseId]; return copy; });
        }
      } else {
        next.add(exerciseId);
      }
      return next;
    });
  };

  // ── Assign: validate → build preview → show modal ───────────────────────
  const handleAssign = () => {
    if (!assignPatientId) { setAssignErrorMsg("Please select a patient."); setShowAssignError(true); return; }
    if (assignSelected.size === 0) { setAssignErrorMsg("Please select at least one exercise."); setShowAssignError(true); return; }

    const payload: AssignmentPayload[] = [];
    for (const exId of assignSelected) {
      const p = assignParams[exId] ?? {};
      const ex = exercises.find((e) => e.id === exId);
      const isIsometric = getExerciseDefinition(exId)?.kind === "isometric";
      if (!p.sets || p.sets < 1) {
        setAssignErrorMsg(`Please enter valid sets for "${ex?.name ?? exId}".`);
        setShowAssignError(true);
        return;
      }
      if (!isIsometric && (!p.reps || p.reps < 1)) {
        setAssignErrorMsg(`Please enter valid sets and reps for "${ex?.name ?? exId}".`);
        setShowAssignError(true);
        return;
      }
      if (isIsometric && p.holdSeconds !== undefined && p.holdSeconds < 1) {
        setAssignErrorMsg(`Please enter a valid hold time (sec) for "${ex?.name ?? exId}".`);
        setShowAssignError(true);
        return;
      }
      const recurrence: Recurrence = p.recurrence === "weekly" ? "weekly" : "interval";
      const intervalDays = recurrence === "interval" ? (p.intervalDays ?? 1) : null;
      const weekdays = recurrence === "weekly" ? (p.weekdays ?? []) : [];
      if (!p.scheduledDate) {
        setAssignErrorMsg(`Please select a start date for "${ex?.name ?? exId}".`);
        setShowAssignError(true);
        return;
      }
      if (recurrence === "weekly" && weekdays.length === 0) {
        setAssignErrorMsg(`Please pick at least one weekday for "${ex?.name ?? exId}".`);
        setShowAssignError(true);
        return;
      }
      if (recurrence === "interval" && (!intervalDays || intervalDays < 1 || intervalDays > MAX_INTERVAL_DAYS)) {
        setAssignErrorMsg(`Please choose a valid repeat interval for "${ex?.name ?? exId}".`);
        setShowAssignError(true);
        return;
      }
      if (!p.endDate) {
        setAssignErrorMsg(`Please select an end date for "${ex?.name ?? exId}".`);
        setShowAssignError(true);
        return;
      }
      const span = spanDays(p.scheduledDate, p.endDate);
      if (span === null) {
        setAssignErrorMsg(`The end date for "${ex?.name ?? exId}" must be on or after the start date.`);
        setShowAssignError(true);
        return;
      }
      if (span > MAX_RECURRENCE_SPAN_DAYS) {
        setAssignErrorMsg(`The schedule for "${ex?.name ?? exId}" can span at most ${MAX_RECURRENCE_SPAN_DAYS} days.`);
        setShowAssignError(true);
        return;
      }
      const endDate = p.endDate;
      // Rest defaults to DEFAULT_REST_SECONDS when left blank; 0 = no rest.
      const restSeconds =
        p.restSeconds === undefined || p.restSeconds < 0
          ? DEFAULT_REST_SECONDS
          : p.restSeconds;
      // Hold defaults when blank; only meaningful for isometric exercises.
      const holdSeconds =
        p.holdSeconds === undefined || p.holdSeconds < 1
          ? DEFAULT_HOLD_SECONDS
          : p.holdSeconds;
      // Isometric exercises carry a placeholder rep value to satisfy the NOT
      // NULL column; the camera page uses holdSeconds, not reps, for them.
      const reps = isIsometric ? p.reps ?? 1 : p.reps!;
      payload.push({
        exerciseId: exId,
        sets: p.sets,
        reps,
        restSeconds,
        holdSeconds,
        scheduledDate: p.scheduledDate,
        recurrence,
        intervalDays,
        weekdays,
        endDate,
      });
    }

    // Build diff for preview
    const items: PreviewItem[] = payload.map((item) => {
      const ex = exercises.find((e) => e.id === item.exerciseId);
      const name = ex?.name ?? item.exerciseId;
      const existing = existingAssignments.find((e) => e.exercise_id === item.exerciseId);
      const after: PreviewSnapshot = {
        sets: item.sets, reps: item.reps, restSeconds: item.restSeconds, holdSeconds: item.holdSeconds,
        scheduledDate: item.scheduledDate, recurrence: item.recurrence, intervalDays: item.intervalDays,
        weekdays: item.weekdays, endDate: item.endDate,
      };
      if (!existing) {
        return { exerciseId: item.exerciseId, name, type: "new", after };
      }
      const before: PreviewSnapshot = {
        sets: existing.sets, reps: existing.reps, restSeconds: existing.rest_seconds, holdSeconds: existing.hold_seconds,
        scheduledDate: existing.start_date ?? existing.assigned_date,
        recurrence: existing.recurrence ?? "interval",
        intervalDays: existing.interval_days ?? null,
        weekdays: existing.weekdays ?? [],
        endDate: existing.end_date ?? existing.assigned_date,
      };
      const changed =
        after.sets !== before.sets ||
        after.reps !== before.reps ||
        after.restSeconds !== before.restSeconds ||
        after.holdSeconds !== before.holdSeconds ||
        after.scheduledDate !== before.scheduledDate ||
        after.recurrence !== before.recurrence ||
        after.intervalDays !== before.intervalDays ||
        after.endDate !== before.endDate ||
        !sameWeekdays(after.weekdays, before.weekdays);
      return {
        exerciseId: item.exerciseId,
        name,
        type: changed ? "updated" : "unchanged",
        before,
        after,
      };
    });

    setPendingPayload(payload);
    setPreviewItems(items);
    setShowAssignPreview(true);
  };

  const handleConfirmAssign = async () => {
    setAssigning(true);
    try {
      const res = await fetch("/api/patient-exercises", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId: assignPatientId, exercises: pendingPayload }),
      });
      if (!res.ok) {
        const d = await res.json();
        setAssignErrorMsg(d.error ?? "Failed to assign.");
        setShowAssignError(true);
        setShowAssignPreview(false);
        return;
      }
      setShowAssignPreview(false);
      showToast({ variant: "success", message: "Exercises assigned and synced." });
      setAssignPatientId(""); setAssignProgramId("");
      setAssignSelected(new Set()); setAssignParams({});
      setExistingAssignments([]); setDeleteSelected(new Set());
    } catch {
      setAssignErrorMsg("Failed to assign exercises.");
      setShowAssignError(true);
      setShowAssignPreview(false);
    } finally {
      setAssigning(false);
    }
  };

  // ── Delete ───────────────────────────────────────────────────────────────
  const toggleDelete = (exerciseId: string) => {
    setDeleteSelected((prev) => {
      const next = new Set(prev);
      if (next.has(exerciseId)) next.delete(exerciseId);
      else next.add(exerciseId);
      return next;
    });
  };

  const handleConfirmDelete = async () => {
    setDeleting(true);
    setDeleteError("");
    try {
      const res = await fetch("/api/patient-exercises", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId: assignPatientId, exerciseIds: [...deleteSelected] }),
      });
      if (!res.ok) {
        const d = await res.json();
        setDeleteError(d.error ?? "Failed to delete.");
        return;
      }
      // Refresh existing assignments
      const updated = existingAssignments.filter((e) => !deleteSelected.has(e.exercise_id));
      setExistingAssignments(updated);
      setAssignSelected((prev) => {
        const next = new Set(prev);
        deleteSelected.forEach((id) => next.delete(id));
        return next;
      });
      setAssignParams((prev) => {
        const next = { ...prev };
        deleteSelected.forEach((id) => delete next[id]);
        return next;
      });
      setDeleteSelected(new Set());
      setShowDeleteModal(false);
      showToast({
        variant: "success",
        message: `Prescriptions ended for ${selectedPatient?.name ?? "patient"}; history preserved.`,
      });
    } catch {
      setDeleteError("Failed to end prescriptions.");
    } finally {
      setDeleting(false);
    }
  };

  // ── Derived ──────────────────────────────────────────────────────────────
  const systemExercises = exercises.filter((e) => !e.is_custom);
  const customExercises = exercises.filter((e) => e.is_custom);
  const selectedPatient = patients.find((p) => p.id === assignPatientId);
  const minDate = todayStr();

  // True when at least one selected exercise is new or has been edited and differs from existing
  const hasAssignChanges = (() => {
    if (assignSelected.size === 0) return false;
    for (const exId of assignSelected) {
      const p = assignParams[exId] ?? {};
      const existing = existingAssignments.find((e) => e.exercise_id === exId);
      if (!existing) return true; // brand-new exercise
      if (!editingExercises.has(exId)) continue; // locked — can't have changed
      const restSeconds = p.restSeconds === undefined || p.restSeconds < 0 ? DEFAULT_REST_SECONDS : p.restSeconds;
      const holdSeconds = p.holdSeconds === undefined || p.holdSeconds < 1 ? DEFAULT_HOLD_SECONDS : p.holdSeconds;
      const recurrence = p.recurrence ?? "interval";
      const intervalDays = recurrence === "interval" ? (p.intervalDays ?? 1) : null;
      if (
        p.sets !== existing.sets ||
        p.reps !== existing.reps ||
        restSeconds !== existing.rest_seconds ||
        holdSeconds !== existing.hold_seconds ||
        p.scheduledDate !== (existing.start_date ?? existing.assigned_date) ||
        recurrence !== (existing.recurrence ?? "interval") ||
        intervalDays !== (existing.interval_days ?? (recurrence === "interval" ? 1 : null)) ||
        (p.endDate ?? "") !== (existing.end_date ?? existing.assigned_date) ||
        !sameWeekdays(p.weekdays ?? [], existing.weekdays ?? [])
      ) return true;
    }
    return false;
  })();

  if (loading) {
    return <div className="flex items-center justify-center p-12 text-gray-500">Loading...</div>;
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Assign Exercise</h1>
      <p className="text-gray-500 mb-6">Assign exercises or a program to one of your patients.</p>


      <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-6 max-w-2xl">

        {/* Step 1 — Select Patient */}
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

        {/* Existing Assignments (shown when patient has assigned exercises) */}
        {assignPatientId && existingAssignments.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold text-gray-700">
                Currently Assigned to{" "}
                <span className="text-green-700">{selectedPatient?.name}</span>
              </p>
              {deleteSelected.size > 0 && (
                <button
                  onClick={() => { setDeleteError(""); setShowDeleteModal(true); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-medium rounded-lg transition"
                >
                  <TrashIcon />
                  End Selected ({deleteSelected.size})
                </button>
              )}
            </div>
            <div className="rounded-xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
              {existingAssignments.map((ex) => (
                <label
                  key={ex.exercise_id}
                  className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition ${
                    deleteSelected.has(ex.exercise_id) ? "bg-red-50" : "hover:bg-gray-50"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={deleteSelected.has(ex.exercise_id)}
                    onChange={() => toggleDelete(ex.exercise_id)}
                    className="w-4 h-4 accent-red-600 shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-gray-900">{ex.name}</span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-gray-500 shrink-0">
                    <span>
                      {ex.sets} sets ×{" "}
                      {getExerciseDefinition(ex.exercise_id)?.kind === "isometric"
                        ? `${ex.hold_seconds}s hold`
                        : `${ex.reps} reps`}
                    </span>
                    <span>{ex.rest_seconds}s rest</span>
                    <span className="text-green-700 font-medium">
                      {formatCadence({ recurrence: ex.recurrence, intervalDays: ex.interval_days, weekdays: ex.weekdays ?? [] })}
                    </span>
                  </div>
                </label>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-1.5">
              Select prescriptions to end. Historical occurrences and sessions will be preserved.
            </p>
          </div>
        )}

        {/* Step 2 — Load from Program */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            2. Load from Program{" "}
            <span className="text-gray-400 font-normal">(optional — merges with existing selection)</span>
          </label>
          {programs.length === 0 ? (
            <p className="text-gray-400 text-sm">No programs yet.</p>
          ) : (
            <>
              <select
                value={assignProgramId}
                onChange={(e) => handleProgramSelect(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
              >
                <option value="">— None —</option>
                {programs.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>

              {assignProgramId && (() => {
                const tmpl = programs.find((t) => t.id === assignProgramId);
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
                          {(ex.sets || ex.reps || ex.holdSeconds) && (
                            <span className="text-gray-400 font-mono ml-4 shrink-0">
                              {ex.sets ?? "?"}×
                              {prescriptionTargetText({
                                exerciseId: ex.exerciseId,
                                reps: ex.reps,
                                holdSeconds: ex.holdSeconds,
                              })}
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

        {/* Step 3 — Select & Configure Exercises */}
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
                minDate={minDate}
                isExisting={existingAssignments.some((e) => e.exercise_id === ex.id)}
                isEditing={editingExercises.has(ex.id)}
                onToggle={() => toggleAssign(ex.id)}
                onEdit={() => setEditingExercises((prev) => { const next = new Set(prev); next.add(ex.id); return next; })}
                onCancelEdit={() => {
                  setEditingExercises((prev) => { const next = new Set(prev); next.delete(ex.id); return next; });
                  const original = existingAssignments.find((e) => e.exercise_id === ex.id);
                  if (original) setAssignParams((prev) => ({ ...prev, [ex.id]: paramsFromExisting(original) }));
                }}
                onParam={(f, v) =>
                  setAssignParams((prev) => ({ ...prev, [ex.id]: { ...prev[ex.id], [f]: v } }))
                }
                onSchedule={(patch) =>
                  setAssignParams((prev) => ({ ...prev, [ex.id]: { ...prev[ex.id], ...patch } }))
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
                    minDate={minDate}
                    isExisting={existingAssignments.some((e) => e.exercise_id === ex.id)}
                    isEditing={editingExercises.has(ex.id)}
                    onToggle={() => toggleAssign(ex.id)}
                    onEdit={() => setEditingExercises((prev) => { const next = new Set(prev); next.add(ex.id); return next; })}
                    onCancelEdit={() => {
                      setEditingExercises((prev) => { const next = new Set(prev); next.delete(ex.id); return next; });
                      const original = existingAssignments.find((e) => e.exercise_id === ex.id);
                      if (original) setAssignParams((prev) => ({ ...prev, [ex.id]: paramsFromExisting(original) }));
                    }}
                    onParam={(f, v) =>
                      setAssignParams((prev) => ({ ...prev, [ex.id]: { ...prev[ex.id], [f]: v } }))
                    }
                    onSchedule={(patch) =>
                      setAssignParams((prev) => ({ ...prev, [ex.id]: { ...prev[ex.id], ...patch } }))
                    }
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {existingAssignments.length === 0 ? (
          <button
            onClick={handleAssign}
            disabled={assigning}
            className="px-6 py-2.5 bg-green-700 hover:bg-green-800 disabled:bg-gray-300 text-white text-sm font-medium rounded-lg transition"
          >
            {assigning ? "Saving..." : "Assign Exercises"}
          </button>
        ) : hasAssignChanges ? (
          <button
            onClick={handleAssign}
            disabled={assigning}
            className="px-6 py-2.5 bg-green-700 hover:bg-green-800 disabled:bg-gray-300 text-white text-sm font-medium rounded-lg transition"
          >
            {assigning ? "Saving..." : "Update Changes"}
          </button>
        ) : null}
      </div>

      {/* ── Delete Confirmation Modal ──────────────────────────────────────── */}
      {showDeleteModal && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50" onClick={() => setShowDeleteModal(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
              <h2 className="text-lg font-bold text-gray-900 mb-1">End Prescriptions</h2>
              <p className="text-sm text-gray-500 mb-4">
                The following prescriptions will stop future scheduling for{" "}
                <span className="font-semibold text-gray-700">{selectedPatient?.name}</span>:
              </p>

              <div className="rounded-xl border border-red-200 bg-red-50 divide-y divide-red-100 mb-4 overflow-hidden">
                {existingAssignments
                  .filter((e) => deleteSelected.has(e.exercise_id))
                  .map((ex) => (
                    <div key={ex.exercise_id} className="px-4 py-3">
                        <p className="text-sm font-semibold text-gray-900 mb-2">{ex.name}</p>
                        <div className="space-y-0.5 text-xs text-gray-600">
                          <p>Sets: {ex.sets}</p>
                          {getExerciseDefinition(ex.exercise_id)?.kind === "isometric" ? (
                            <p>Hold: {ex.hold_seconds}s</p>
                          ) : (
                            <p>Reps: {ex.reps}</p>
                          )}
                          <p>Rest: {ex.rest_seconds}s</p>
                          <p>Repeat: {formatCadence({ recurrence: ex.recurrence, intervalDays: ex.interval_days, weekdays: ex.weekdays ?? [] })}</p>
                          <p>From {fmtDate(ex.start_date ?? ex.assigned_date)} to {fmtDate(ex.end_date ?? ex.assigned_date)}</p>
                        </div>
                    </div>
                  ))}
              </div>

              <p className="text-xs text-amber-700 mb-4">
                Completed, missed, and session records remain available for historical review.
              </p>

              {deleteError && (
                <p className="text-xs text-red-600 mb-3">{deleteError}</p>
              )}

              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setShowDeleteModal(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmDelete}
                  disabled={deleting}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white text-sm font-medium rounded-lg transition"
                >
                  {deleting ? "Ending..." : "End Prescriptions"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Assign Error Modal ────────────────────────────────────────────── */}
      {showAssignError && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50" onClick={() => setShowAssignError(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 text-center">
              <div className="flex items-center justify-center w-12 h-12 rounded-full bg-red-100 mx-auto mb-4">
                <svg className="w-6 h-6 text-red-600" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
              </div>
              <h2 className="text-lg font-bold text-gray-900 mb-1">Required Fields</h2>
              <p className="text-sm text-gray-500 mb-5">{assignErrorMsg}</p>
              <button
                onClick={() => setShowAssignError(false)}
                className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition"
              >
                OK
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Assign Preview Modal ───────────────────────────────────────────── */}
      {showAssignPreview && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50" onClick={() => setShowAssignPreview(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
              <h2 className="text-lg font-bold text-gray-900 mb-1">Review Changes</h2>
              <p className="text-sm text-gray-500 mb-4">
                Assigning to{" "}
                <span className="font-semibold text-gray-700">{selectedPatient?.name}</span>
              </p>

              {/* New */}
              {previewItems.filter((i) => i.type === "new").length > 0 && (
                <div className="mb-4">
                  <p className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-2">
                    New ({previewItems.filter((i) => i.type === "new").length})
                  </p>
                  <div className="rounded-xl border border-green-200 bg-green-50 divide-y divide-green-100 overflow-hidden">
                    {previewItems.filter((i) => i.type === "new").map((item) => (
                      <div key={item.exerciseId} className="px-4 py-3">
                        <p className="text-sm font-semibold text-gray-900 mb-2">{item.name}</p>
                        <div className="space-y-0.5 text-xs text-gray-600">
                          <PrescriptionDetails exerciseId={item.exerciseId} snapshot={item.after} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Updated */}
              {previewItems.filter((i) => i.type === "updated").length > 0 && (
                <div className="mb-4">
                  <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-2">
                    Updated ({previewItems.filter((i) => i.type === "updated").length})
                  </p>
                  <div className="rounded-xl border border-blue-200 bg-blue-50 divide-y divide-blue-100 overflow-hidden">
                    {previewItems.filter((i) => i.type === "updated").map((item) => (
                      <div key={item.exerciseId} className="px-4 py-3">
                        <p className="text-sm font-semibold text-gray-900 mb-3">{item.name}</p>
                        <div className="grid grid-cols-2 gap-3 text-xs">
                          <div className="bg-white/70 rounded-lg px-3 py-2.5 border border-red-200">
                            <p className="text-red-600 font-semibold mb-1.5">Before</p>
                            <div className="space-y-0.5 text-gray-600">
                              <PrescriptionDetails exerciseId={item.exerciseId} snapshot={item.before!} />
                            </div>
                          </div>
                          <div className="bg-white/70 rounded-lg px-3 py-2.5 border border-green-200">
                            <p className="text-green-600 font-semibold mb-1.5">After</p>
                            <div className="space-y-0.5 text-gray-600">
                              <PrescriptionDetails exerciseId={item.exerciseId} snapshot={item.after} />
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Unchanged */}
              {previewItems.filter((i) => i.type === "unchanged").length > 0 && (
                <div className="mb-4">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    Unchanged ({previewItems.filter((i) => i.type === "unchanged").length})
                  </p>
                  <div className="rounded-xl border border-gray-200 bg-gray-50 divide-y divide-gray-100 overflow-hidden">
                    {previewItems.filter((i) => i.type === "unchanged").map((item) => (
                      <div key={item.exerciseId} className="px-4 py-3">
                        <p className="text-sm font-semibold text-gray-700 mb-2">{item.name}</p>
                        <div className="space-y-0.5 text-xs text-gray-500">
                          <PrescriptionDetails exerciseId={item.exerciseId} snapshot={item.after} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex gap-3 justify-end pt-2">
                <button
                  onClick={() => setShowAssignPreview(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition"
                >
                  Back
                </button>
                <button
                  onClick={handleConfirmAssign}
                  disabled={assigning}
                  className="px-4 py-2 bg-green-700 hover:bg-green-800 disabled:bg-gray-300 text-white text-sm font-medium rounded-lg transition"
                >
                  {assigning ? "Saving..." : "Confirm"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── AssignRow ─────────────────────────────────────────────────────────────────

function AssignRow({
  exercise, checked, params, minDate, isExisting, isEditing, onToggle, onEdit, onCancelEdit, onParam, onSchedule,
}: {
  exercise: Exercise;
  checked: boolean;
  params: AssignmentParams;
  minDate: string;
  isExisting: boolean;
  isEditing: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  onParam: (field: "sets" | "reps" | "restSeconds" | "holdSeconds", val: number | undefined) => void;
  onSchedule: (patch: Partial<AssignmentParams>) => void;
}) {
  const locked = isExisting && !isEditing;
  // Isometric exercises (e.g. ex_006 T-pose) are timed holds, not rep-counted —
  // show a per-side "Hold (sec)" input instead of Reps.
  const isIsometric = getExerciseDefinition(exercise.id)?.kind === "isometric";
  const recurrence: Recurrence = params.recurrence ?? "interval";
  const weekdays = params.weekdays ?? [];
  const presetId = presetIdFor(params);
  const showWeekdayPicker = recurrence === "weekly";
  const applyPreset = (id: string) => {
    const preset = CADENCE_PRESETS.find((c) => c.id === id);
    if (!preset) return;
    onSchedule({
      recurrence: preset.recurrence,
      intervalDays: preset.recurrence === "interval" ? preset.intervalDays : undefined,
      // Seed a default weekday set when switching into a fixed times-per-week
      // preset; "Custom weekdays" keeps whatever is already chosen.
      weekdays:
        preset.recurrence === "weekly"
          ? preset.defaultWeekdays ?? (weekdays.length ? weekdays : [])
          : [],
    });
  };
  const toggleWeekday = (d: number) => {
    const next = weekdays.includes(d)
      ? weekdays.filter((x) => x !== d)
      : [...weekdays, d].sort((a, b) => a - b);
    onSchedule({ weekdays: next });
  };
  return (
    <div className={`rounded-xl border p-3 transition ${checked ? "border-green-300 bg-green-50" : "border-gray-200"}`}>
      <label className="flex items-start gap-3 cursor-pointer">
        <input type="checkbox" checked={checked} onChange={onToggle} className="mt-1 w-4 h-4 accent-green-600" />
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-gray-900 text-sm">{exercise.name}</span>
            <span className="text-xs text-gray-400 font-mono">{exercise.id}</span>
            {exercise.is_custom && (
              <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 text-xs rounded-full">
                manual · no camera
              </span>
            )}
            {isExisting && (
              <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full">assigned</span>
            )}
            {isExisting && checked && !isEditing && (
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); onEdit(); }}
                className="flex items-center gap-1 px-2 py-0.5 bg-red-600 hover:bg-red-700 text-white text-xs font-medium rounded-full transition"
              >
                <PencilIcon />
                Edit
              </button>
            )}
            {isExisting && isEditing && (
              <>
                <span className="px-1.5 py-0.5 bg-red-100 text-red-700 text-xs rounded-full font-medium">editing</span>
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); onCancelEdit(); }}
                  className="flex items-center gap-1 px-2 py-0.5 bg-gray-500 hover:bg-gray-600 text-white text-xs font-medium rounded-full transition"
                >
                  ✕ Cancel Edit
                </button>
              </>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5">{exercise.description}</p>
          {exercise.monitoring_mode === "manual" && (
            <p className="mt-1 text-xs text-amber-700">
              The patient completes this task manually; pose tracking and camera scoring are not used.
            </p>
          )}
        </div>
      </label>
      {checked && (
        <div className="mt-3 pl-7 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Sets <span className="text-red-500">*</span></label>
              <input
                type="number" min={1} value={params.sets ?? ""}
                onChange={(e) => onParam("sets", e.target.value ? Number(e.target.value) : undefined)}
                placeholder="e.g. 3"
                disabled={locked}
                className={`w-full border rounded-lg px-2 py-1.5 text-sm ${locked ? "border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed" : "border-gray-300"}`}
              />
            </div>
            {isIsometric ? (
              <div>
                <label className="block text-xs text-gray-500 mb-1">Hold (sec)</label>
                <input
                  type="number" min={1} value={params.holdSeconds ?? ""}
                  onChange={(e) => onParam("holdSeconds", e.target.value ? Number(e.target.value) : undefined)}
                  placeholder={`${DEFAULT_HOLD_SECONDS}`}
                  disabled={locked}
                  className={`w-full border rounded-lg px-2 py-1.5 text-sm ${locked ? "border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed" : "border-gray-300"}`}
                />
              </div>
            ) : (
              <div>
                <label className="block text-xs text-gray-500 mb-1">Reps <span className="text-red-500">*</span></label>
                <input
                  type="number" min={1} value={params.reps ?? ""}
                  onChange={(e) => onParam("reps", e.target.value ? Number(e.target.value) : undefined)}
                  placeholder="e.g. 12"
                  disabled={locked}
                  className={`w-full border rounded-lg px-2 py-1.5 text-sm ${locked ? "border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed" : "border-gray-300"}`}
                />
              </div>
            )}
            <div>
              <label className="block text-xs text-gray-500 mb-1">Rest (sec)</label>
              <input
                type="number" min={0} value={params.restSeconds ?? ""}
                onChange={(e) => onParam("restSeconds", e.target.value ? Number(e.target.value) : undefined)}
                placeholder="60"
                disabled={locked}
                className={`w-full border rounded-lg px-2 py-1.5 text-sm ${locked ? "border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed" : "border-gray-300"}`}
              />
            </div>
          </div>
          {/* Schedule: a repeat cadence over a start–end date range */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">
              Repeat <span className="text-red-500">*</span>
            </label>
            <select
              value={presetId}
              onChange={(e) => applyPreset(e.target.value)}
              disabled={locked}
              className={`w-full border rounded-lg px-2 py-1.5 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-green-300 ${locked ? "border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed" : "border-gray-300"}`}
            >
              {CADENCE_PRESETS.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>

            {showWeekdayPicker && (
              <div className="flex flex-wrap gap-1 mb-2">
                {WEEKDAY_SHORT.map((lbl, d) => {
                  const on = weekdays.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      disabled={locked}
                      onClick={() => toggleWeekday(d)}
                      aria-pressed={on}
                      className={`w-9 h-8 rounded-md text-xs font-medium transition ${
                        on
                          ? "bg-green-700 text-white"
                          : "border border-gray-300 text-gray-600 hover:bg-gray-50"
                      } ${locked ? "cursor-not-allowed opacity-60" : ""}`}
                    >
                      {lbl.slice(0, 2)}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] text-gray-400 mb-1">
                  Start date <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  min={minDate}
                  value={params.scheduledDate ?? ""}
                  onChange={(e) => onSchedule({ scheduledDate: e.target.value })}
                  disabled={locked}
                  className={`w-full border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-300 ${locked ? "border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed" : "border-gray-300"}`}
                />
              </div>
              <div>
                <label className="block text-[11px] text-gray-400 mb-1">
                  End date <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  min={params.scheduledDate || minDate}
                  value={params.endDate ?? ""}
                  onChange={(e) => onSchedule({ endDate: e.target.value })}
                  disabled={locked}
                  className={`w-full border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-300 ${locked ? "border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed" : "border-gray-300"}`}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function PencilIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="currentColor">
      <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="currentColor">
      <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
    </svg>
  );
}
