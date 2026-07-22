import { NextRequest, NextResponse } from "next/server";
import { getUserByEmailWithArchived, createAdminNotification } from "@/lib/db";
import { comparePassword } from "@/lib/crypto";
import {
  AUTH_COOKIE_NAME,
  SESSION_COOKIE_OPTIONS,
  signSessionToken,
} from "@/lib/session-token";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    const user = await getUserByEmailWithArchived(email);

    if (!user) {
      return NextResponse.json(
        { error: "No account is registered with this email address." },
        { status: 401 }
      );
    }

    if (user.is_archived) {
      return NextResponse.json(
        { error: "Your account has been archived and you no longer have access." },
        { status: 403 }
      );
    }

    if (!comparePassword(password, user.password)) {
      return NextResponse.json(
        { error: "Invalid email or password." },
        { status: 401 }
      );
    }

    const sessionUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      ...(user.role === "therapist" && {
        clinicId: user.clinicId,
      }),
    };
    const mustChangePassword = user.must_change_password === true;
    const sessionToken = await signSessionToken({
      sub: user.id,
      role: user.role,
      mustChangePassword,
    });

    // Log admin notification on login (for therapists and patients)
    if (user.role !== "admin") {
      try {
        await createAdminNotification(
          "User Logged In",
          `${user.name} has logged in.`,
          "user_login"
        );
      } catch (err) {
        console.error("Failed to create user login notification:", err);
      }
    }

    const response = NextResponse.json(
      { success: true, user: sessionUser, mustChangePassword },
      { status: 200 }
    );

    response.cookies.set(
      AUTH_COOKIE_NAME,
      sessionToken,
      SESSION_COOKIE_OPTIONS,
    );

    return response;
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
