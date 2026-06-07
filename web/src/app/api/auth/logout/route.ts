import { NextRequest, NextResponse } from "next/server";
import { createAdminNotification } from "@/lib/db";

export async function POST(request: NextRequest) {
  const authToken = request.cookies.get("auth_token");
  let userName = "";
  let userRole = "";

  if (authToken) {
    try {
      const user = JSON.parse(authToken.value);
      userName = user.name || "";
      userRole = user.role || "";
    } catch (e) {
      console.error("Failed to parse auth_token on logout", e);
    }
  }

  // Log logout event for admins if the user is a patient or therapist
  if (userName && (userRole === "patient" || userRole === "therapist")) {
    try {
      await createAdminNotification(
        "User Logged Out",
        `${userName} has logged out.`,
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

  response.cookies.delete({
    name: "auth_token",
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });

  return response;
}
