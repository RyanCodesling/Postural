import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getDemoClockState, resetDemoClock, setDemoClock } from "@/lib/db";
import { demoClockEnabled } from "@/lib/demoClock";

// Off unless the development server was started with `npm run dev:demo`;
// production builds never offer it.
function unavailable() {
  return NextResponse.json(
    { error: "The demo clock is off. Start the app with npm run dev:demo to use it." },
    { status: 404 },
  );
}

export async function GET(request: NextRequest) {
  if (!demoClockEnabled(process.env)) return unavailable();
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json(await getDemoClockState(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("GET /api/demo-clock error:", error);
    return NextResponse.json({ error: "Failed to read demo clock." }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  if (!demoClockEnabled(process.env)) return unavailable();
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await request.json().catch(() => null);
    if (typeof body?.targetAt !== "string") {
      return NextResponse.json({ error: "Choose a demo date and time." }, { status: 400 });
    }
    await setDemoClock(body.targetAt, user.id);
    return NextResponse.json(await getDemoClockState(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if ((error as { code?: string }).code === "42P01") {
      return NextResponse.json(
        { error: "Run scripts/demo_clock_settings_pg.sql as the database owner first." },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to set demo clock." },
      { status: 400 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  if (!demoClockEnabled(process.env)) return unavailable();
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    await resetDemoClock(user.id);
    return NextResponse.json(await getDemoClockState(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if ((error as { code?: string }).code === "42P01") {
      return NextResponse.json(
        { error: "Run scripts/demo_clock_settings_pg.sql as the database owner first." },
        { status: 503 },
      );
    }
    console.error("DELETE /api/demo-clock error:", error);
    return NextResponse.json({ error: "Failed to reset demo clock." }, { status: 500 });
  }
}