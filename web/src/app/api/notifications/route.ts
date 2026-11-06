import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import {
  getNotificationPage,
  type NotificationFilter,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  syncTimeNotifications,
  getUsers,
  deleteNotification,
  deleteMultipleNotifications,
} from "@/lib/db";

const NOTIFICATIONS_PAGE_SIZE = 10;

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser(request);
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

    // ?filter=all|unread|read&page=1 (10 per page).
    const params = request.nextUrl.searchParams;
    const filterParam = params.get("filter");
    const filter: NotificationFilter =
      filterParam === "unread" || filterParam === "read" ? filterParam : "all";
    const page = Math.max(1, Math.floor(Number(params.get("page")) || 1));
    const result = await getNotificationPage(user.id, {
      filter,
      limit: NOTIFICATIONS_PAGE_SIZE,
      offset: (page - 1) * NOTIFICATIONS_PAGE_SIZE,
    });

    return NextResponse.json({ ...result, page, pageSize: NOTIFICATIONS_PAGE_SIZE });
  } catch (error) {
    console.error("GET /api/notifications error:", error);
    return NextResponse.json({ error: "Failed to fetch notifications" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser(request);
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
    const user = await getAuthenticatedUser(request);
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
