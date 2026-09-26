import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { recordingAccess } from "@/lib/recording/access";
import {
  deleteRecording,
  finishPart,
  overlayCoverage,
  readManifest,
  startPart,
  validRecordingMimeType,
} from "@/lib/recording/storage";

type Context = { params: Promise<{ id: string }> };
const NO_STORE = { "Cache-Control": "private, no-store" };

// GET /api/sessions/[id]/recording — the session's video parts, for the
// owning patient or their assigned therapist. An empty list means no video.
export async function GET(request: NextRequest, { params }: Context) {
  const access = await recordingAccess(await getAuthenticatedUser(request), (await params).id);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const manifest = await readManifest(access.sessionId);
  // A part still marked open after its session ended was never closed by the
  // browser, so it is reported as incomplete.
  const parts = (manifest?.parts ?? [])
    .filter((part) => part.bytes > 0)
    .map((part) => ({
      index: part.index,
      mimeType: part.mimeType,
      startWallMs: part.startWallMs,
      endWallMs: part.endWallMs,
      bytes: part.bytes,
      status: access.ended && part.status === "recording" ? "incomplete" : part.status,
      hasOverlay: (part.overlayBytes ?? 0) > 0,
      overlay: overlayCoverage(part),
      overlayThroughMs: part.overlayThroughMs ?? null,
    }));
  return NextResponse.json({ parts, canDelete: access.role === "owner" }, { headers: NO_STORE });
}

// POST /api/sessions/[id]/recording — the owning patient's recorder opens a
// part ({ action: "start" }) while the session is open, and closes it
// ({ action: "finish" }). Only a session whose start recorded video consent
// can be recorded.
export async function POST(request: NextRequest, { params }: Context) {
  const access = await recordingAccess(await getAuthenticatedUser(request), (await params).id);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  if (access.role !== "owner") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!access.videoConsent) {
    return NextResponse.json({ error: "This session was started without consent to record." }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  if (body?.action === "start") {
    if (access.ended) return NextResponse.json({ error: "The session has ended." }, { status: 409 });
    const startWallMs = Number(body.startWallMs);
    if (!validRecordingMimeType(body.mimeType) || !Number.isFinite(startWallMs) || startWallMs <= 0) {
      return NextResponse.json({ error: "mimeType and startWallMs are required" }, { status: 400 });
    }
    const part = await startPart(access.sessionId, body.mimeType, startWallMs);
    if (!part) return NextResponse.json({ error: "This session has too many recording parts." }, { status: 409 });
    return NextResponse.json({ part: part.index });
  }
  if (body?.action === "finish") {
    const part = Number(body.part);
    const endWallMs = Number(body.endWallMs);
    if (!Number.isInteger(part) || part < 1 || !Number.isFinite(endWallMs) || typeof body.complete !== "boolean") {
      return NextResponse.json({ error: "part, endWallMs and complete are required" }, { status: 400 });
    }
    if (body.overlayComplete !== undefined && typeof body.overlayComplete !== "boolean") {
      return NextResponse.json({ error: "overlayComplete must be true or false" }, { status: 400 });
    }
    const found = await finishPart(access.sessionId, part, endWallMs, body.complete, body.overlayComplete);
    return found
      ? NextResponse.json({ success: true })
      : NextResponse.json({ error: "Recording part not found" }, { status: 404 });
  }
  return NextResponse.json({ error: "action must be start or finish" }, { status: 400 });
}

// DELETE /api/sessions/[id]/recording — the owning patient removes every part.
export async function DELETE(request: NextRequest, { params }: Context) {
  const access = await recordingAccess(await getAuthenticatedUser(request), (await params).id);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  if (access.role !== "owner") {
    return NextResponse.json({ error: "Only the patient can delete this video." }, { status: 403 });
  }
  await deleteRecording(access.sessionId);
  return NextResponse.json({ success: true });
}
