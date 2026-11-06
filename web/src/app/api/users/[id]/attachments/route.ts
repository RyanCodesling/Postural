import { NextRequest, NextResponse } from "next/server";
import {
  createPatientAttachments,
  getUserById,
  listPatientAttachments,
  type PatientAttachment,
} from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { patientAttachmentMimeType } from "@/lib/patientAttachments";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_FILES_PER_UPLOAD = 5;

function hasValidFileSignature(data: Buffer, mimeType: string): boolean {
  if (mimeType === "image/jpeg") {
    return data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  }
  if (mimeType === "image/png") {
    return data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (mimeType === "image/webp") {
    return data.length >= 12 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP";
  }
  if (mimeType === "application/pdf") return data.subarray(0, 5).toString("ascii") === "%PDF-";
  if (["application/msword", "application/vnd.ms-excel", "application/vnd.ms-powerpoint"].includes(mimeType)) {
    return data.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  }
  if (mimeType.startsWith("application/vnd.openxmlformats-officedocument.")) {
    return data.length >= 4 && data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04;
  }
  if (mimeType === "application/rtf") return data.subarray(0, 5).toString("ascii") === "{\\rtf";
  if (mimeType === "text/plain") return !data.includes(0);
  return false;
}

async function canAccessPatient(user: NonNullable<Awaited<ReturnType<typeof getAuthenticatedUser>>>, patientId: string) {
  if (user.role === "admin") return true;
  if (user.role === "patient") return user.id === patientId;
  if (user.role !== "therapist") return false;
  const patient = await getUserById(patientId);
  return patient?.role === "patient" && patient.therapistId === user.id;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    if (!(await canAccessPatient(user, id))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ attachments: await listPatientAttachments(id) });
  } catch (error) {
    console.error("GET /api/users/[id]/attachments error:", error);
    return NextResponse.json({ error: "Failed to fetch patient images" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const patient = await getUserById(id);
    if (!patient || patient.role !== "patient") {
      return NextResponse.json({ error: "Patient not found" }, { status: 404 });
    }
    // The admin, or the patient's current therapist. Files belong to the
    // patient, so they stay when the patient is moved to another therapist.
    if (user.role !== "admin" && !(user.role === "therapist" && patient.therapistId === user.id)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const formData = await request.formData();
    const files = formData.getAll("files");
    if (files.length === 0 || files.length > MAX_FILES_PER_UPLOAD) {
      return NextResponse.json(
        { error: `Select between 1 and ${MAX_FILES_PER_UPLOAD} files per upload.` },
        { status: 400 },
      );
    }

    const attachments: PatientAttachment[] = [];
    for (const value of files) {
      if (typeof value === "string" || value.size === 0 || value.size > MAX_FILE_BYTES) {
        return NextResponse.json(
          { error: "Each file must be non-empty and no larger than 5 MB." },
          { status: 400 },
        );
      }
      const mimeType = patientAttachmentMimeType(value);
      if (!mimeType) {
        return NextResponse.json(
          { error: "Supported files: JPEG, PNG, WebP, PDF, Word, Excel, PowerPoint, RTF, and TXT." },
          { status: 400 },
        );
      }
      const data = Buffer.from(await value.arrayBuffer());
      if (!hasValidFileSignature(data, mimeType)) {
        return NextResponse.json(
          { error: `The selected ${value.name} file content does not match its file type.` },
          { status: 400 },
        );
      }
      attachments.push({
        fileName: value.name.replace(/[\\/\0-\x1f\x7f]/g, "_").slice(0, 255) || "patient-image",
        mimeType,
        data,
      });
    }

    await createPatientAttachments(id, attachments);
    return NextResponse.json({ success: true, count: attachments.length }, { status: 201 });
  } catch (error) {
    console.error("POST /api/users/[id]/attachments error:", error);
    return NextResponse.json({ error: "Failed to save patient attachments" }, { status: 500 });
  }
}