import { NextRequest, NextResponse } from "next/server";
import {
  getRawFramesForSession,
  getSessionOwner,
  getUsers,
  insertRawFrames,
  type RawFrameRow,
} from "@/lib/db";

function getSessionUser(request: NextRequest) {
  const authToken = request.cookies.get("auth_token");
  if (!authToken) return null;
  try {
    return JSON.parse(authToken.value);
  } catch {
    return null;
  }
}

const MAX_BATCH_ROWS = 300;

const isPositiveInt = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 1;
const isNonNegInt = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0;
const isParseableTs = (v: unknown): v is string =>
  typeof v === "string" && !Number.isNaN(Date.parse(v));
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

function normalizeRows(raw: unknown): RawFrameRow[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_BATCH_ROWS) return null;
  const rows: RawFrameRow[] = [];
  for (const item of raw) {
    if (!isPlainObject(item)) return null;
    if (
      !isPositiveInt(item.frameIndex) ||
      !isPositiveInt(item.setIndex) ||
      !isNonNegInt(item.elapsedMs) ||
      !isParseableTs(item.capturedAt) ||
      typeof item.traceKind !== "string" ||
      item.traceKind.length === 0 ||
      item.traceKind.length > 100 ||
      !isPlainObject(item.metrics) ||
      !isPlainObject(item.landmarks)
    ) {
      return null;
    }
    rows.push({
      frameIndex: item.frameIndex,
      setIndex: item.setIndex,
      elapsedMs: item.elapsedMs,
      capturedAt: item.capturedAt,
      traceKind: item.traceKind,
      metrics: item.metrics,
      landmarks: item.landmarks,
    });
  }
  return rows;
}

async function canReadSession(
  user: { id: string; role: string },
  owner: string,
): Promise<boolean> {
  if (user.role === "patient") return owner === user.id;
  if (user.role === "therapist") {
    const assignedPatients = await getUsers({ role: "patient", therapistId: user.id });
    return assignedPatients.some((p) => p.id === owner);
  }
  return false;
}

// GET /api/sessions/[id]/raw-frames - explicit raw metric trace retrieval.
// Kept separate from session detail so ordinary dashboard reads do not pull a
// potentially large per-frame payload.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const sessionId = Number(id);
    const user = getSessionUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!Number.isInteger(sessionId)) {
      return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
    }

    const owner = await getSessionOwner(sessionId);
    if (owner === null) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    if (!(await canReadSession(user, owner))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const frames = await getRawFramesForSession(sessionId);
    return NextResponse.json({ frames });
  } catch (error) {
    console.error("GET /api/sessions/[id]/raw-frames error:", error);
    return NextResponse.json({ error: "Failed to fetch raw frames" }, { status: 500 });
  }
}

// POST /api/sessions/[id]/raw-frames - batch insert raw metric-only frames.
// Patient-only and only for the patient's own session.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const sessionId = Number(id);
    const user = getSessionUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "patient") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (!Number.isInteger(sessionId)) {
      return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
    }

    const owner = await getSessionOwner(sessionId);
    if (owner === null) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    if (owner !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const rows = normalizeRows(body?.frames);
    if (rows === null) {
      return NextResponse.json({ error: "Invalid raw_frames payload" }, { status: 400 });
    }

    await insertRawFrames(sessionId, rows);
    return NextResponse.json({ success: true, inserted: rows.length });
  } catch (error) {
    console.error("POST /api/sessions/[id]/raw-frames error:", error);
    return NextResponse.json({ error: "Failed to insert raw frames" }, { status: 500 });
  }
}
