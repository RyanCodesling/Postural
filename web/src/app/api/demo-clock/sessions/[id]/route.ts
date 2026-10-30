import { NextRequest, NextResponse } from "next/server";
import { correctSessionDate, getSessionDateCorrectionDetail } from "@/lib/db";
import { requireDateCorrectionAdmin, dateCorrectionErrorResponse } from "@/lib/sessionDateCorrectionApi";
import { parseCorrectionSessionId, parseSessionDateCorrection } from "@/lib/sessionDateCorrection";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    await requireDateCorrectionAdmin(request);
    const id = parseCorrectionSessionId((await context.params).id);
    const detail = await getSessionDateCorrectionDetail(id);
    if (!detail) return NextResponse.json({ error: "Session not found." }, { status: 404 });
    return NextResponse.json(detail, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return dateCorrectionErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  try {
    const actorId = await requireDateCorrectionAdmin(request);
    const id = parseCorrectionSessionId((await context.params).id);
    const input = parseSessionDateCorrection(await request.json().catch(() => null));
    await correctSessionDate(id, actorId, input);
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return dateCorrectionErrorResponse(error);
  }
}
