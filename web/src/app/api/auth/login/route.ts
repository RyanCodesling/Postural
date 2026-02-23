import { NextRequest, NextResponse } from "next/server";

// Temporary mock credentials (no database)
const MOCK_USERS = {
  patient: {
    email: "patient@example.com",
    password: "patient123",
    role: "patient",
    id: "patient_001",
    name: "John Patient",
  },
  therapist: {
    email: "therapist@clinic.com",
    password: "therapist123",
    role: "therapist",
    id: "therapist_001",
    name: "Sarah Therapist",
    clinicId: "CLINIC_001",
  },
  admin: {
    email: "admin@postural.com",
    password: "admin123",
    role: "admin",
    id: "admin_001",
    name: "Admin User",
  },
};

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

    const user = Object.values(MOCK_USERS).find(
      (u) => u.role === role && u.email === email
    );

    if (!user || user.password !== password) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    // Create response with user data
    const response = NextResponse.json(
      {
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          ...(user.role === "therapist" && {
            clinicId: (user as any).clinicId,
          }),
        },
      },
      { status: 200 }
    );

    // Set a simple cookie for session
    response.cookies.set("auth_token", JSON.stringify(user), {
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
