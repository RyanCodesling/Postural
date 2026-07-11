import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import {
  AUTH_COOKIE_NAME,
  SESSION_COOKIE_CLEAR_OPTIONS,
} from "@/lib/session-token";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser(request);
  if (!user) {
    const response = NextResponse.json(
      { error: "Not authenticated" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
    response.cookies.set(
      AUTH_COOKIE_NAME,
      "",
      SESSION_COOKIE_CLEAR_OPTIONS,
    );
    return response;
  }

  return NextResponse.json(
    { user },
    { status: 200, headers: NO_STORE_HEADERS },
  );
}
