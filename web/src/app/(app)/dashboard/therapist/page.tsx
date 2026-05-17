"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";

interface User {
  id: string;
  name: string;
  email: string;
  role: "patient" | "therapist" | "admin";
  therapistId?: string;
}

interface PatientData {
  id: string;
  name: string;
  lastVisit: string;
}

export default function TherapistDashboardPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [patients, setPatients] = useState<PatientData[]>([]);
  const [pageLoading, setPageLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (loading) return;

    if (user && user.role !== "therapist") {
      router.push("/dashboard");
      return;
    }

    setPageLoading(false);
  }, [user, loading, router]);

  const loadAssignedPatients = async () => {
    if (!user?.id) return;

    try {
      const res = await fetch(`/api/users?role=patient&therapistId=${user.id}`);
      const data = await res.json();
      const patientData = (data.users ?? []).map((p: User) => ({
        id: p.id,
        name: p.name,
        lastVisit: new Date().toISOString().split("T")[0],
      }));
      setPatients(patientData);
    } catch (error) {
      console.error("Error loading patients:", error);
    } finally {
      setPageLoading(false);
    }
  };

  useEffect(() => {
    loadAssignedPatients();
  }, [user?.id]);

  const filtered = patients.filter((p) =>
    p.name.toLowerCase().includes(query.toLowerCase())
  );

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
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 bg-gray-50 border-r p-6 transform transition-transform duration-200 ease-in-out
          md:static md:translate-x-0 md:flex md:flex-col md:flex-shrink-0
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="mb-8">
          <div className="text-sm text-gray-500">Therapist</div>
          <div className="mt-1 text-lg font-semibold text-gray-900">
            {user?.name || "Therapist"}
          </div>
        </div>

        <nav aria-label="Therapist navigation">
          <ul className="space-y-2">
            <li>
              <Link
                href="/dashboard/therapist"
                className="flex items-center px-3 py-2 rounded text-gray-700 hover:bg-gray-100"
                onClick={() => setSidebarOpen(false)}
              >
                <span className="mr-3">👥 Patients</span>
              </Link>
            </li>
            <li>
              <Link
                href="/dashboard/therapist/templates"
                className="flex items-center px-3 py-2 rounded text-gray-700 hover:bg-gray-100"
                onClick={() => setSidebarOpen(false)}
              >
                <span className="mr-3">📋 Exercise Templates</span>
              </Link>
            </li>
            <li>
              <a
                className="flex items-center px-3 py-2 rounded text-gray-700 hover:bg-gray-100 cursor-pointer"
                role="button"
              >
                ⚙️ Settings
              </a>
            </li>
          </ul>
        </nav>
      </aside>

      {/* Main content */}
      <main className="flex-1 p-4 sm:p-6 min-w-0">
        {/* Mobile hamburger */}
        <button
          className="md:hidden mb-4 p-2 rounded border bg-gray-100 hover:bg-gray-200 transition"
          onClick={() => setSidebarOpen(true)}
          aria-label="Open sidebar"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold">Therapist Dashboard</h1>
            <p className="text-gray-600 mt-1">Manage your patients and sessions.</p>
          </div>
          <button
            onClick={loadAssignedPatients}
            className="self-start sm:self-auto px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded transition"
          >
            🔄 Refresh
          </button>
        </div>

        <div className="mt-6">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search patients"
            className="w-full max-w-sm border p-2 rounded"
          />
        </div>

        <div className="mt-6 grid gap-4">
          {pageLoading ? (
            <div className="text-center py-8 text-gray-500">Loading patients...</div>
          ) : patients.length === 0 ? (
            <div className="bg-blue-50 border border-blue-200 p-4 rounded text-blue-800">
              <p className="font-semibold mb-1">No patients assigned yet</p>
              <p className="text-sm mb-3">
                The admin will assign patients to you. Check back here once patients are assigned.
              </p>
              <button
                onClick={loadAssignedPatients}
                className="text-blue-600 hover:text-blue-800 font-medium underline"
              >
                Click to refresh
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-gray-500">No patients found matching your search.</div>
          ) : (
            filtered.map((p) => (
              <div key={p.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-4 border rounded gap-3">
                <div>
                  <div className="font-semibold">{p.name}</div>
                  <div className="text-sm text-gray-500">Last visit: {p.lastVisit}</div>
                </div>
                <div className="flex gap-2">
                  <Link href={`/dashboard/therapist/patients/${p.id}`} className="px-3 py-1 border rounded text-sm">View</Link>
                  <button className="px-3 py-1 bg-green-600 text-white rounded text-sm">Start Session</button>
                </div>
              </div>
            ))
          )}
        </div>
      </main>
    </div>
  );
}
