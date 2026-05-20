"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";

export default function TherapistDashboardPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (user && user.role !== "therapist") router.push("/dashboard");
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12 text-gray-500">
        Loading dashboard...
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
      <p className="text-gray-500 mt-1">Welcome, {user?.name}.</p>
    </div>
  );
}
