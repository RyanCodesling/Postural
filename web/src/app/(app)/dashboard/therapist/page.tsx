"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
  name: string;
  status: string;
  sets: number;
  reps: number;
}

interface PatientData {
  id: string;
  name: string;
  email: string;
  exercises: PatientExercise[];
}

interface TherapistProfile {
  id: string;
  name: string;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  email: string;
  clinicId: string | null;
  therapistIDNum: string | null;
  specialty: string | null;
  dateOfBirth: string | null;
  age: number | null;
  gender: string | null;
}

type ActiveTab = "dashboard" | "manage-patients" | "manage-exercises" | "assign-patient" | "view-profile";

export default function TherapistDashboardPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<ActiveTab>("dashboard");
  const [pageLoading, setPageLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [therapistProfile, setTherapistProfile] = useState<TherapistProfile | null>(null);

  // Manage Patients
  const [patients, setPatients] = useState<PatientData[]>([]);
  const [query, setQuery] = useState("");

  // Manage Exercises
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [editingExerciseId, setEditingExerciseId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [savingExercise, setSavingExercise] = useState(false);

  // Assign Patient
  const [templates, setTemplates] = useState<Template[]>([]);
  const [assignPatientId, setAssignPatientId] = useState("");
  const [assignTemplateId, setAssignTemplateId] = useState("");
  const [assignSelected, setAssignSelected] = useState<Set<string>>(new Set());
  const [assignParams, setAssignParams] = useState<Record<string, { sets?: number; reps?: number }>>({});
  const [assigning, setAssigning] = useState(false);
  const [assignSuccess, setAssignSuccess] = useState("");
  const [assignError, setAssignError] = useState("");

  useEffect(() => {
    if (loading) return;
    if (user && user.role !== "therapist") { router.push("/dashboard"); return; }
    setPageLoading(false);
  }, [user, loading, router]);

  const loadData = async () => {
    if (!user?.id) return;
    try {
      const [patientsRes, exercisesRes, templatesRes, profileRes] = await Promise.all([
        fetch(`/api/users?role=patient&therapistId=${user.id}`),
        fetch("/api/exercises"),
        fetch("/api/templates"),
        fetch(`/api/users/${user.id}`),
      ]);

      if (patientsRes.ok) {
        const data = await patientsRes.json();
        const users: { id: string; name: string; email: string }[] = data.users ?? [];
        const exResults = await Promise.all(
          users.map((p) =>
            fetch(`/api/patient-exercises?patientId=${p.id}`)
              .then((r) => r.json())
              .then((d) => ({ patientId: p.id, exercises: d.exercises ?? [] }))
              .catch(() => ({ patientId: p.id, exercises: [] }))
          )
        );
        const exMap: Record<string, PatientExercise[]> = {};
        exResults.forEach(({ patientId, exercises }) => { exMap[patientId] = exercises; });
        setPatients(users.map((p) => ({ ...p, exercises: exMap[p.id] ?? [] })));
      }

      if (exercisesRes.ok) {
        const d = await exercisesRes.json();
        setExercises(d.exercises ?? []);
      }

      if (templatesRes.ok) {
        const d = await templatesRes.json();
        setTemplates(d.templates ?? []);
      }

      if (profileRes.ok) {
        const d = await profileRes.json();
        setTherapistProfile(d.user ?? null);
      }
    } catch (err) {
      console.error("Error loading data:", err);
    } finally {
      setPageLoading(false);
    }
  };

  useEffect(() => {
    if (!loading && user?.id) loadData();
  }, [user?.id, loading]);

  // ── Manage Exercises ──────────────────────────────────────────────────
  const startEdit = (ex: Exercise) => {
    setEditingExerciseId(ex.id);
    setEditName(ex.name);
    setEditDesc(ex.description);
  };

  const cancelEdit = () => { setEditingExerciseId(null); setEditName(""); setEditDesc(""); };

  const saveExercise = async (id: string) => {
    if (!editName.trim() || !editDesc.trim()) return;
    setSavingExercise(true);
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
      setSavingExercise(false);
    }
  };

  // ── Assign Patient ────────────────────────────────────────────────────

  // Pre-load existing exercises when a patient is selected
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

  // Merge template exercises on top of existing selection (template overrides sets/reps for matching exercises)
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
      if (!res.ok) { const d = await res.json(); setAssignError(d.error ?? "Failed to assign."); return; }
      setAssignSuccess("Exercises assigned successfully.");
      setAssignPatientId(""); setAssignTemplateId("");
      setAssignSelected(new Set()); setAssignParams({});
      await loadData();
    } catch (err) {
      console.error("Error assigning:", err);
      setAssignError("Failed to assign exercises.");
    } finally {
      setAssigning(false);
    }
  };

  const statusColor = (s: string) =>
    s === "completed" ? "bg-green-100 text-green-700"
    : s === "in_progress" ? "bg-blue-100 text-blue-700"
    : "bg-gray-100 text-gray-600";

  const systemExercises = exercises.filter((e) => !e.is_custom);
  const customExercises = exercises.filter((e) => e.is_custom);
  const filtered = patients.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()));

  const NAV_TABS: { key: ActiveTab; label: string }[] = [
    { key: "dashboard",        label: "🏠 Dashboard" },
    { key: "view-profile",     label: "👤 View Profile" },
    { key: "manage-patients",  label: "👥 Manage Patients" },
    { key: "manage-exercises", label: "🏋️ Manage Exercises" },
    { key: "assign-patient",   label: "📋 Assign Exercise" },
  ];

  if (loading || pageLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-gray-500">Loading dashboard...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-white">

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-40 w-64 bg-gray-50 border-r p-6 flex flex-col transform transition-transform duration-200
        ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
        md:static md:translate-x-0 md:flex md:flex-col md:flex-shrink-0`}>
        <div className="mb-8">
          <div className="text-sm text-gray-500">Therapist</div>
          <div className="mt-1 text-lg font-semibold text-gray-900">{user?.name || "Therapist"}</div>
        </div>

        <nav>
          <ul className="space-y-1">
            {NAV_TABS.map(({ key, label }) => (
              <li key={key}>
                <button
                  onClick={() => { setActiveTab(key); setSidebarOpen(false); }}
                  className={`w-full text-left px-3 py-2 rounded text-sm transition ${
                    activeTab === key
                      ? "bg-green-100 text-green-800 font-medium"
                      : "text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  {label}
                </button>
              </li>
            ))}
            <li>
              <Link
                href="/dashboard/therapist/templates"
                className="flex px-3 py-2 rounded text-sm text-gray-700 hover:bg-gray-100"
                onClick={() => setSidebarOpen(false)}
              >
                📝 Exercise Program
              </Link>
            </li>
          </ul>
        </nav>
      </aside>

      {/* Main */}
      <main className="flex-1 p-4 sm:p-6 overflow-y-auto min-w-0">
        <button
          className="md:hidden mb-4 px-3 py-2 border border-gray-300 rounded text-sm text-gray-600 hover:bg-gray-50"
          onClick={() => setSidebarOpen(true)}
        >
          ☰ Menu
        </button>

        {/* ── Dashboard ── */}
        {activeTab === "dashboard" && (
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
            <p className="text-gray-500 mt-1">Welcome, {user?.name}.</p>
          </div>
        )}

        {/* ── Manage Patients ── */}
        {activeTab === "manage-patients" && (
          <div>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-2xl font-bold">Manage Patients</h1>
                <p className="text-gray-600 mt-1">Manage your patients and sessions.</p>
              </div>
              <button
                onClick={loadData}
                className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded transition"
              >
                🔄 Refresh
              </button>
            </div>

            <div className="mb-6">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search patients"
                className="w-full max-w-sm border p-2 rounded"
              />
            </div>

            <div className="grid gap-4">
              {patients.length === 0 ? (
                <div className="bg-blue-50 border border-blue-200 p-4 rounded text-blue-800">
                  <p className="font-semibold mb-1">No patients assigned yet</p>
                  <p className="text-sm mb-3">The admin will assign patients to you. Check back here once patients are assigned.</p>
                  <button onClick={loadData} className="text-blue-600 hover:text-blue-800 font-medium underline">
                    Click to refresh
                  </button>
                </div>
              ) : filtered.length === 0 ? (
                <div className="text-gray-500">No patients found matching your search.</div>
              ) : (
                filtered.map((p) => (
                  <div key={p.id} className="border rounded p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="font-semibold text-gray-900">{p.name}</div>
                        <div className="text-sm text-gray-500">{p.email}</div>

                        {p.exercises.length > 0 ? (
                          <div className="mt-3">
                            <div className="text-xs font-medium text-gray-500 mb-1">
                              Assigned Exercises ({p.exercises.length})
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {p.exercises.map((ex) => (
                                <span
                                  key={ex.exercise_id}
                                  className={`text-xs px-2 py-1 rounded-full font-medium ${statusColor(ex.status)}`}
                                >
                                  {ex.name} — {ex.sets}×{ex.reps}
                                </span>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div className="mt-2 text-xs text-gray-400">No exercises assigned yet</div>
                        )}
                      </div>

                      <div className="flex gap-2 ml-4 shrink-0">
                        <Link href={`/dashboard/therapist/patients/${p.id}`} className="px-3 py-1 border rounded text-sm">
                          View
                        </Link>
                        <button className="px-3 py-1 bg-green-600 text-white rounded text-sm">
                          Start Session
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* ── Manage Exercises ── */}
        {activeTab === "manage-exercises" && (
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
                    isEditing={editingExerciseId === ex.id}
                    editName={editName}
                    editDesc={editDesc}
                    saving={savingExercise}
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
                      isEditing={editingExerciseId === ex.id}
                      editName={editName}
                      editDesc={editDesc}
                      saving={savingExercise}
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
        )}

        {/* ── Assign Patient ── */}
        {activeTab === "assign-patient" && (
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
                  2. Load from Program <span className="text-gray-400 font-normal">(optional — merges with existing selection)</span>
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

                    {/* Template preview */}
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
                      onParam={(f, v) => setAssignParams((prev) => ({ ...prev, [ex.id]: { ...prev[ex.id], [f]: v } }))}
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
                          onParam={(f, v) => setAssignParams((prev) => ({ ...prev, [ex.id]: { ...prev[ex.id], [f]: v } }))}
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
        )}

        {/* ── View Profile ── */}
        {activeTab === "view-profile" && (
          <div>
            <h1 className="text-2xl font-bold text-gray-900 mb-1">My Profile</h1>
            <p className="text-gray-500 mb-6">Your account information.</p>

            {/* Therapist Information */}
            <section className="bg-white border border-gray-200 rounded-2xl p-6 mb-6 max-w-2xl">
              <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-4">
                Therapist Information
              </h2>

              {!therapistProfile ? (
                <p className="text-gray-400 text-sm">Unable to load profile. Please contact the admin.</p>
              ) : (
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
                  <ProfileField label="Full Name" value={therapistProfile.name} />
                  <ProfileField label="First Name" value={therapistProfile.firstName} />
                  <ProfileField label="Middle Name" value={therapistProfile.middleName} />
                  <ProfileField label="Last Name" value={therapistProfile.lastName} />
                  <ProfileField label="Email" value={therapistProfile.email} />
                  <ProfileField label="Therapist ID" value={therapistProfile.therapistIDNum ?? therapistProfile.id} />
                  <ProfileField label="Specialty" value={therapistProfile.specialty} />
                  <ProfileField label="Clinic ID" value={therapistProfile.clinicId} />
                  <ProfileField label="Gender" value={therapistProfile.gender} />
                  <ProfileField label="Age" value={therapistProfile.age != null ? String(therapistProfile.age) : null} />
                  <ProfileField label="Date of Birth" value={therapistProfile.dateOfBirth} />
                </dl>
              )}
            </section>

            {/* Assigned Patients */}
            <section className="bg-white border border-gray-200 rounded-2xl p-6 max-w-2xl">
              <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-4">
                Assigned Patients ({patients.length})
              </h2>

              {patients.length === 0 ? (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
                  <p className="font-semibold mb-1">No patients assigned yet</p>
                  <p>You currently have no patients assigned to you. Please contact or inform the admin to assign patients to your account.</p>
                </div>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {patients.map((p) => (
                    <li key={p.id} className="py-3 flex items-center justify-between gap-4">
                      <div>
                        <p className="font-medium text-gray-900 text-sm">{p.name}</p>
                        <p className="text-xs text-gray-500">{p.email}</p>
                      </div>
                      <span className="text-xs text-gray-400 font-mono shrink-0">{p.id}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}

      </main>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function ProfileField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs text-gray-500 font-medium mb-0.5">{label}</dt>
      <dd className="text-sm text-gray-900">
        {value ? value : (
          <span className="text-gray-400 italic">Not set — contact admin</span>
        )}
      </dd>
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
