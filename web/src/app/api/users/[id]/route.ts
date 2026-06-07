import { NextRequest, NextResponse } from "next/server";
import { getUserById, updateUser, deleteUser, isEmailTaken } from "@/lib/db";
import {
  sendEmailChangedToOldAddress,
  sendEmailChangedToNewAddress,
  sendEmailChangedAdminNotification,
  sendAccountDeletedUserEmail,
  sendAccountDeletedAdminEmail,
} from "@/lib/email";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const authToken = request.cookies.get("auth_token");
    if (!authToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const sessionUser = JSON.parse(authToken.value);

    const user = await getUserById(id);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Patients may only view their own profile
    if (sessionUser.role === "patient" && id !== sessionUser.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Therapist can view their own profile or their assigned patients
    if (sessionUser.role === "therapist") {
      const isSelf = id === sessionUser.id;
      const isAssignedPatient = user.role === "patient" && user.therapistId === sessionUser.id;
      if (!isSelf && !isAssignedPatient) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    return NextResponse.json({ user });
  } catch (error) {
    console.error("GET /api/users/[id] error:", error);
    return NextResponse.json({ error: "Failed to fetch user" }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    if (body.firstName !== undefined || body.lastName !== undefined) {
      const parts = [body.firstName, body.middleName, body.lastName].filter(Boolean);
      if (parts.length > 0) body.name = parts.join(" ");
    }

    // Duplicate email check (excluding self)
    if (body.email) {
      const taken = await isEmailTaken(body.email, id);
      if (taken) {
        return NextResponse.json(
          { error: "This email address is already registered to an account." },
          { status: 409 }
        );
      }
    }

    // Capture old user data before update to detect email change
    const oldUser = await getUserById(id);

    const updated = await updateUser(id, body);

    if (!updated) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Send email change notifications if email changed
    const oldEmail = oldUser?.email as string | undefined;
    const newEmail = updated.email as string | undefined;
    if (oldEmail && newEmail && oldEmail !== newEmail) {
      const authToken = request.cookies.get("auth_token");
      const adminEmail = authToken ? (JSON.parse(authToken.value) as { email?: string }).email : undefined;
      const userName = updated.name as string;

      sendEmailChangedToOldAddress(oldEmail, userName, newEmail).catch(console.error);
      sendEmailChangedToNewAddress(newEmail, userName, oldEmail).catch(console.error);
      if (adminEmail) {
        sendEmailChangedAdminNotification(adminEmail, userName, oldEmail, newEmail).catch(console.error);
      }
    }

    return NextResponse.json({ user: updated });
  } catch (error) {
    console.error("PUT /api/users/[id] error:", error);
    return NextResponse.json({ error: "Failed to update user" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Capture user data before deletion for email notifications
    const userToDelete = await getUserById(id);

    await deleteUser(id);

    // Send deletion notifications fire-and-forget
    if (userToDelete?.email) {
      const authToken = request.cookies.get("auth_token");
      const adminEmail = authToken ? (JSON.parse(authToken.value) as { email?: string }).email : undefined;

      sendAccountDeletedUserEmail(
        userToDelete.email as string,
        userToDelete.name as string,
        userToDelete.role as string
      ).catch(console.error);

      if (adminEmail) {
        sendAccountDeletedAdminEmail(
          adminEmail,
          userToDelete.name as string,
          userToDelete.email as string,
          userToDelete.role as string
        ).catch(console.error);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/users/[id] error:", error);
    return NextResponse.json({ error: "Failed to delete user" }, { status: 500 });
  }
}
