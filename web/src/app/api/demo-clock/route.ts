import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getDemoClockState, resetDemoClock, setDemoClock, setDemoClockMode } from "@/lib/db";
import { DemoClockError } from "@/lib/demoClock";

function failure(error: unknown) {
  if (error instanceof DemoClockError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (["42P01", "42703"].includes((error as { code?: string })?.code ?? "")) {
    return NextResponse.json({ error: "Run the updated scripts/demo_clock_settings_pg.sql as the database owner first." }, { status: 503 });
  }
  console.error("Demo clock request failed:", error);
  return NextResponse.json({ error: "Could not update demo settings." }, { status: 500 });
}

export async function GET(request: NextRequest) {
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

export async function PATCH(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.enabled !== "boolean" || Object.keys(body).length !== 1) {
      return NextResponse.json({ error: "Choose whether demo tools should be enabled." }, { status: 400 });
    }
    await setDemoClockMode(body.enabled, user.id);
    return NextResponse.json(await getDemoClockState(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}

export async function PUT(request: NextRequest) {
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
    return failure(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    await resetDemoClock(user.id);
    return NextResponse.json(await getDemoClockState(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return failure(error);
  }
}
