import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "./auth-server";
import { demoClockAllowed } from "./demoClock";
import { getDemoClockState } from "./db";
import { SessionDateCorrectionError } from "./sessionDateCorrection";

export async function requireDateCorrectionAdmin(request: NextRequest): Promise<string> {
  if (!demoClockAllowed(process.env)) throw new SessionDateCorrectionError("Demo mode is off.", 404);
  const user = await getAuthenticatedUser(request);
  if (!user) throw new SessionDateCorrectionError("Unauthorized", 401);
  if (user.role !== "admin") throw new SessionDateCorrectionError("Forbidden", 403);
  if (!(await getDemoClockState()).enabled) throw new SessionDateCorrectionError("Enable demo tools in the admin dashboard first.", 404);
  return user.id;
}

export function dateCorrectionErrorResponse(error: unknown) {
  if (error instanceof SessionDateCorrectionError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if ((error as { code?: string })?.code === "42P01") {
    return NextResponse.json({ error: "Date correction setup is missing. Run scripts/session_date_corrections_pg.sql as the database owner first." }, { status: 503 });
  }
  console.error("Session date correction failed:", error);
  return NextResponse.json({ error: "Could not complete the date correction request." }, { status: 500 });
}
