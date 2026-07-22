import { NextRequest, NextResponse } from "next/server";
import { getUserById, getUserRawById, updateUserPassword, createAdminNotification } from "@/lib/db";
import { sendPasswordChangedEmail } from "@/lib/email";
import { comparePassword } from "@/lib/crypto";
import { getAuthenticatedUser } from "@/lib/auth-server";
import {
  AUTH_COOKIE_NAME,
  SESSION_COOKIE_OPTIONS,
  signSessionToken,
} from "@/lib/session-token";

export async function POST(request: NextRequest) {
  try {
    const authenticatedUser = await getAuthenticatedUser(request);
    if (!authenticatedUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { userId, currentPassword, newPassword } = body;

    if (userId !== undefined && userId !== authenticatedUser.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (!currentPassword || !newPassword) {
      return NextResponse.json(
        { error: "currentPassword and newPassword are required" },
        { status: 400 }
      );
    }

    // Fetch the raw row to verify password (mapUser strips the password field)
    const rawUser = await getUserRawById(authenticatedUser.id);
    if (!rawUser) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    const wasFirstLoginPasswordChange = rawUser.must_change_password;

    // Hashed or plaintext password comparison
    if (!comparePassword(currentPassword, rawUser.password)) {
      return NextResponse.json(
        { error: "Current password is incorrect" },
        { status: 401 }
      );
    }

    if (newPassword === currentPassword) {
      return NextResponse.json(
        { error: "New password must be different from your current password." },
        { status: 400 }
      );
    }

    await updateUserPassword(authenticatedUser.id, newPassword);

    // Log admin notification if changing password on first login
    if (wasFirstLoginPasswordChange) {
      try {
        await createAdminNotification(
          "First Login Password Change",
          `${rawUser.name} changed their password on first login.`,
          "first_login_password_change"
        );
      } catch (err) {
        console.error("Failed to create first login password change notification:", err);
      }
    }

    // Get the mapped user for the response cookie
    const user = await getUserById(authenticatedUser.id);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Send confirmation email (fire-and-forget)
    if (user?.email) {
      sendPasswordChangedEmail(user.email as string, user.name as string).catch(
        (err) => console.error("Failed to send password changed email:", err)
      );
    }

    // Refresh the auth cookie to clear mustChangePassword.
    const sessionToken = await signSessionToken({
      sub: user.id as string,
      role: user.role as "patient" | "therapist" | "admin",
      mustChangePassword: user.mustChangePassword === true,
    });

    const response = NextResponse.json(
      { success: true },
      { status: 200 }
    );

    response.cookies.set(
      AUTH_COOKIE_NAME,
      sessionToken,
      SESSION_COOKIE_OPTIONS,
    );

    return response;
  } catch (error) {
    console.error("POST /api/auth/change-password error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
