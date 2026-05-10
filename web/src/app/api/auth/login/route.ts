import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/db";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password, role } = body;

    if (!email || !password || !role) {
      return NextResponse.json(
        { error: "Email, password, and role are required" },
        { status: 400 }
      );
    }

    // Query database for user
    const user = await getUser(email, role);

    if (!user || user.password !== password) {
      return NextResponse.json(
        { error: "Invalid email or password" },
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

    // Create response with user data
    const response = NextResponse.json(
      {
        success: true,
        user: sessionUser,
      },
      { status: 200 }
    );

    // Set a simple cookie for session
    response.cookies.set("auth_token", JSON.stringify(sessionUser), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: "/",
    });

    return response;
  } catch (error) {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
