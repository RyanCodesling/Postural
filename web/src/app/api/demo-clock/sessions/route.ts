import { NextRequest, NextResponse } from "next/server";
import { listCorrectableSessions } from "@/lib/db";
import { requireDateCorrectionAdmin, dateCorrectionErrorResponse } from "@/lib/sessionDateCorrectionApi";
import { SessionDateCorrectionError } from "@/lib/sessionDateCorrection";

export async function GET(request: NextRequest) {
  try {
    await requireDateCorrectionAdmin(request);
    const search = (request.nextUrl.searchParams.get("q") ?? "").trim();
    const rawOffset = request.nextUrl.searchParams.get("offset") ?? "0";
    if (search.length > 100 || !/^(0|[1-9]\d*)$/.test(rawOffset) || Number(rawOffset) > 2147483647) {
      throw new SessionDateCorrectionError("Use a search of at most 100 characters and a valid page.", 400);
    }
    return NextResponse.json(await listCorrectableSessions(search, Number(rawOffset)), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return dateCorrectionErrorResponse(error);
  }
}
