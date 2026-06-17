import { NextRequest, NextResponse } from "next/server";
import { getUserById, getUserRawById, updateUserPassword, createAdminNotification } from "@/lib/db";
import { sendPasswordChangedEmail } from "@/lib/email";
import { comparePassword } from "@/lib/crypto";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, currentPassword, newPassword } = body;

    if (!userId || !currentPassword || !newPassword) {
      return NextResponse.json(
        { error: "userId, currentPassword, and newPassword are required" },
        { status: 400 }
      );
    }

    // Fetch the raw row to verify password (mapUser strips the password field)
    const rawUser = await getUserRawById(userId);
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

    await updateUserPassword(userId, newPassword);

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
    const user = await getUserById(userId);

    // Send confirmation email (fire-and-forget)
    if (user?.email) {
      sendPasswordChangedEmail(user.email as string, user.name as string).catch(
        (err) => console.error("Failed to send password changed email:", err)
      );
    }

    // Refresh the auth cookie to clear mustChangePassword
    const sessionUser = {
      id: user!.id,
      email: user!.email,
      name: user!.name,
      role: user!.role,
      ...((user!.role === "therapist") && { clinicId: user!.clinicId }),
    };

    const response = NextResponse.json(
      { success: true },
      { status: 200 }
    );

    response.cookies.set("auth_token", JSON.stringify(sessionUser), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("POST /api/auth/change-password error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
