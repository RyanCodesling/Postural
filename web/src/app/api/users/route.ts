import { NextRequest, NextResponse } from "next/server";
import { getUsers, createUser, getNextUserId, setMustChangePassword, isEmailTaken } from "@/lib/db";
import { sendAccountCreationEmail, sendAccountCreatedAdminEmail } from "@/lib/email";
import { getAuthenticatedUser } from "@/lib/auth-server";

export async function GET(request: NextRequest) {
  try {
    const authenticatedUser = await getAuthenticatedUser(request);
    if (!authenticatedUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (authenticatedUser.role === "patient") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (authenticatedUser.role === "therapist") {
      const users = await getUsers({
        role: "patient",
        therapistId: authenticatedUser.id,
      });
      return NextResponse.json({ users });
    }

    const { searchParams } = request.nextUrl;
    const role = searchParams.get("role") ?? undefined;
    const therapistId = searchParams.get("therapistId") ?? undefined;

    const users = await getUsers({ role, therapistId });
    return NextResponse.json({ users });
  } catch (error) {
    console.error("GET /api/users error:", error);
    return NextResponse.json({ error: "Failed to fetch users" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const authenticatedUser = await getAuthenticatedUser(request);
    if (!authenticatedUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (authenticatedUser.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const { firstName, middleName, lastName, email, role, dateOfBirth, age, gender,
            therapistIDNum, specialty } = body;

    if (!firstName || !lastName || !role) {
      return NextResponse.json({ error: "firstName, lastName, and role are required" }, { status: 400 });
    }
    if (role !== "patient" && role !== "therapist") {
      return NextResponse.json({ error: "role must be patient or therapist" }, { status: 400 });
    }

    if (email && await isEmailTaken(email)) {
      return NextResponse.json({ error: "This email address is already registered to an account." }, { status: 409 });
    }

    const id = await getNextUserId(role);

    const nameParts = [firstName, middleName, lastName].filter(Boolean);
    const fullName = nameParts.join(" ");

    const suffixes = new Set(["jr", "jr.", "sr", "sr.", "i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"]);
    const birthYear = dateOfBirth ? new Date(dateOfBirth).getFullYear() : "";
    const lastNameClean = lastName
      .split(" ")
      .filter((w: string) => !suffixes.has(w.toLowerCase().replace(/[^a-z0-9]/g, "")))
      .join(" ")
      .replace(/[^a-zA-Z0-9 ]/g, "");

    const capitalizedLast = lastNameClean
      .split(" ")
      .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
      .join("");
    const password = `${capitalizedLast}${birthYear}`;

    const user = await createUser({
      id,
      name:           fullName,
      firstName,
      middleName:     middleName  ?? null,
      lastName,
      email:          email       ?? null,
      password,
      role,
      dateOfBirth:    dateOfBirth ?? null,
      age:            age         ?? null,
      gender:         gender      ?? null,
      therapistIDNum: therapistIDNum ?? null,
      specialty:      specialty   ?? null,
    });

    // Flag the new user to change password on first login
    await setMustChangePassword(id, true);

    // Send welcome email to new user and notification to admin (fire-and-forget)
    let emailSent = false;
    if (email) {
      emailSent = true;
      sendAccountCreationEmail(email, fullName, password).catch((err) =>
        console.error("Failed to send account creation email:", err)
      );
    }

    const adminEmail = authenticatedUser.email as string | undefined;
    if (adminEmail) {
      sendAccountCreatedAdminEmail(adminEmail, fullName, email ?? "", role).catch((err) =>
        console.error("Failed to send admin creation notification:", err)
      );
    }

    return NextResponse.json({ user, emailSent }, { status: 201 });
  } catch (error) {
    console.error("POST /api/users error:", error);
    return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
  }
}
