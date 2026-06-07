import { NextRequest, NextResponse } from "next/server";
import { getUserByEmail, updateUserPassword, validateAndConsumeResetToken } from "@/lib/db";
import { sendPasswordChangedEmail } from "@/lib/email";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, newPassword, resetToken } = body;

    if (!email || !newPassword || !resetToken) {
      return NextResponse.json(
        { error: "Email, newPassword, and resetToken are required" },
        { status: 400 }
      );
    }

    const tokenValid = await validateAndConsumeResetToken(email, resetToken);
    if (!tokenValid) {
      return NextResponse.json(
        { error: "Invalid or expired reset token. Please restart the password reset process." },
        { status: 401 }
      );
    }

    const user = await getUserByEmail(email);

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    if (newPassword === user.password) {
      return NextResponse.json(
        { error: "New password must be different from your current password." },
        { status: 400 }
      );
    }

    await updateUserPassword(user.id, newPassword);

    sendPasswordChangedEmail(email, user.name).catch((err) =>
      console.error("Failed to send password changed email:", err)
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("POST /api/auth/reset-password error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
