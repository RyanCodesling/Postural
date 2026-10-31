import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { recordUserSeen } from "@/lib/db";

/** A signed-in page reporting that it is still open, for the admin's User status panel. */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await recordUserSeen(user.id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("POST /api/presence error:", error);
    return NextResponse.json({ error: "Failed to record presence" }, { status: 500 });
  }
}
