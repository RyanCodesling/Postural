import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getSessionOwner, insertSetEvents, type SetEventRow } from "@/lib/db";

const EXERCISE_KINDS = new Set(["dynamic", "isometric"]);
const TERMINATION_REASONS = new Set([
  "min_reached",
  "user",
  "pain",
  "capture_lost",
  "stall",
]);

const isPositiveInt = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 1;
const isNonNegInt = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0;
const isFiniteNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
const isNonNegNum = (v: unknown): v is number => isFiniteNum(v) && v >= 0;
const isParseableTs = (v: unknown): v is string =>
  typeof v === "string" && !Number.isNaN(Date.parse(v));

export type RowRejection = { index: number; reason: string };

/**
 * Reason this row cannot be stored, or `null` when it is valid. Rows are judged
 * individually so one malformed set cannot discard the valid sets batched with
 * it — see the matching note in the rep-events route.
 */
function rejectionReason(item: unknown): string | null {
  if (item === null || typeof item !== "object") return "not an object";
  const r = item as Record<string, unknown>;
  if (!isPositiveInt(r.setIndex)) return "setIndex must be a positive integer";
  if (typeof r.exerciseKind !== "string" || !EXERCISE_KINDS.has(r.exerciseKind)) {
    return "invalid exerciseKind";
  }
  if (!isNonNegInt(r.targetReps)) return "targetReps must be a non-negative integer";
  if (!isNonNegInt(r.leftReps)) return "leftReps must be a non-negative integer";
  if (!isNonNegInt(r.rightReps)) return "rightReps must be a non-negative integer";
  if (!isNonNegInt(r.pairedReps)) return "pairedReps must be a non-negative integer";
  if (!isNonNegNum(r.targetHoldMs)) return "targetHoldMs must be >= 0";
  if (!isNonNegNum(r.pairedHoldMs)) return "pairedHoldMs must be >= 0";
  if (!isNonNegNum(r.durationMs)) return "durationMs must be >= 0";
  if (typeof r.terminatedBy !== "string" || !TERMINATION_REASONS.has(r.terminatedBy)) {
    return "invalid terminatedBy";
  }
  if (!isNonNegNum(r.asymmetryIndex)) return "asymmetryIndex must be >= 0";
  if (!isParseableTs(r.startTs)) return "startTs is not a parseable timestamp";
  if (!isParseableTs(r.endTs)) return "endTs is not a parseable timestamp";
  return null;
}

function normalizeRows(
  raw: unknown,
): { rows: SetEventRow[]; rejected: RowRejection[] } | null {
  if (!Array.isArray(raw)) return null;
  const rows: SetEventRow[] = [];
  const rejected: RowRejection[] = [];
  raw.forEach((item, index) => {
    const reason = rejectionReason(item);
    if (reason !== null) {
      rejected.push({ index, reason });
      return;
    }
    const r = item as Record<string, unknown>;
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
  });
  return { rows, rejected };
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
    const normalized = normalizeRows(body?.sets);
    if (normalized === null) {
      return NextResponse.json({ error: "Invalid set_events payload" }, { status: 400 });
    }
    const { rows, rejected } = normalized;
    if (rejected.length > 0) {
      console.warn(
        `set-events session ${sessionId}: rejected ${rejected.length} row(s)`,
        rejected,
      );
    }
    if (rows.length === 0) {
      return NextResponse.json(
        { error: "No valid set_events rows", rejected },
        { status: 400 },
      );
    }

    const { inserted, skipped } = await insertSetEvents(sessionId, rows);
    return NextResponse.json({ success: true, inserted, skipped, rejected });
  } catch (error) {
    console.error("POST /api/sessions/[id]/set-events error:", error);
    return NextResponse.json({ error: "Failed to insert set events" }, { status: 500 });
  }
}
