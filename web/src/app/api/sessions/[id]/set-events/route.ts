import { NextRequest, NextResponse } from "next/server";
import { getSessionOwner, insertSetEvents, type SetEventRow } from "@/lib/db";

function getSessionUser(request: NextRequest) {
  const authToken = request.cookies.get("auth_token");
  if (!authToken) return null;
  try {
    return JSON.parse(authToken.value);
  } catch {
    return null;
  }
}

const EXERCISE_KINDS = new Set(["dynamic", "isometric"]);
const TERMINATION_REASONS = new Set(["min_reached", "user", "capture_lost", "stall"]);

const isPositiveInt = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 1;
const isNonNegInt = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0;
const isFiniteNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
const isNonNegNum = (v: unknown): v is number => isFiniteNum(v) && v >= 0;
const isParseableTs = (v: unknown): v is string =>
  typeof v === "string" && !Number.isNaN(Date.parse(v));

function normalizeRows(raw: unknown): SetEventRow[] | null {
  if (!Array.isArray(raw)) return null;
  const rows: SetEventRow[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object") return null;
    const r = item as Record<string, unknown>;
    if (
      !isPositiveInt(r.setIndex) ||
      typeof r.exerciseKind !== "string" ||
      !EXERCISE_KINDS.has(r.exerciseKind) ||
      !isNonNegInt(r.targetReps) ||
      !isNonNegInt(r.leftReps) ||
      !isNonNegInt(r.rightReps) ||
      !isNonNegInt(r.pairedReps) ||
      !isNonNegNum(r.targetHoldMs) ||
      !isNonNegNum(r.pairedHoldMs) ||
      !isNonNegNum(r.durationMs) ||
      typeof r.terminatedBy !== "string" ||
      !TERMINATION_REASONS.has(r.terminatedBy) ||
      !isNonNegNum(r.asymmetryIndex) ||
      !isParseableTs(r.startTs) ||
      !isParseableTs(r.endTs)
    ) {
      return null;
    }
    // Optional exploratory JSONB blob (isometric hold quality). Accept only a
    // plain non-null object; a malformed value is dropped, not rejected, so it
    // never fails an otherwise-valid set row.
    const holdQuality =
      r.holdQuality !== null &&
      typeof r.holdQuality === "object" &&
      !Array.isArray(r.holdQuality)
        ? r.holdQuality
        : undefined;
    rows.push({
      setIndex: r.setIndex as number,
      exerciseKind: r.exerciseKind as SetEventRow["exerciseKind"],
      targetReps: r.targetReps as number,
      leftReps: r.leftReps as number,
      rightReps: r.rightReps as number,
      pairedReps: r.pairedReps as number,
      targetHoldMs: r.targetHoldMs as number,
      pairedHoldMs: r.pairedHoldMs as number,
      durationMs: r.durationMs as number,
      terminatedBy: r.terminatedBy as SetEventRow["terminatedBy"],
      asymmetryIndex: r.asymmetryIndex as number,
      holdQuality,
      startTs: r.startTs as string,
      endTs: r.endTs as string,
    });
  }
  return rows;
}

// POST /api/sessions/[id]/set-events — batch-insert set outcomes for a session.
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
    const rows = normalizeRows(body?.sets);
    if (rows === null) {
      return NextResponse.json({ error: "Invalid set_events payload" }, { status: 400 });
    }

    await insertSetEvents(sessionId, rows);
    return NextResponse.json({ success: true, inserted: rows.length });
  } catch (error) {
    console.error("POST /api/sessions/[id]/set-events error:", error);
    return NextResponse.json({ error: "Failed to insert set events" }, { status: 500 });
  }
}
