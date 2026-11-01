import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { hasDeletedItemsBin } from "@/lib/db";
import { listDeletedItems } from "@/lib/deletedItems";

// GET /api/admin/deleted-items — everything in Recently Deleted, newest first.
// `ready` is false until scripts/deleted_items_pg.sql has been run.
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user || user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasDeletedItemsBin())) return NextResponse.json({ ready: false, items: [] });
    return NextResponse.json({ ready: true, items: await listDeletedItems() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET /api/admin/deleted-items error:", error);
    return NextResponse.json({ error: "Failed to load Recently Deleted" }, { status: 500 });
  }
}
