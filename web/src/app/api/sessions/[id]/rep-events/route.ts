import { NextRequest, NextResponse } from "next/server";
import { insertRepEvents, getSessionOwner, type RepEventRow } from "@/lib/db";

function getSessionUser(request: NextRequest) {
  const authToken = request.cookies.get("auth_token");
  if (!authToken) return null;
  try {
    return JSON.parse(authToken.value);
  } catch {
    return null;
  }
}

const SIDES = new Set(["left", "right", "both", "bidirectional"]);
const CLASSIFICATIONS = new Set(["complete", "partial"]);

const isPositiveInt = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 1;
const isFiniteNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
const isNonNegNum = (v: unknown): v is number => isFiniteNum(v) && v >= 0;
const isParseableTs = (v: unknown): v is string =>
  typeof v === "string" && !Number.isNaN(Date.parse(v));

function normalizeRows(raw: unknown): RepEventRow[] | null {
  if (!Array.isArray(raw)) return null;
  const rows: RepEventRow[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object") return null;
    const r = item as Record<string, unknown>;
    if (
      !isPositiveInt(r.repIndex) ||
      !isPositiveInt(r.setIndex) ||
      typeof r.side !== "string" ||
      !SIDES.has(r.side) ||
      !isFiniteNum(r.peakValue) ||
      !isNonNegNum(r.targetRom) ||
      !isNonNegNum(r.timeToPeakMs) ||
      !isNonNegNum(r.holdMs) ||
      !isNonNegNum(r.descentMs) ||
      !isNonNegNum(r.totalMs) ||
      typeof r.classification !== "string" ||
      !CLASSIFICATIONS.has(r.classification) ||
      !isParseableTs(r.startTs) ||
      !isParseableTs(r.endTs)
    ) {
      return null;
    }
    rows.push({
      repIndex: r.repIndex as number,
      setIndex: r.setIndex as number,
      side: r.side as RepEventRow["side"],
      peakValue: r.peakValue as number,
      targetRom: r.targetRom as number,
      timeToPeakMs: r.timeToPeakMs as number,
      holdMs: r.holdMs as number,
      descentMs: r.descentMs as number,
      totalMs: r.totalMs as number,
      classification: r.classification as RepEventRow["classification"],
      startTs: r.startTs as string,
      endTs: r.endTs as string,
    });
  }
  return rows;
}

// POST /api/sessions/[id]/rep-events — batch-insert counted reps for a session.
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
    const rows = normalizeRows(body?.reps);
    if (rows === null) {
      return NextResponse.json({ error: "Invalid rep_events payload" }, { status: 400 });
    }

    await insertRepEvents(sessionId, rows);
    return NextResponse.json({ success: true, inserted: rows.length });
  } catch (error) {
    console.error("POST /api/sessions/[id]/rep-events error:", error);
    return NextResponse.json({ error: "Failed to insert rep events" }, { status: 500 });
  }
}
