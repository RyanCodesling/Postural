import { NextRequest, NextResponse } from "next/server";
import { deletePatientAttachment, getPatientAttachment, getUserById, getUserRawById } from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { comparePassword } from "@/lib/crypto";
import { isPatientImageMimeType } from "@/lib/patientAttachments";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; attachmentId: string }> },
) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id, attachmentId: rawAttachmentId } = await params;
    const attachmentId = Number(rawAttachmentId);
    if (!Number.isInteger(attachmentId) || attachmentId < 1) {
      return NextResponse.json({ error: "Image not found" }, { status: 404 });
    }
    if (user.role !== "admin") {
      const patient = user.role === "patient" ? null : await getUserById(id);
      const permitted = user.role === "patient"
        ? user.id === id
        : user.role === "therapist" && patient?.role === "patient" && patient.therapistId === user.id;
      if (!permitted) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json().catch(() => null);
    if (typeof body?.password !== "string" || body.password.length === 0) {
      return NextResponse.json({ error: "Password is required to view this image." }, { status: 400 });
    }
    const rawUser = await getUserRawById(user.id);
    if (!rawUser || !comparePassword(body.password, rawUser.password)) {
      return NextResponse.json({ error: "The password is incorrect." }, { status: 401 });
    }

    const attachment = await getPatientAttachment(attachmentId);
    if (!attachment || attachment.patientId !== id) {
      return NextResponse.json({ error: "Image not found" }, { status: 404 });
    }

    return new NextResponse(attachment.data, {
      headers: {
        "Content-Type": attachment.mimeType,
        "Content-Disposition": `${isPatientImageMimeType(attachment.mimeType) || attachment.mimeType === "application/pdf" ? "inline" : "attachment"}; filename="${attachment.fileName.replace(/["\\\r\n]/g, "_")}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("GET /api/users/[id]/attachments/[attachmentId] error:", error);
    return NextResponse.json({ error: "Failed to fetch patient image" }, { status: 500 });
  }
}

/** Admin only: deletes one of the patient's attached files, permanently. */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; attachmentId: string }> },
) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id, attachmentId: rawAttachmentId } = await params;
    // The admin, or the patient's current therapist.
    if (user.role !== "admin") {
      const patient = user.role === "therapist" ? await getUserById(id) : null;
      if (!(patient?.role === "patient" && patient.therapistId === user.id)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }
    const attachmentId = Number(rawAttachmentId);
    if (!Number.isInteger(attachmentId) || attachmentId < 1 || !(await deletePatientAttachment(id, attachmentId))) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/users/[id]/attachments/[attachmentId] error:", error);
    return NextResponse.json({ error: "Failed to delete the file" }, { status: 500 });
  }
}
