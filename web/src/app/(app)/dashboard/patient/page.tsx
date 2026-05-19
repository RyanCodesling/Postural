"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";

interface PatientProfile {
  id: string;
  name: string;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  email: string;
  dateOfBirth: string | null;
  age: number | null;
  gender: string | null;
  diagnosis: string | null;
  prescription: string | null;
  condition: string | null;
  therapistId: string | null;
  therapistName: string | null;
}

interface AssignedExercise {
  exercise_id: string;
  name: string;
  description: string;
  status: string;
  sets: number;
  reps: number;
}

type ActiveTab = "dashboard" | "view-profile";

export default function PatientDashboardPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<ActiveTab>("dashboard");
  const [pageLoading, setPageLoading] = useState(true);
  const [patientProfile, setPatientProfile] = useState<PatientProfile | null>(null);
  const [exercises, setExercises] = useState<AssignedExercise[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (user && user.role !== "patient") { router.push("/dashboard"); return; }
    setPageLoading(false);
  }, [user, loading, router]);

  const loadData = async () => {
    if (!user?.id) return;
    try {
      const [profileRes, exercisesRes] = await Promise.all([
        fetch(`/api/users/${user.id}`),
        fetch("/api/patient-exercises"),
      ]);

      if (profileRes.ok) {
        const d = await profileRes.json();
        setPatientProfile(d.user ?? null);
      }

      if (exercisesRes.ok) {
        const d = await exercisesRes.json();
        setExercises(d.exercises ?? []);
      }
    } catch (err) {
      console.error("Error loading patient data:", err);
    } finally {
      setPageLoading(false);
    }
  };

  useEffect(() => {
    if (!loading && user?.id) loadData();
  }, [user?.id, loading]);

  const statusColor = (s: string) =>
    s === "completed"  ? "bg-green-100 text-green-700"
    : s === "in_progress" ? "bg-blue-100 text-blue-700"
    : "bg-gray-100 text-gray-600";

  const statusLabel = (s: string) =>
    s === "completed"  ? "Completed"
    : s === "in_progress" ? "In Progress"
    : "Pending";

  const NAV_TABS: { key: ActiveTab; label: string }[] = [
    { key: "dashboard",    label: "🏠 Dashboard" },
    { key: "view-profile", label: "👤 View Profile" },
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
          <div className="text-sm text-gray-500">Patient</div>
          <div className="mt-1 text-lg font-semibold text-gray-900">{user?.name || "Patient"}</div>
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
                href="/session"
                className="flex px-3 py-2 rounded text-sm text-gray-700 hover:bg-gray-100"
                onClick={() => setSidebarOpen(false)}
              >
                🕐 Session
              </Link>
            </li>
            <li>
              <Link
                href="/camera"
                className="flex px-3 py-2 rounded text-sm text-gray-700 hover:bg-gray-100"
                onClick={() => setSidebarOpen(false)}
              >
                📷 Start Session
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
            <p className="text-gray-500 mt-1">Welcome to your postural monitoring dashboard, {user?.name}.</p>

            <div className="mt-6">
              <Link
                href="/camera"
                className="inline-block px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded transition"
              >
                Start Session
              </Link>
            </div>
          </div>
        )}

        {/* ── View Profile ── */}
        {activeTab === "view-profile" && (
          <div>
            <h1 className="text-2xl font-bold text-gray-900 mb-1">My Profile</h1>
            <p className="text-gray-500 mb-6">Your account information.</p>

            {/* Patient Information */}
            <section className="bg-white border border-gray-200 rounded-2xl p-6 mb-6 max-w-2xl">
              <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-4">
                Patient Information
              </h2>

              {!patientProfile ? (
                <p className="text-gray-400 text-sm">Unable to load profile. Please contact your therapist.</p>
              ) : (
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
                  <ProfileField label="Full Name"    value={patientProfile.name} />
                  <ProfileField label="First Name"   value={patientProfile.firstName} />
                  <ProfileField label="Middle Name"  value={patientProfile.middleName} />
                  <ProfileField label="Last Name"    value={patientProfile.lastName} />
                  <ProfileField label="Email"        value={patientProfile.email} />
                  <ProfileField label="Gender"       value={patientProfile.gender} />
                  <ProfileField label="Age"          value={patientProfile.age != null ? String(patientProfile.age) : null} />
                  <ProfileField label="Date of Birth" value={patientProfile.dateOfBirth} />
                  <ProfileField label="Diagnosis"    value={patientProfile.diagnosis} />
                  <ProfileField label="Prescription" value={patientProfile.prescription} />
                  <ProfileField label="Condition"    value={patientProfile.condition} />
                  <ProfileField label="Assigned Therapist" value={patientProfile.therapistName} />
                </dl>
              )}
            </section>

            {/* Assigned Exercises */}
            <section className="bg-white border border-gray-200 rounded-2xl p-6 max-w-2xl">
              <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-4">
                Assigned Exercises ({exercises.length})
              </h2>

              {exercises.length === 0 ? (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
                  <p className="font-semibold mb-1">No exercises assigned yet</p>
                  <p>You currently have no exercises assigned to you. Please contact or inform your therapist to assign exercises to your account.</p>
                </div>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {exercises.map((ex) => (
                    <li key={ex.exercise_id} className="py-3 flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <p className="font-medium text-gray-900 text-sm">{ex.name}</p>
                        {ex.description && (
                          <p className="text-xs text-gray-500 mt-0.5">{ex.description}</p>
                        )}
                        <p className="text-xs text-gray-400 mt-1 font-mono">
                          {ex.sets} sets × {ex.reps} reps
                        </p>
                      </div>
                      <span className={`text-xs px-2 py-1 rounded-full font-medium shrink-0 ${statusColor(ex.status)}`}>
                        {statusLabel(ex.status)}
                      </span>
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

function ProfileField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs text-gray-500 font-medium mb-0.5">{label}</dt>
      <dd className="text-sm text-gray-900">
        {value ? value : (
          <span className="text-gray-400 italic">Not set — contact therapist</span>
        )}
      </dd>
    </div>
  );
}
