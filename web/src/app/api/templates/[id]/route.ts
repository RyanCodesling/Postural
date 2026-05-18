import { NextRequest, NextResponse } from "next/server";
import { updateTemplate, deleteTemplate } from "@/lib/db";

function getSessionUser(request: NextRequest) {
  const authToken = request.cookies.get("auth_token");
  if (!authToken) return null;
  try {
    return JSON.parse(authToken.value);
  } catch {
    return null;
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = getSessionUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "therapist") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await request.json();
    const { name, exercises } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: "Template name is required" }, { status: 400 });
    }
    if (!Array.isArray(exercises) || exercises.length === 0) {
      return NextResponse.json({ error: "At least one exercise is required" }, { status: 400 });
    }

    await updateTemplate(id, user.id, { name, exercises });
    return NextResponse.json({ success: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "";
    if (msg === "Not found or forbidden") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    console.error("PUT /api/templates/[id] error:", error);
    return NextResponse.json({ error: "Failed to update template" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = getSessionUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "therapist") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const deleted = await deleteTemplate(id, user.id);
    if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/templates/[id] error:", error);
    return NextResponse.json({ error: "Failed to delete template" }, { status: 500 });
  }
}
