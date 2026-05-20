"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";

const NAV = [
  { href: "/dashboard/therapist",           label: "🏠 Dashboard",        exact: true },
  { href: "/dashboard/therapist/profile",   label: "👤 View Profile" },
  { href: "/dashboard/therapist/patients",  label: "👥 Manage Patients" },
  { href: "/dashboard/therapist/exercises", label: "🏋️ Manage Exercises" },
  { href: "/dashboard/therapist/assign",    label: "📋 Assign Exercise" },
  { href: "/dashboard/therapist/programs",  label: "📝 Exercise Program" },
  { href: "/camera",                        label: "📷 Camera" },
];

export default function TherapistLayout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");

  return (
    <div className="min-h-screen flex bg-green-50">

      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside className={`fixed inset-y-0 left-0 z-40 w-64 bg-green-900 text-white p-6 flex flex-col transform transition-transform duration-200
        ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
        md:static md:translate-x-0 md:flex md:flex-col md:flex-shrink-0`}>
        <div className="mb-8">
          <div className="text-sm text-green-400">Therapist</div>
          <div className="mt-1 text-lg font-semibold text-white">{user?.name || "Therapist"}</div>
        </div>

        <nav>
          <ul className="space-y-1">
            {NAV.map(({ href, label, exact }) => (
              <li key={href}>
                <Link
                  href={href}
                  onClick={() => setSidebarOpen(false)}
                  className={`flex px-3 py-2 rounded text-sm transition ${
                    isActive(href, exact)
                      ? "bg-green-700 text-white font-medium"
                      : "text-green-200 hover:bg-green-800"
                  }`}
                >
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="mt-auto pt-6 mb-4">
          <button
            onClick={async () => { await logout(); router.push("/"); }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded bg-red-600 hover:bg-red-700 text-white text-sm font-medium transition"
          >
            🚪 Log Out
          </button>
        </div>
      </aside>

      <main className="flex-1 p-4 sm:p-6 overflow-y-auto min-w-0">
        <button
          className="md:hidden mb-4 px-3 py-2 border border-gray-300 rounded text-sm text-gray-600 hover:bg-gray-50 bg-white"
          onClick={() => setSidebarOpen(true)}
        >
          ☰ Menu
        </button>
        {children}
      </main>
    </div>
  );
}
