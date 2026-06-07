import { NextRequest, NextResponse } from "next/server";
import {
  getNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  syncTimeNotifications,
  getUsers,
  deleteNotification,
  deleteMultipleNotifications,
} from "@/lib/db";

function getSessionUser(request: NextRequest) {
  const authToken = request.cookies.get("auth_token");
  if (!authToken) return null;
  try {
    return JSON.parse(authToken.value);
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  try {
    const user = getSessionUser(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Sync missed and tomorrow notifications based on user role
    try {
      if (user.role === "therapist") {
        // Fetch all active assigned patients to sync them
        const assignedPatients = await getUsers({ role: "patient", therapistId: user.id });
        for (const p of assignedPatients) {
          if (!p.isArchived) {
            await syncTimeNotifications(p.id as string);
          }
        }
      } else if (user.role === "patient") {
        await syncTimeNotifications(user.id);
      }
    } catch (syncErr) {
      // Log sync errors but don't fail the whole request
      console.error("Failed to sync notifications:", syncErr);
    }

    const allNotifications = await getNotifications(user.id);

    // Filter login/logout events out of the regular bell notifications list
    const notifications = allNotifications.filter(
      (n: any) => n.type !== "user_login" && n.type !== "user_logout"
    );

    // Return unread login/logout events as real-time logs to trigger top-floating popups
    const realtimeLogs = allNotifications.filter(
      (n: any) => (n.type === "user_login" || n.type === "user_logout") && !n.isRead
    );

    return NextResponse.json({ notifications, realtimeLogs });
  } catch (error) {
    console.error("GET /api/notifications error:", error);
    return NextResponse.json({ error: "Failed to fetch notifications" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = getSessionUser(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { action, id } = body;

    if (action === "mark_all_read") {
      await markAllNotificationsAsRead(user.id);
      return NextResponse.json({ success: true });
    } else if (action === "mark_as_read" && id) {
      await markNotificationAsRead(Number(id), user.id);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("PUT /api/notifications error:", error);
    return NextResponse.json({ error: "Failed to update notification" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = getSessionUser(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { id, ids } = body;

    if (ids && Array.isArray(ids)) {
      await deleteMultipleNotifications(ids.map(Number), user.id);
      return NextResponse.json({ success: true });
    } else if (id) {
      await deleteNotification(Number(id), user.id);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
  } catch (error) {
    console.error("DELETE /api/notifications error:", error);
    return NextResponse.json({ error: "Failed to delete notification" }, { status: 500 });
  }
}
