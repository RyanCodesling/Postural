import { NextRequest, NextResponse } from "next/server";
import { recordUserSignedOut } from "@/lib/db";
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

  // Show the user offline on the admin dashboard straight away.
  if (user) {
    try {
      await recordUserSignedOut(user.id);
    } catch (err) {
      console.error("Failed to record sign-out for user status:", err);
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
