import { NextRequest, NextResponse } from "next/server";
import { randomInt } from "crypto";
import { getUserByEmail, invalidateOTPs, createOTP } from "@/lib/db";
import { sendOTPEmail } from "@/lib/email";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email } = body;

    if (!email) {
      return NextResponse.json(
        { error: "Email is required" },
        { status: 400 }
      );
    }

    const user = await getUserByEmail(email);

    if (!user) {
      return NextResponse.json(
        { error: "No account found with this email address" },
        { status: 404 }
      );
    }

    await invalidateOTPs(email);

    const otp = randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    await createOTP(user.id, email, otp, expiresAt);

    sendOTPEmail(email, user.name, otp).catch((err) =>
      console.error("Failed to send OTP email:", err)
    );

    return NextResponse.json({
      success: true,
      message: "An OTP has been sent to your email.",
    });
  } catch (error) {
    console.error("POST /api/auth/forgot-password error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
