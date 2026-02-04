"use client";

import { useState, useMemo, useCallback } from "react";
import Link from "next/link";

type Patient = { id: string; name: string; lastVisit: string };

const SAMPLE: Patient[] = [
  { id: "p1", name: "Alice Johnson", lastVisit: "2026-01-20" },
  { id: "p2", name: "Bob Smith", lastVisit: "2026-01-15" },
  { id: "p3", name: "Carol Lee", lastVisit: "2025-12-30" },
];

export default function TherapistDashboardPage() {
  const [query, setQuery] = useState("");
  const patients = SAMPLE;

  const filtered = useMemo(() => {
    const lowerQuery = query.toLowerCase();
    return patients.filter((p) =>
      p.name.toLowerCase().includes(lowerQuery)
    );
  }, [query]);

  const handleQueryChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
  }, []);

  return (
    <div className="min-h-screen flex bg-white">
      <aside className="w-64 bg-gray-50 border-r p-6">
        <div className="mb-8">
          <div className="text-sm text-gray-500">Therapist</div>
          <div className="mt-1 text-lg font-semibold text-gray-900">You</div>
        </div>

        <nav aria-label="Therapist navigation">
          <ul className="space-y-2">
            <li>
              <Link
                href="/dashboard/therapist"
                className="flex items-center px-3 py-2 rounded text-gray-700 hover:bg-gray-100"
              >
                <span className="mr-3">Patients</span>
              </Link>
            </li>
            <li>
              <a className="flex items-center px-3 py-2 rounded text-gray-700 hover:bg-gray-100" href="#">
                Settings
              </a>
            </li>
          </ul>
        </nav>
      </aside>

      <main className="flex-1 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Therapist Dashboard</h1>
            <p className="text-gray-600 mt-1">Manage your patients and sessions.</p>
          </div>
          <div>
            <button className="px-4 py-2 bg-blue-600 text-white rounded">Add Patient</button>
          </div>
        </div>

        <div className="mt-6">
          <input
            value={query}
            onChange={handleQueryChange}
            placeholder="Search patients"
            className="w-full max-w-sm border p-2 rounded"
          />
        </div>

        <div className="mt-6 grid gap-4">
          {filtered.length === 0 ? (
            <div className="text-gray-500">No patients found.</div>
          ) : (
            filtered.map((p) => (
              <div key={p.id} className="flex items-center justify-between p-4 border rounded">
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
