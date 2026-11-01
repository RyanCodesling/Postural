import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { purgeDeletedItem, restoreDeletedItem } from "@/lib/deletedItems";

type Context = { params: Promise<{ id: string }> };

async function adminAndId(request: NextRequest, params: Context["params"]) {
  const user = await getAuthenticatedUser(request);
  if (!user || user.role !== "admin") return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1) return { error: NextResponse.json({ error: "Invalid item" }, { status: 400 }) };
  return { user, id };
}

// POST /api/admin/deleted-items/[id] — restores the item where it was deleted from.
export async function POST(request: NextRequest, { params }: Context) {
  try {
    const checked = await adminAndId(request, params);
    if ("error" in checked) return checked.error;
    const result = await restoreDeletedItem(checked.id, checked.user.id);
    return result.ok
      ? NextResponse.json({ success: true, message: result.message })
      : NextResponse.json({ error: result.error }, { status: result.status });
  } catch (error) {
    console.error("POST /api/admin/deleted-items/[id] error:", error);
    return NextResponse.json({ error: "Failed to restore the item" }, { status: 500 });
  }
}

// DELETE /api/admin/deleted-items/[id] — deletes the item and its stored contents for good.
export async function DELETE(request: NextRequest, { params }: Context) {
  try {
    const checked = await adminAndId(request, params);
    if ("error" in checked) return checked.error;
    if (!(await purgeDeletedItem(checked.id))) {
      return NextResponse.json({ error: "This item is no longer in Recently Deleted." }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/admin/deleted-items/[id] error:", error);
    return NextResponse.json({ error: "Failed to delete the item" }, { status: 500 });
  }
}
