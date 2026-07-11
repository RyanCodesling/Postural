import "server-only";

import type { NextRequest } from "next/server";
import { getUserRawById } from "@/lib/db";
import {
  AUTH_COOKIE_NAME,
  type UserRole,
  verifySessionToken,
} from "@/lib/session-token";

export type AuthenticatedUser = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  clinicId: string | null;
  mustChangePassword: boolean;
};

const PASSWORD_CHANGE_ALLOWED_API_PATHS = new Set([
  "/api/auth/me",
  "/api/auth/logout",
  "/api/auth/change-password",
]);

function isUserRole(value: unknown): value is UserRole {
  return value === "patient" || value === "therapist" || value === "admin";
}

export async function getAuthenticatedUser(
  request: NextRequest,
): Promise<AuthenticatedUser | null> {
  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  const session = await verifySessionToken(token);
  if (!session) return null;

  const rawUser = await getUserRawById(session.sub);
  if (
    !rawUser ||
    rawUser.is_archived === true ||
    typeof rawUser.id !== "string" ||
    rawUser.id !== session.sub ||
    typeof rawUser.email !== "string" ||
    typeof rawUser.name !== "string" ||
    !isUserRole(rawUser.role)
  ) {
    return null;
  }

  const user = {
    id: rawUser.id,
    email: rawUser.email,
    name: rawUser.name,
    role: rawUser.role,
    clinicId:
      typeof rawUser.clinicId === "string" ? rawUser.clinicId : null,
    mustChangePassword: rawUser.must_change_password === true,
  };

  const pathname = request.nextUrl.pathname.replace(/\/+$/, "");
  if (
    user.mustChangePassword &&
    pathname.startsWith("/api/") &&
    !PASSWORD_CHANGE_ALLOWED_API_PATHS.has(pathname)
  ) {
    return null;
  }

  return user;
}
