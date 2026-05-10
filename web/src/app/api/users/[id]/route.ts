import { NextRequest, NextResponse } from "next/server";
import { updateUser, deleteUser } from "@/lib/db";

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();

    // Reconstruct full name when individual name parts are provided
    if (body.firstName !== undefined || body.lastName !== undefined) {
      const parts = [body.firstName, body.middleName, body.lastName].filter(Boolean);
      if (parts.length > 0) body.name = parts.join(" ");
    }

    const updated = await updateUser(params.id, body);

    if (!updated) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({ user: updated });
  } catch (error) {
    console.error("PUT /api/users/[id] error:", error);
    return NextResponse.json({ error: "Failed to update user" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await deleteUser(params.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/users/[id] error:", error);
    return NextResponse.json({ error: "Failed to delete user" }, { status: 500 });
  }
}
