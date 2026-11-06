import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { insertRepEvents, getSessionOwner, type RepEventRow } from "@/lib/db";
import { isDynamicRepQuality } from "@/lib/pose/repQuality";

const SIDES = new Set(["left", "right", "both", "bidirectional"]);
const CLASSIFICATIONS = new Set(["complete", "partial"]);

const isPositiveInt = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 1;
const isFiniteNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
const isNonNegNum = (v: unknown): v is number => isFiniteNum(v) && v >= 0;
const isParseableTs = (v: unknown): v is string =>
  typeof v === "string" && !Number.isNaN(Date.parse(v));

export type RowRejection = { index: number; reason: string };

/**
 * Reason this row cannot be stored, or `null` when it is valid.
 *
 * Rows are judged individually on purpose. Rejecting the whole batch when one
 * row is malformed meant a single bad repetition discarded every repetition
 * sent with it — and because the client's `fetch` never inspected the status,
 * that loss was completely silent. For a data-collection instrument, losing one
 * repetition is far better than losing the set it arrived with.
 */
function rejectionReason(item: unknown): string | null {
  if (item === null || typeof item !== "object") return "not an object";
  const r = item as Record<string, unknown>;
  if (!isPositiveInt(r.repIndex)) return "repIndex must be a positive integer";
  if (!isPositiveInt(r.setIndex)) return "setIndex must be a positive integer";
  if (typeof r.side !== "string" || !SIDES.has(r.side)) return "invalid side";
  if (!isFiniteNum(r.peakValue)) return "peakValue must be finite";
  if (!isNonNegNum(r.targetRom)) return "targetRom must be >= 0";
  if (!isNonNegNum(r.timeToPeakMs)) return "timeToPeakMs must be >= 0";
  if (!isNonNegNum(r.holdMs)) return "holdMs must be >= 0";
  if (!isNonNegNum(r.descentMs)) return "descentMs must be >= 0";
  if (!isNonNegNum(r.totalMs)) return "totalMs must be >= 0";
  if (typeof r.classification !== "string" || !CLASSIFICATIONS.has(r.classification)) {
    return "invalid classification";
  }
  if (!isParseableTs(r.startTs)) return "startTs is not a parseable timestamp";
  if (!isParseableTs(r.endTs)) return "endTs is not a parseable timestamp";
  if (
    r.compensations !== undefined &&
    r.compensations !== null &&
    !isDynamicRepQuality(r.compensations)
  ) {
    return "compensations failed versioned dynamic-rep quality validation";
  }
  return null;
}

function normalizeRows(
  raw: unknown,
): { rows: RepEventRow[]; rejected: RowRejection[] } | null {
  if (!Array.isArray(raw)) return null;
  const rows: RepEventRow[] = [];
  const rejected: RowRejection[] = [];
  raw.forEach((item, index) => {
    const reason = rejectionReason(item);
    if (reason !== null) {
      rejected.push({ index, reason });
      return;
    }
    const r = item as Record<string, unknown>;
    const compensations =
      r.compensations === undefined || r.compensations === null
        ? null
        : (r.compensations as RepEventRow["compensations"]);
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
      compensations,
      startTs: r.startTs as string,
      endTs: r.endTs as string,
    });
  });
  return { rows, rejected };
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
    const user = await getAuthenticatedUser(request);
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
    const normalized = normalizeRows(body?.reps);
    if (normalized === null) {
      return NextResponse.json({ error: "Invalid rep_events payload" }, { status: 400 });
    }
    const { rows, rejected } = normalized;
    if (rejected.length > 0) {
      console.warn(
        `rep-events session ${sessionId}: rejected ${rejected.length} row(s)`,
        rejected,
      );
    }
    // Only a wholly unusable batch is an error; otherwise store what is valid
    // and report the rest so the client can surface it rather than lose it.
    if (rows.length === 0) {
      return NextResponse.json(
        { error: "No valid rep_events rows", rejected },
        { status: 400 },
      );
    }

    const { inserted, skipped } = await insertRepEvents(sessionId, rows);
    return NextResponse.json({ success: true, inserted, skipped, rejected });
  } catch (error) {
    console.error("POST /api/sessions/[id]/rep-events error:", error);
    return NextResponse.json({ error: "Failed to insert rep events" }, { status: 500 });
  }
}
