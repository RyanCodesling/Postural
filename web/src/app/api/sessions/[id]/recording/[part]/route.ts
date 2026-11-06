import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { recordingAccess } from "@/lib/recording/access";
import { parseRange } from "@/lib/recording/http";
import { appendChunk, appendOverlayChunk, openPart, readOverlay } from "@/lib/recording/storage";

type Context = { params: Promise<{ id: string; part: string }> };

// GET /api/sessions/[id]/recording/[part] — the video file for the owning
// patient or their assigned therapist, with byte ranges so the player can seek.
// With ?track=overlay, the part's coaching overlay track instead.
export async function GET(request: NextRequest, { params }: Context) {
  const { id, part: partText } = await params;
  const access = await recordingAccess(await getAuthenticatedUser(request), id);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const index = Number(partText);
  if (request.nextUrl.searchParams.get("track") === "overlay") {
    const overlay = Number.isInteger(index) && index >= 1 ? await readOverlay(access.sessionId, index) : null;
    if (overlay === null) return NextResponse.json({ error: "No overlay for this recording" }, { status: 404 });
    return new Response(overlay, {
      status: 200,
      headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "private, no-store" },
    });
  }
  const file = Number.isInteger(index) && index >= 1 ? await openPart(access.sessionId, index) : null;
  if (!file) return NextResponse.json({ error: "Recording not found" }, { status: 404 });
  const headers: Record<string, string> = {
    "Content-Type": file.part.mimeType.split(";")[0],
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
  };
  const range = parseRange(request.headers.get("range"), file.size);
  if (range === "unsatisfiable") {
    return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${file.size}` } });
  }
  const body = Readable.toWeb(file.stream(range ?? undefined)) as unknown as ReadableStream<Uint8Array>;
  if (!range) {
    return new Response(body, { status: 200, headers: { ...headers, "Content-Length": String(file.size) } });
  }
  return new Response(body, {
    status: 206,
    headers: {
      ...headers,
      "Content-Length": String(range.end - range.start + 1),
      "Content-Range": `bytes ${range.start}-${range.end}/${file.size}`,
    },
  });
}

// PUT /api/sessions/[id]/recording/[part]?seq=N — the owning patient's
// recorder appends chunk N. Repeating a stored chunk is harmless; skipping
// one is refused, so the file stays one contiguous stream. With
// &track=overlay the chunk goes to the coaching overlay track.
export async function PUT(request: NextRequest, { params }: Context) {
  const { id, part: partText } = await params;
  const access = await recordingAccess(await getAuthenticatedUser(request), id);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  if (access.role !== "owner" || !access.videoConsent) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const index = Number(partText);
  const seq = Number(request.nextUrl.searchParams.get("seq"));
  if (!Number.isInteger(index) || index < 1 || !Number.isInteger(seq) || seq < 1) {
    return NextResponse.json({ error: "part and seq must be positive integers" }, { status: 400 });
  }
  const overlay = request.nextUrl.searchParams.get("track") === "overlay";
  // How far into the part an overlay chunk covers, for the player's coverage note.
  const throughText = request.nextUrl.searchParams.get("through");
  const throughMs = overlay && throughText !== null ? Number(throughText) : undefined;
  if (throughMs !== undefined && (!Number.isInteger(throughMs) || throughMs < 0)) {
    return NextResponse.json({ error: "through must be a whole number of milliseconds" }, { status: 400 });
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  const result = overlay
    ? await appendOverlayChunk(access.sessionId, index, seq, bytes, throughMs)
    : await appendChunk(access.sessionId, index, seq, bytes);
  switch (result) {
    case "appended":
    case "duplicate":
      return NextResponse.json({ success: true, result });
    case "missing":
      return NextResponse.json({ error: "Recording part not found" }, { status: 404 });
    case "too-large":
      return NextResponse.json({ error: "The recording is too large." }, { status: 413 });
    default:
      return NextResponse.json({ error: `Chunk refused: ${result}` }, { status: 409 });
  }
}
