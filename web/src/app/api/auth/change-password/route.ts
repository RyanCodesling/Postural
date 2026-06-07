import { NextRequest, NextResponse } from "next/server";
import { getUserById, getUserRawById, updateUserPassword } from "@/lib/db";
import { sendPasswordChangedEmail } from "@/lib/email";

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

    // Plaintext password comparison (existing system convention)
    if (rawUser.password !== currentPassword) {
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
