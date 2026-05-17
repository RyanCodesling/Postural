"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";

export default function PatientDashboardPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (loading) return;

    if (user && user.role !== "patient") {
      router.push("/dashboard");
    }
  }, [user, loading, router]);

  if (loading || !user) {
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
          <div className="text-sm text-gray-500">Signed in as</div>
          <div className="mt-1 text-lg font-semibold text-gray-900">{user.name}</div>
        </div>

        <nav aria-label="Main navigation">
          <ul className="space-y-2">
            <li>
              <Link
                href="/dashboard/patient"
                className="flex items-center px-3 py-2 rounded text-gray-700 hover:bg-gray-100"
                onClick={() => setSidebarOpen(false)}
              >
                <span className="mr-3 h-5 w-5 text-gray-500" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" className="h-5 w-5">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 11.5L12 4l9 7.5V20a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1V11.5z" />
                  </svg>
                </span>
                <span>Dashboard</span>
              </Link>
            </li>
            <li>
              <Link
                href="/session"
                className="flex items-center px-3 py-2 rounded text-gray-700 hover:bg-gray-100"
                onClick={() => setSidebarOpen(false)}
              >
                <span className="mr-3 h-5 w-5 text-gray-500" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" className="h-5 w-5">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </span>
                <span>Session</span>
              </Link>
            </li>
            <li>
              <a
                href="#"
                className="flex items-center px-3 py-2 rounded text-gray-700 hover:bg-gray-100"
              >
                <span className="mr-3 h-5 w-5 text-gray-500" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" className="h-5 w-5">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m9-3a9 9 0 11-18 0 9 9 0 0118 0z" transform="rotate(90 12 12)" />
                  </svg>
                </span>
                <span>History</span>
              </a>
            </li>
            <li>
              <Link
                href="/camera"
                className="flex items-center px-3 py-2 rounded text-gray-700 hover:bg-gray-100"
                onClick={() => setSidebarOpen(false)}
              >
                <span className="mr-3 h-5 w-5 text-gray-500" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" className="h-5 w-5">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m9-3a9 9 0 11-18 0 9 9 0 0118 0z" transform="rotate(90 12 12)" />
                  </svg>
                </span>
                <span>Start Session</span>
              </Link>
            </li>
            <li>
              <a
                href="#"
                className="flex items-center px-3 py-2 rounded text-gray-700 hover:bg-gray-100"
              >
                <span className="mr-3 h-5 w-5 text-gray-500" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" className="h-5 w-5">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m9-3a9 9 0 11-18 0 9 9 0 0118 0z" transform="rotate(90 12 12)" />
                  </svg>
                </span>
                <span>Exercises</span>
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

        <h1 className="text-xl sm:text-2xl font-bold">Dashboard</h1>
        <p className="text-gray-600 mt-2">Welcome to your postural monitoring dashboard.</p>

        <div className="mt-6">
          <button className="px-4 py-2 bg-green-600 text-white rounded">Start Session</button>
        </div>
      </main>
    </div>
  );
}
