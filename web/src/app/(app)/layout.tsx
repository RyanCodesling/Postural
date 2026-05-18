"use client";

import Image from "next/image";
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
            <Image src="/acc_bacoor_logo.png" alt="ACC Bacoor Logo" width={64} height={64} />
            <div className="hidden sm:flex items-center gap-4">
              <Link href={dashboardHref} className="font-semibold">Dashboard</Link>
              <Link href="/camera">Camera</Link>
              <Link href="/profile">Profile</Link>
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
              className="sm:hidden p-2 rounded hover:bg-blue-400 transition"
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label="Toggle menu"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {menuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
        <div className="max-w-7xl mx-auto px-6 py-3 flex justify-between items-center">
          <div className="flex gap-4">
            <Link href={dashboardHref} className="font-semibold">Dashboard</Link>
            <Link href="/camera">Camera</Link>
          </div>
        </div>

        {menuOpen && (
          <div className="sm:hidden border-t bg-blue-200 px-4 py-3 flex flex-col gap-1">
            <Link href={dashboardHref} className="font-semibold px-2 py-2 hover:bg-blue-300 rounded" onClick={() => setMenuOpen(false)}>Dashboard</Link>
            <Link href="/camera" className="px-2 py-2 hover:bg-blue-300 rounded" onClick={() => setMenuOpen(false)}>Camera</Link>
            <Link href="/profile" className="px-2 py-2 hover:bg-blue-300 rounded" onClick={() => setMenuOpen(false)}>Profile</Link>
            <button
              onClick={handleLogout}
              className="mt-1 w-full px-4 py-2 bg-red-200 text-black rounded hover:bg-red-300 border text-left"
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
