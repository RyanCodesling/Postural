"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";

interface Notification {
  id: number;
  userId: string;
  title: string;
  message: string;
  type: string;
  occurrenceId: number | null;
  isRead: boolean;
  createdAt: string;
}

type Filter = "all" | "unread" | "read";

interface NotificationPage {
  notifications: Notification[];
  total: number;
  unreadCount: number;
  /** The newest unread notifications, for the on-screen pop-ups. */
  recent: Notification[];
  pageSize: number;
}

/**
 * Fired on window when the bell finds new notifications (detail: the new ones),
 * so a page can reload what a therapist's change, such as a removed exercise,
 * made stale.
 */
export const NEW_NOTIFICATIONS_EVENT = "postural:new-notifications";

const POLL_MS = 30_000;
const TOAST_MS = 3_000;
const MAX_TOASTS = 3;

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "read", label: "Read" },
];

export default function NotificationBell() {
  const [data, setData] = useState<NotificationPage>({
    notifications: [], total: 0, unreadCount: 0, recent: [], pageSize: 10,
  });
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(1);
  const [toasts, setToasts] = useState<Notification[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [activeNotification, setActiveNotification] = useState<Notification | null>(null);

  const dropdownRef = useRef<HTMLDivElement>(null);
  // Where the panel starts on a phone: just under the header, whose height grows when a long name wraps.
  const [phoneTop, setPhoneTop] = useState(76);
  // The newest notification id already seen; null until the first load, so
  // what was there before the page opened never pops up.
  const lastSeenIdRef = useRef<number | null>(null);
  const viewRef = useRef({ filter, page });

  // Synthesize a premium dual-tone bell chime using browser Web Audio API
  const playChime = useCallback(() => {
    try {
      const AudioContextCtor =
        window.AudioContext ||
        (window as Window & typeof globalThis & {
          webkitAudioContext?: typeof AudioContext;
        }).webkitAudioContext;
      if (!AudioContextCtor) return;
      const ctx = new AudioContextCtor();

      // Note 1 (C5)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.type = "sine";
      osc1.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
      gain1.gain.setValueAtTime(0, ctx.currentTime);
      gain1.gain.linearRampToValueAtTime(0.08, ctx.currentTime + 0.05);
      gain1.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
      osc1.start(ctx.currentTime);
      osc1.stop(ctx.currentTime + 0.45);

      // Note 2 (E5) slightly delayed
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.type = "sine";
      osc2.frequency.setValueAtTime(659.25, ctx.currentTime + 0.1); // E5
      gain2.gain.setValueAtTime(0, ctx.currentTime + 0.1);
      gain2.gain.linearRampToValueAtTime(0.08, ctx.currentTime + 0.15);
      gain2.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
      osc2.start(ctx.currentTime + 0.1);
      osc2.stop(ctx.currentTime + 0.55);
    } catch (e) {
      console.warn("Failed to play notification audio alert:", e);
    }
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const fetchNotifications = useCallback(async () => {
    const { filter: currentFilter, page: currentPage } = viewRef.current;
    try {
      const res = await fetch(`/api/notifications?filter=${currentFilter}&page=${currentPage}`);
      if (!res.ok) return;
      const next = (await res.json()) as NotificationPage;
      // The view may have changed while this request was out.
      if (viewRef.current.filter !== currentFilter || viewRef.current.page !== currentPage) return;

      // A page emptied by deletes or reads steps back to the last page.
      const lastPage = Math.max(1, Math.ceil(next.total / next.pageSize));
      if (currentPage > lastPage) {
        setPage(lastPage);
        return;
      }

      const recent = next.recent ?? [];
      const newestId = recent.reduce((max, n) => Math.max(max, n.id), 0);
      if (lastSeenIdRef.current === null) {
        lastSeenIdRef.current = newestId;
      } else {
        const seen = lastSeenIdRef.current;
        const fresh = recent.filter((n) => n.id > seen).sort((a, b) => a.id - b.id);
        if (fresh.length > 0) {
          lastSeenIdRef.current = Math.max(seen, newestId);
          setToasts((prev) => [...prev, ...fresh].slice(-MAX_TOASTS));
          for (const n of fresh) window.setTimeout(() => dismissToast(n.id), TOAST_MS);
          playChime();
          window.dispatchEvent(new CustomEvent(NEW_NOTIFICATIONS_EVENT, { detail: fresh }));
        }
      }
      setData(next);
    } catch (err) {
      console.error("Failed to load notifications:", err);
    }
  }, [playChime, dismissToast]);

  // Refetch at once when the filter or page changes.
  useEffect(() => {
    viewRef.current = { filter, page };
    const timeout = window.setTimeout(() => {
      void fetchNotifications();
    }, 0);
    return () => clearTimeout(timeout);
  }, [filter, page, fetchNotifications]);

  useEffect(() => {
    const interval = setInterval(fetchNotifications, POLL_MS);

    // Close dropdown on click outside
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      clearInterval(interval);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [fetchNotifications]);

  const { notifications, total, unreadCount, pageSize } = data;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const firstShown = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastShown = Math.min(total, page * pageSize);

  const changeFilter = (next: Filter) => {
    setFilter(next);
    setPage(1);
    setSelectedIds([]);
  };

  const changePage = (next: number) => {
    setPage(next);
    setSelectedIds([]);
  };

  const sendUpdate = async (method: "PUT" | "DELETE", body: unknown, failure: string) => {
    try {
      await fetch("/api/notifications", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (err) {
      console.error(failure, err);
    }
    await fetchNotifications();
  };

  const handleMarkAsRead = async (id: number) => {
    // Optimistic update
    setData((prev) => ({
      ...prev,
      notifications: prev.notifications.map((n) => (n.id === id ? { ...n, isRead: true } : n)),
      unreadCount: Math.max(0, prev.unreadCount - 1),
    }));
    if (activeNotification?.id === id) {
      setActiveNotification((prev) => (prev ? { ...prev, isRead: true } : null));
    }
    await sendUpdate("PUT", { action: "mark_as_read", id }, "Failed to mark notification as read:");
  };

  const handleMarkAllRead = async () => {
    setData((prev) => ({
      ...prev,
      notifications: prev.notifications.map((n) => ({ ...n, isRead: true })),
      unreadCount: 0,
    }));
    await sendUpdate("PUT", { action: "mark_all_read" }, "Failed to mark all notifications as read:");
  };

  const handleDeleteSingle = async (id: number) => {
    setData((prev) => ({ ...prev, notifications: prev.notifications.filter((n) => n.id !== id) }));
    setSelectedIds((prev) => prev.filter((x) => x !== id));
    setActiveNotification(null);
    await sendUpdate("DELETE", { id }, "Failed to delete notification:");
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.length === 0) return;
    const targetIds = [...selectedIds];
    setData((prev) => ({ ...prev, notifications: prev.notifications.filter((n) => !targetIds.includes(n.id)) }));
    setSelectedIds([]);
    await sendUpdate("DELETE", { ids: targetIds }, "Failed to delete selected notifications:");
  };

  const handleToggleSelect = (e: React.MouseEvent, id: number) => {
    e.stopPropagation(); // Prevent opening the notification details modal
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const openNotification = (n: Notification) => {
    setActiveNotification(n);
    setIsOpen(false);
    dismissToast(n.id);
  };

  const formatDate = (isoStr: string) => {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const emptyText =
    filter === "unread" ? "No unread notifications." : filter === "read" ? "No read notifications." : "No notifications yet.";

  return (
    <div className="relative inline-block" ref={dropdownRef}>
      {/* On-screen pop-ups: small, top-right, gone after 3 seconds */}
      <div
        className="fixed top-4 right-4 left-4 sm:left-auto z-[60] flex flex-col items-end gap-2 pointer-events-none"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            onClick={() => openNotification(toast)}
            className="pointer-events-auto w-full sm:w-80 bg-white/95 backdrop-blur border border-gray-200 shadow-lg rounded-2xl px-4 py-3 flex items-start gap-3 cursor-pointer"
            style={{ animation: "notification-pop 0.25s ease-out" }}
          >
            <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-green-600" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-gray-900 truncate">{toast.title}</p>
              <p className="text-xs text-gray-600 line-clamp-2 break-words">{toast.message}</p>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                dismissToast(toast.id);
              }}
              className="text-gray-400 hover:text-gray-600 cursor-pointer select-none text-xs"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {/* Bell Trigger */}
      <button
        onClick={(event) => {
          const header = event.currentTarget.closest("header");
          if (header) setPhoneTop(Math.round(header.getBoundingClientRect().bottom) + 8);
          setIsOpen(!isOpen);
        }}
        className="relative p-2.5 text-gray-500 hover:text-green-700 bg-white hover:bg-green-50 border border-gray-200 rounded-xl transition duration-150 focus:outline-none cursor-pointer"
        aria-label="Notifications"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="w-5 h-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 flex h-5 min-w-5 px-1 items-center justify-center rounded-full bg-red-600 text-[10px] font-bold text-white ring-2 ring-white animate-pulse">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        // On a phone the bell is not at the screen's edge, so the panel is pinned
        // to the screen under the header instead of to the bell.
        <div style={{ "--bell-top": `${phoneTop}px` } as React.CSSProperties} className="fixed inset-x-3 top-(--bell-top) z-50 flex flex-col rounded-xl bg-white shadow-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2.5 sm:w-[calc(100vw-2rem)] sm:max-w-[28rem]">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-green-50/50 rounded-t-xl">
            <span className="text-sm font-semibold text-green-800">Notifications</span>
            <div className="flex items-center gap-3">
              {selectedIds.length > 0 && (
                <button
                  onClick={handleDeleteSelected}
                  className="p-1 text-red-600 hover:text-red-800 hover:bg-red-50 rounded transition cursor-pointer flex items-center"
                  title="Delete selected"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              )}
              <button
                onClick={handleMarkAllRead}
                disabled={unreadCount === 0}
                className="text-xs font-medium text-green-700 hover:text-green-900 hover:underline cursor-pointer disabled:text-gray-300 disabled:no-underline disabled:cursor-default"
              >
                Mark all read
              </button>
            </div>
          </div>

          {/* Filters */}
          <div className="flex gap-1 px-3 py-2 border-b border-gray-100" role="tablist">
            {FILTERS.map(({ value, label }) => (
              <button
                key={value}
                role="tab"
                aria-selected={filter === value}
                onClick={() => changeFilter(value)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition cursor-pointer ${
                  filter === value ? "bg-green-700 text-white" : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                {label}
                {value === "unread" && unreadCount > 0 && (
                  <span className={`ml-1 ${filter === value ? "text-green-100" : "text-gray-400"}`}>{unreadCount}</span>
                )}
              </button>
            ))}
          </div>

          {/* List */}
          <div className="divide-y divide-gray-50 max-h-[min(24rem,calc(100dvh-17rem))] overflow-y-auto scrollbar-thin sm:max-h-[24rem]">
            {notifications.length === 0 ? (
              <div className="py-8 px-4 text-center text-sm text-gray-400">{emptyText}</div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  onClick={() => openNotification(n)}
                  className="px-4 py-3.5 hover:bg-green-50/40 transition cursor-pointer flex gap-3.5 items-start"
                >
                  {/* Selection Checkbox */}
                  <div className="mt-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(n.id)}
                      onChange={() => {}}
                      onClick={(e) => handleToggleSelect(e, n.id)}
                      className="w-4 h-4 rounded text-green-700 focus:ring-green-500 border-gray-300 cursor-pointer accent-green-800"
                    />
                  </div>

                  {/* Status Indicator Icon */}
                  <div className="mt-1 shrink-0">
                    {n.isRead ? (
                      <svg
                        className="w-4.5 h-4.5 text-gray-400"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2.5}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <span className="flex h-3 w-3 relative">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500"></span>
                      </span>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p
                      className={`text-sm text-gray-900 leading-snug break-words ${
                        !n.isRead ? "font-bold text-green-900" : ""
                      }`}
                    >
                      {n.title}
                    </p>
                    <p className="text-xs text-gray-500 line-clamp-2 mt-1 break-words">
                      {n.message}
                    </p>
                    <p className="text-[10px] text-gray-400 mt-1.5">
                      {formatDate(n.createdAt)}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Paging */}
          {total > pageSize && (
            <div className="flex items-center justify-between px-4 py-2.5 border-t border-gray-100 text-xs text-gray-500">
              <span>
                {firstShown}–{lastShown} of {total}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => changePage(page - 1)}
                  disabled={page <= 1}
                  className="px-2.5 py-1 rounded-md border border-gray-200 hover:bg-gray-50 cursor-pointer disabled:opacity-40 disabled:cursor-default"
                >
                  Previous
                </button>
                <button
                  onClick={() => changePage(page + 1)}
                  disabled={page >= pageCount}
                  className="px-2.5 py-1 rounded-md border border-gray-200 hover:bg-gray-50 cursor-pointer disabled:opacity-40 disabled:cursor-default"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Details Modal Popup Overlay */}
      {activeNotification && (
        <div className="fixed inset-0 bg-black/55 z-50 flex items-center justify-center p-4 backdrop-blur-xs transition-opacity duration-300">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl relative border border-green-50 transform scale-100 transition-all duration-300">
            {/* Modal Header */}
            <h3 className="text-lg font-bold text-green-800 pr-8 leading-snug break-words">
              {activeNotification.title}
            </h3>

            {/* Close Button Top Right */}
            <button
              onClick={() => setActiveNotification(null)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 cursor-pointer"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>

            {/* Modal Body */}
            <div className="mt-4">
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap break-words">
                {activeNotification.message}
              </p>
              <p className="text-xs text-gray-400 mt-4">
                Received: {formatDate(activeNotification.createdAt)}
              </p>
            </div>

            {/* Modal Actions */}
            <div className="mt-6 flex justify-end gap-3 border-t border-gray-100 pt-4">
              <button
                onClick={() => handleDeleteSingle(activeNotification.id)}
                className="px-4 py-2 border border-red-500 hover:bg-red-50 text-red-600 rounded-lg text-sm font-semibold transition cursor-pointer"
              >
                Delete
              </button>
              {!activeNotification.isRead && (
                <button
                  onClick={() => handleMarkAsRead(activeNotification.id)}
                  className="px-4 py-2 bg-green-700 hover:bg-green-800 text-white rounded-lg text-sm font-semibold transition cursor-pointer"
                >
                  Mark as Read
                </button>
              )}
              <button
                onClick={() => setActiveNotification(null)}
                className="px-4 py-2 border border-gray-200 hover:bg-gray-50 text-gray-700 rounded-lg text-sm font-semibold transition cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        @keyframes notification-pop {
          0% {
            transform: translate3d(0, -0.75rem, 0);
            opacity: 0;
          }
          100% {
            transform: translate3d(0, 0, 0);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}
