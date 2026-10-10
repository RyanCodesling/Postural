import { NextRequest, NextResponse } from "next/server";
import {
  PermanentUserDeletionError,
  archiveUser,
  createNotification,
  deleteUser,
  getUserById,
  isEmailTaken,
  restoreUser,
  updateUser,
} from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth-server";
import {
  sendEmailChangedToOldAddress,
  sendEmailChangedToNewAddress,
  sendEmailChangedAdminNotification,
  sendAccountArchivedUserEmail,
  sendAccountArchivedAdminEmail,
  sendAccountRestoredUserEmail,
  sendAccountRestoredAdminEmail,
  sendAccountDeletedUserEmail,
  sendAccountDeletedAdminEmail,
} from "@/lib/email";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authenticatedUser = await getAuthenticatedUser(request);
    if (!authenticatedUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const user = await getUserById(id);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Patients may only view their own profile.
    if (authenticatedUser.role === "patient" && id !== authenticatedUser.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Therapists can view their own profile or one of their assigned patients.
    if (authenticatedUser.role === "therapist") {
      const isSelf = id === authenticatedUser.id;
      const isAssignedPatient =
        user.role === "patient" && user.therapistId === authenticatedUser.id;
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
    const authenticatedUser = await getAuthenticatedUser(request);
    if (!authenticatedUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (authenticatedUser.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

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

    // Check if therapist assignment changed and notify
    if ("therapistId" in body && body.therapistId && body.therapistId !== oldUser?.therapistId) {
      try {
        const therapist = await getUserById(body.therapistId);
        if (therapist) {
          // Notify therapist
          await createNotification(
            body.therapistId,
            "Patient Assigned",
            `Admin assigned patient ${updated.name} to you.`,
            "patient_assigned_to_therapist"
          );
          // Notify patient
          await createNotification(
            id,
            "Therapist Assigned",
            `${therapist.name} is now your assigned therapist.`,
            "assigned_therapist"
          );
        }
      } catch (err) {
        console.error("Failed to create therapist assignment notifications:", err);
      }
    }

    // Send email change notifications if email changed
    const oldEmail = oldUser?.email as string | undefined;
    const newEmail = updated.email as string | undefined;
    if (oldEmail && newEmail && oldEmail !== newEmail) {
      const adminEmail = authenticatedUser.email as string | undefined;
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

// PATCH — restore an archived user
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authenticatedUser = await getAuthenticatedUser(request);
    if (!authenticatedUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (authenticatedUser.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();

    if (body.action !== "restore") {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    // Capture user data before restore for email notifications
    const userToRestore = await getUserById(id);
    if (!userToRestore) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    await restoreUser(id);

    // Send restore notifications fire-and-forget
    if (userToRestore.email) {
      const adminEmail = authenticatedUser.email as string | undefined;

      sendAccountRestoredUserEmail(
        userToRestore.email as string,
        userToRestore.name as string,
        userToRestore.role as string
      ).catch(console.error);

      if (adminEmail) {
        sendAccountRestoredAdminEmail(
          adminEmail,
          userToRestore.name as string,
          userToRestore.email as string,
          userToRestore.role as string
        ).catch(console.error);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("PATCH /api/users/[id] error:", error);
    return NextResponse.json({ error: "Failed to restore user" }, { status: 500 });
  }
}

// DELETE — archives the user (soft delete) OR permanently deletes them if permanent=true query param is passed
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authenticatedUser = await getAuthenticatedUser(request);
    if (!authenticatedUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (authenticatedUser.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const { searchParams } = request.nextUrl;
    const isPermanent = searchParams.get("permanent") === "true";

    if (isPermanent) {
      // The transactional helper returns the locked target row only after the
      // archived/history-free eligibility checks and DELETE have succeeded.
      // That keeps failure responses from triggering deletion emails.
      const userToProcess = await deleteUser(id, String(authenticatedUser.id));

      // Send delete notifications fire-and-forget
      if (userToProcess.email) {
        const adminEmail = authenticatedUser.email as string | undefined;

        sendAccountDeletedUserEmail(
          userToProcess.email as string,
          userToProcess.name as string,
          userToProcess.role as string
        ).catch(console.error);

        if (adminEmail) {
          sendAccountDeletedAdminEmail(
            adminEmail,
            userToProcess.name as string,
            userToProcess.email as string,
            userToProcess.role as string
          ).catch(console.error);
        }
      }

      return NextResponse.json({ success: true, message: "User permanently deleted." });
    } else {
      // Capture user data before archiving for email notifications.
      const userToProcess = await getUserById(id);
      if (!userToProcess) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }
      await archiveUser(id);

      // Send archive notifications fire-and-forget
      if (userToProcess.email) {
        const adminEmail = authenticatedUser.email as string | undefined;

        sendAccountArchivedUserEmail(
          userToProcess.email as string,
          userToProcess.name as string,
          userToProcess.role as string
        ).catch(console.error);

        if (adminEmail) {
          sendAccountArchivedAdminEmail(
            adminEmail,
            userToProcess.name as string,
            userToProcess.email as string,
            userToProcess.role as string
          ).catch(console.error);
        }
      }

      return NextResponse.json({ success: true, message: "User archived." });
    }
  } catch (error) {
    if (error instanceof PermanentUserDeletionError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          blockers: error.blockers,
        },
        { status: error.code === "not_found" ? 404 : 409 },
      );
    }
    console.error("DELETE /api/users/[id] error:", error);
    return NextResponse.json({ error: "Failed to process delete/archive request" }, { status: 500 });
  }
}
