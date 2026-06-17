"use client";

import React from "react";
import Link from "next/link";
import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import NotificationBell from "../_components/NotificationBell";

// ── Nav icons ──────────────────────────────────────────────────────────────

function HomeIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
      <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 12c2.7 0 5-2.3 5-5s-2.3-5-5-5-5 2.3-5 5 2.3 5 5 5zm0 2c-3.3 0-10 1.7-10 5v1h20v-1c0-3.3-6.7-5-10-5z"/>
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
      <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
    </svg>
  );
}

function DumbbellIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.57 14.86L22 13.43 20.57 12 17 15.57 8.43 7 12 3.43 10.57 2 9.14 3.43 7.71 2 5.57 4.14 4.14 2.71 2.71 4.14l1.43 1.43L2 7.71l1.43 1.43L2 10.57 3.43 12 7 8.43 15.57 17 12 20.57 13.43 22l1.43-1.43L16.29 22l2.14-2.14 1.43 1.43 1.43-1.43-1.43-1.43L22 16.29z"/>
    </svg>
  );
}

function ClipboardIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
      <path d="M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm-2 14l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z"/>
    </svg>
  );
}

function DocumentIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
      <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
      <path d="M9 2 7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 14c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/>
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4C2.9 3 2 3.9 2 5v14c0 1.1.9 2 2 2h8v-2H4V5z"/>
    </svg>
  );
}

// ── Nav items ──────────────────────────────────────────────────────────────

const NAV = [
  { href: "/dashboard/therapist",           Icon: HomeIcon,      label: "Dashboard",        exact: true  },
  { href: "/dashboard/therapist/profile",   Icon: PersonIcon,    label: "View Profile"                   },
  { href: "/dashboard/therapist/patients",  Icon: UsersIcon,     label: "Manage Patients"                },
  { href: "/dashboard/therapist/exercises", Icon: DumbbellIcon,  label: "Manage Exercises"               },
  { href: "/dashboard/therapist/assign",    Icon: ClipboardIcon, label: "Assign Exercise"                },
  { href: "/dashboard/therapist/programs",  Icon: DocumentIcon,  label: "Exercise Program"               },
  { href: "/camera",                        Icon: CameraIcon,    label: "Camera"                         },
];

// ── Layout ─────────────────────────────────────────────────────────────────

export default function TherapistLayout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");

  return (
    <div
      className="min-h-screen flex bg-green-50 text-gray-900 print:block print:min-h-0 print:bg-white"
      style={{ colorScheme: "light" }}
    >

      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside className={`fixed inset-y-0 left-0 z-40 w-64 bg-green-900 text-white p-6 flex flex-col transform transition-transform duration-200 print:hidden
        ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
        md:static md:translate-x-0 md:flex md:flex-col md:flex-shrink-0`}>
        <div className="mb-8">
          <div className="text-lg font-semibold text-white">{user?.name || "Therapist"}</div>
        </div>

        <nav>
          <ul className="space-y-1">
            {NAV.map(({ href, Icon, label, exact }) => (
              <li key={href}>
                <Link
                  href={href}
                  onClick={() => setSidebarOpen(false)}
                  className={`flex items-center gap-2 px-3 py-2 rounded text-sm transition ${
                    isActive(href, exact)
                      ? "bg-green-700 text-white font-medium"
                      : "text-green-200 hover:bg-green-800"
                  }`}
                >
                  <Icon />
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
            <LogoutIcon />
            Log Out
          </button>
        </div>
      </aside>

      <main className="flex-1 p-4 sm:p-6 overflow-y-auto min-w-0 print:p-0 print:overflow-visible">
        <div className="flex justify-between items-center mb-6 print:hidden">
          <button
            className="md:hidden flex items-center gap-2 px-3 py-2 bg-green-700 hover:bg-green-800 text-white text-sm font-medium rounded transition"
            onClick={() => setSidebarOpen(true)}
          >
            ☰ Menu
          </button>
          <div className="md:hidden flex-1" />
          <div className="ml-auto">
            <NotificationBell />
          </div>
        </div>
        {children}
      </main>
    </div>
  );
}
