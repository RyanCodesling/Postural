import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser(request);
  if (!user) {
    // The cookie is left alone. Every page load sends this check, so its
    // answer can arrive after a sign-in made meanwhile, and clearing the
    // cookie then would sign that person straight back out. Log Out clears
    // it, and the proxy clears an invalid one when a protected page opens.
    return NextResponse.json(
      { error: "Not authenticated" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  return NextResponse.json(
    { user },
    { status: 200, headers: NO_STORE_HEADERS },
  );
}
