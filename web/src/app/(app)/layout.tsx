"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  const dashboardHref =
    user?.role === "admin"
      ? "/dashboard/admin"
      : user?.role === "therapist"
      ? "/dashboard/therapist"
      : user?.role === "patient"
      ? "/dashboard/patient"
      : "/dashboard";

  const handleLogout = async () => {
    await logout();
    router.push("/");
  };

  return (
    <div className="min-h-screen bg-gray-200">
      <nav className="border-b bg-blue-300">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex gap-4">
              <Link href={dashboardHref} className="font-semibold">Dashboard</Link>
              <Link href="/camera">Camera</Link>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleLogout}
              className="hidden sm:block px-4 py-2 bg-red-200 text-black rounded hover:bg-red-300 border"
            >
              Logout
            </button>
            <button
              onClick={() => setMenuOpen((o) => !o)}
              className="sm:hidden px-3 py-2 rounded border border-gray-400 bg-white text-gray-700"
              aria-label="Toggle menu"
            >
              ☰
            </button>
          </div>
        </div>

        {menuOpen && (
          <div className="sm:hidden border-t bg-blue-200 px-4 py-3 flex flex-col gap-2">
            <Link href={dashboardHref} className="font-semibold py-1" onClick={() => setMenuOpen(false)}>
              Dashboard
            </Link>
            <Link href="/camera" className="py-1" onClick={() => setMenuOpen(false)}>
              Camera
            </Link>
            <button
              onClick={handleLogout}
              className="mt-1 px-4 py-2 bg-red-200 text-black rounded hover:bg-red-300 border text-left"
            >
              Logout
            </button>
          </div>
        )}
      </nav>
      {children}
    </div>
  );
}
