"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";

const DASHBOARD_BY_ROLE = {
  admin: "/dashboard/admin",
  therapist: "/dashboard/therapist",
  patient: "/dashboard/patient",
} as const;

type UserRole = keyof typeof DASHBOARD_BY_ROLE;

function expectedDashboardRole(pathname: string): UserRole | null {
  if (pathname.startsWith("/dashboard/admin")) return "admin";
  if (pathname.startsWith("/dashboard/therapist")) return "therapist";
  if (pathname.startsWith("/dashboard/patient")) return "patient";
  return null;
}

function isProtectedAppPath(pathname: string): boolean {
  return pathname === "/dashboard" ||
    pathname.startsWith("/dashboard/") ||
    pathname === "/camera" ||
    pathname.startsWith("/camera/");
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const protectedPath = isProtectedAppPath(pathname);
  const expectedRole = expectedDashboardRole(pathname);
  const wrongDashboard = Boolean(
    user && expectedRole && user.role !== expectedRole,
  );

  useEffect(() => {
    if (!protectedPath || loading) return;

    if (!user) {
      router.replace("/login");
      return;
    }

    if (expectedRole && user.role !== expectedRole) {
      router.replace(DASHBOARD_BY_ROLE[user.role]);
    }
  }, [expectedRole, loading, protectedPath, router, user]);

  if (!protectedPath) return children;

  // Do not render a role-specific shell until the database-backed /api/auth/me
  // check has confirmed the current user. This prevents archived accounts and
  // users on the wrong dashboard from seeing a stale or misleading page while
  // the redirect is taking effect.
  if (loading || !user || wrongDashboard) {
    return (
      <div
        className="min-h-screen grid place-items-center bg-green-50 text-sm text-green-900"
        role="status"
      >
        Verifying your session…
      </div>
    );
  }

  return children;
}
