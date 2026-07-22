import { NextRequest, NextResponse } from "next/server";
import { createAdminNotification } from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth-server";
import {
  AUTH_COOKIE_NAME,
  SESSION_COOKIE_CLEAR_OPTIONS,
} from "@/lib/session-token";

export async function POST(request: NextRequest) {
  let user = null;
  try {
    user = await getAuthenticatedUser(request);
  } catch (error) {
    // Logout remains idempotent: even a DB/configuration failure must not stop
    // the browser from discarding its cookie.
    console.error("Failed to verify user during logout", error);
  }

  // Log logout event for admins if the user is a patient or therapist
  if (user && (user.role === "patient" || user.role === "therapist")) {
    try {
      await createAdminNotification(
        "User Logged Out",
        `${user.name} has logged out.`,
        "user_logout"
      );
    } catch (err) {
      console.error("Failed to log logout event:", err);
    }
  }

  const response = NextResponse.json(
    { success: true },
    { status: 200 }
  );

  response.cookies.set(
    AUTH_COOKIE_NAME,
    "",
    SESSION_COOKIE_CLEAR_OPTIONS,
  );

  return response;
}
