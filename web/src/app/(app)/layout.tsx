"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, logout } = useAuth();

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
        <div className="max-w-7xl mx-auto px-6 py-3 flex justify-between items-center">
          <div className="flex gap-4">
            <Link href={dashboardHref} className="font-semibold">Dashboard</Link>
            <Link href="/camera">Camera</Link>
          </div>
          <button 
            onClick={handleLogout}
            className="px-4 py-2 bg-red-200 text-black rounded hover:bg-red-300 border"
          >
            Logout
          </button>
        </div>
      </nav>
      {children}
    </div>
  );
}
