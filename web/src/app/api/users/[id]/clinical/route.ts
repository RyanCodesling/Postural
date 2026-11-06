import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getUserById, updateUser, UserClinicalFieldsUnavailableError } from "@/lib/db";

const MAX_CLINICAL_TEXT = 5000;
const FIELDS = ["diagnosis", "condition", "prescription"] as const;

// PATCH /api/users/[id]/clinical — a patient's Diagnosis, Condition and
// Prescription, edited by the admin or by the patient's current therapist.
// The values belong to the patient, so they stay when the patient is moved to
// another therapist, and the admin's account form reads the same columns.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const patient = await getUserById(id);
    if (!patient || patient.role !== "patient") {
      return NextResponse.json({ error: "Patient not found" }, { status: 404 });
    }
    const permitted = user.role === "admin" || (user.role === "therapist" && patient.therapistId === user.id);
    if (!permitted) {
      return NextResponse.json({ error: "Only the admin or this patient's therapist can edit clinical information." }, { status: 403 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Diagnosis, Condition and Prescription are required" }, { status: 400 });
    }
    const values: Record<(typeof FIELDS)[number], string> = { diagnosis: "", condition: "", prescription: "" };
    for (const field of FIELDS) {
      const value = body[field];
      if (typeof value !== "string") {
        return NextResponse.json({ error: `${field} must be text (it may be empty).` }, { status: 400 });
      }
      if (value.length > MAX_CLINICAL_TEXT) {
        return NextResponse.json({ error: `Each field must be ${MAX_CLINICAL_TEXT} characters or fewer.` }, { status: 400 });
      }
      values[field] = value.trim();
    }

    const updated = await updateUser(id, values);
    if (!updated) return NextResponse.json({ error: "Patient not found" }, { status: 404 });
    return NextResponse.json({
      clinical: {
        diagnosis: updated.diagnosis ?? "",
        condition: updated.condition ?? "",
        prescription: updated.prescription ?? "",
      },
    });
  } catch (error) {
    if (error instanceof UserClinicalFieldsUnavailableError) {
      return NextResponse.json({ error: error.message, code: "clinical_fields_unavailable" }, { status: 409 });
    }
    console.error("PATCH /api/users/[id]/clinical error:", error);
    return NextResponse.json({ error: "Failed to save clinical information" }, { status: 500 });
  }
}
