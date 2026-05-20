import { NextRequest, NextResponse } from "next/server";
import { getTemplates, createTemplate } from "@/lib/db";

function getSessionUser(request: NextRequest) {
  const authToken = request.cookies.get("auth_token");
  if (!authToken) return null;
  try {
    return JSON.parse(authToken.value);
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  try {
    const user = getSessionUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "therapist") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const templates = await getTemplates(user.id);
    return NextResponse.json({ templates });
  } catch (error) {
    console.error("GET /api/templates error:", error);
    return NextResponse.json({ error: "Failed to fetch templates" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
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

    const id = await createTemplate({ therapistId: user.id, name, exercises });
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    console.error("POST /api/templates error:", error);
    return NextResponse.json({ error: "Failed to create template" }, { status: 500 });
  }
}
