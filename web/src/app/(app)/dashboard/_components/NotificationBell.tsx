"use client";

import React, { useState, useEffect, useRef } from "react";

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

export default function NotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [toasts, setToasts] = useState<{ id: number; message: string }[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [activeNotification, setActiveNotification] = useState<Notification | null>(null);
  
  const dropdownRef = useRef<HTMLDivElement>(null);
  const prevUnreadCountRef = useRef<number | null>(null);
  const processedRealtimeIdsRef = useRef<Set<number>>(new Set());

  // Synthesize a premium dual-tone bell chime using browser Web Audio API
  const playChime = () => {
    try {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();

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
  };

  const fetchNotifications = async () => {
    try {
      const res = await fetch("/api/notifications");
      if (!res.ok) return;
      const data = await res.json();
      
      const newNotifications: Notification[] = data.notifications ?? [];
      const realtimeLogs: Notification[] = data.realtimeLogs ?? [];

      const unreadCount = newNotifications.filter((n) => !n.isRead).length;

      // Handle unread login/logout realtime logs
      if (realtimeLogs.length > 0) {
        let hasNewLog = false;
        
        for (const log of realtimeLogs) {
          if (!processedRealtimeIdsRef.current.has(log.id)) {
            processedRealtimeIdsRef.current.add(log.id);
            hasNewLog = true;

            // Trigger floating popup toast
            setToasts((prev) => [...prev, { id: log.id, message: log.message }]);

            // Automatically mark the log notification as read on the backend
            fetch("/api/notifications", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "mark_as_read", id: log.id }),
            }).catch(console.error);

            // Auto dismiss toast after 4 seconds
            setTimeout(() => {
              setToasts((prev) => prev.filter((t) => t.id !== log.id));
            }, 4000);
          }
        }

        if (hasNewLog) {
          playChime();
        }
      }

      // Play sound for standard notifications if unread count increases
      if (prevUnreadCountRef.current !== null && unreadCount > prevUnreadCountRef.current) {
        playChime();
      }

      prevUnreadCountRef.current = unreadCount;
      setNotifications(newNotifications);
    } catch (err) {
      console.error("Failed to load notifications:", err);
    }
  };

  useEffect(() => {
    // Initial fetch
    fetchNotifications();

    // Poll every 3 seconds
    const interval = setInterval(fetchNotifications, 3000);

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
  }, []);

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  const handleMarkAsRead = async (id: number) => {
    // Optimistic update
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
    );
    if (activeNotification?.id === id) {
      setActiveNotification((prev) => (prev ? { ...prev, isRead: true } : null));
    }
    if (prevUnreadCountRef.current !== null) {
      prevUnreadCountRef.current = Math.max(0, prevUnreadCountRef.current - 1);
    }

    try {
      await fetch("/api/notifications", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mark_as_read", id }),
      });
    } catch (err) {
      console.error("Failed to mark notification as read:", err);
    }
  };

  const handleMarkAllRead = async () => {
    // Optimistic update
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    prevUnreadCountRef.current = 0;

    try {
      await fetch("/api/notifications", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mark_all_read" }),
      });
    } catch (err) {
      console.error("Failed to mark all notifications as read:", err);
    }
  };

  const handleDeleteSingle = async (id: number) => {
    // Optimistic update
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    setSelectedIds((prev) => prev.filter((x) => x !== id));
    setActiveNotification(null);

    try {
      await fetch("/api/notifications", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
    } catch (err) {
      console.error("Failed to delete notification:", err);
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.length === 0) return;

    // Optimistic update
    setNotifications((prev) => prev.filter((n) => !selectedIds.includes(n.id)));
    const deletedCount = notifications.filter((n) => selectedIds.includes(n.id) && !n.isRead).length;
    if (prevUnreadCountRef.current !== null) {
      prevUnreadCountRef.current = Math.max(0, prevUnreadCountRef.current - deletedCount);
    }
    const targetIds = [...selectedIds];
    setSelectedIds([]);

    try {
      await fetch("/api/notifications", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: targetIds }),
      });
    } catch (err) {
      console.error("Failed to delete selected notifications:", err);
    }
  };

  const handleToggleSelect = (e: React.MouseEvent, id: number) => {
    e.stopPropagation(); // Prevent opening the notification details modal
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
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

  return (
    <div className="relative inline-block" ref={dropdownRef}>
      {/* Top Floating Popup Toasts Stack */}
      <div className="fixed top-5 left-1/2 -translate-x-1/2 z-[60] flex flex-col gap-2 pointer-events-none w-full max-w-sm px-4">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="pointer-events-auto bg-green-800 text-white font-medium text-sm px-5 py-3 rounded-xl shadow-2xl flex items-center justify-between gap-3 border border-green-700 transition duration-300 ease-in-out transform translate-y-0"
            style={{ animation: "slide-down 0.3s ease-out" }}
          >
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-green-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{toast.message}</span>
            </div>
            <button
              onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
              className="text-white/70 hover:text-white cursor-pointer select-none pl-2 font-bold"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {/* Bell Trigger */}
      <button
        onClick={() => setIsOpen(!isOpen)}
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
          <span className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-[10px] font-bold text-white ring-2 ring-white animate-pulse">
            {unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown Overlay with Width Increased to w-[28rem] */}
      {isOpen && (
        <div className="absolute right-0 mt-2.5 w-[28rem] max-h-[30rem] overflow-y-auto bg-white border border-green-100 rounded-2xl shadow-xl z-50 flex flex-col scrollbar-thin">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-green-50/50">
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
                className="text-xs font-medium text-green-700 hover:text-green-900 hover:underline cursor-pointer"
              >
                Mark all read
              </button>
            </div>
          </div>

          {/* List */}
          <div className="divide-y divide-gray-50 flex-1">
            {notifications.length === 0 ? (
              <div className="py-8 px-4 text-center text-sm text-gray-400">
                No notifications yet.
              </div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  onClick={() => {
                    setActiveNotification(n);
                    setIsOpen(false);
                  }}
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

      {/* CSS Animation Keyframes for Top Toast slide-down */}
      <style jsx global>{`
        @keyframes slide-down {
          0% {
            transform: translate3d(0, -2rem, 0);
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
