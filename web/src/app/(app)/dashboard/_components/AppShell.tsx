"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import NotificationBell from "./NotificationBell";
import SpotlightTour, { type TourStep } from "./SpotlightTour";
import logo from "../../../../../media/acc_bacoor_logo.png";

export interface ShellNavItem {
  key: string;
  label: string;
  icon: ReactNode;
  active: boolean;
  /** Navigates to a route. Omit and pass `onSelect` for in-page tabs. */
  href?: string;
  onSelect?: () => void;
}

/** The element id a tour uses to point at a sidebar item. */
export function navTourId(key: string): string {
  return `tour-nav-${key.replace(/[^a-zA-Z0-9]+/g, "-")}`;
}

function initials(name: string | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return ((parts[0][0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

function LogoutGlyph() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4C2.9 3 2 3.9 2 5v14c0 1.1.9 2 2 2h8v-2H4V5z" />
    </svg>
  );
}

/**
 * The common frame for every signed-in role: a light icon sidebar, a top bar
 * with the notification bell and the user's name, and a
 * soft green page background that cards sit on.
 */
export default function AppShell({
  items,
  userName,
  roleLabel,
  onLogout,
  tour,
  children,
}: {
  items: ShellNavItem[];
  userName: string | undefined;
  roleLabel: string;
  onLogout: () => void;
  /** The steps of the "How to Use" tour for the page on screen; the button appears when given. */
  tour?: TourStep[];
  children: ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showTour, setShowTour] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    if (!confirmLogout) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !loggingOut) setConfirmLogout(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmLogout, loggingOut]);
  const itemClass = (active: boolean) =>
    `group relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide transition ${
      active
        ? "bg-white text-green-800 shadow-sm"
        : "text-green-900/70 hover:bg-white/60 hover:text-green-900"
    }`;

  const renderItem = (item: ShellNavItem) => {
    const inner = (
      <>
        {item.active && <span className="absolute inset-y-2 left-0 w-1 rounded-r bg-green-600" />}
        <span className={item.active ? "text-green-600" : "text-green-700/70"}>{item.icon}</span>
        {item.label}
      </>
    );
    return item.href ? (
      <Link key={item.key} id={navTourId(item.key)} href={item.href} className={itemClass(item.active)} onClick={() => setDrawerOpen(false)}>
        {inner}
      </Link>
    ) : (
      <button
        key={item.key}
        id={navTourId(item.key)}
        type="button"
        className={itemClass(item.active)}
        onClick={() => {
          item.onSelect?.();
          setDrawerOpen(false);
        }}
      >
        {inner}
      </button>
    );
  };

  return (
    <div
      className="min-h-screen bg-[#f3f8f4] text-gray-900 print:block print:min-h-0 print:bg-white"
      style={{ colorScheme: "light" }}
    >
      {drawerOpen && (
        <div className="fixed inset-0 z-30 bg-black/40 md:hidden print:hidden" onClick={() => setDrawerOpen(false)} />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-56 transform flex-col bg-[#e6f0e8] px-3 pb-16 pt-6 transition-transform duration-200 print:hidden md:w-52 ${
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        } md:translate-x-0`}
      >
        <div className="mb-6 flex shrink-0 items-center gap-2 px-3">
          <Image src={logo} alt="ACC Bacoor" width={64} height={64} className="h-8 w-8 shrink-0 rounded-full" />
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-bold text-green-900">ACC+ Bacoor</p>
            <p className="truncate text-[10px] text-green-900/60">Postural Monitoring</p>
          </div>
        </div>
        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto">{items.map(renderItem)}</nav>
        <button
          id="tour-logout"
          type="button"
          onClick={() => {
            setDrawerOpen(false);
            setConfirmLogout(true);
          }}
          className="mt-2 flex w-full shrink-0 items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-red-700/80 transition hover:bg-white/60 hover:text-red-700"
        >
          <LogoutGlyph />
          Log Out
        </button>
      </aside>

      <div className="md:pl-52 print:pl-0">
        <header className="sticky top-0 z-20 flex items-center gap-2 bg-white px-3 py-3 shadow-sm print:hidden sm:gap-3 sm:px-6">
          <button
            type="button"
            aria-label="Open menu"
            className="shrink-0 rounded-lg border border-green-200 px-2.5 py-2 text-sm text-green-800 sm:px-3 md:hidden"
            onClick={() => setDrawerOpen(true)}
          >
            ☰
          </button>

          {/* Everything stays visible on a phone: a long name wraps onto a second line instead of being hidden. */}
          <div className="ml-auto flex min-w-0 items-center gap-1.5 sm:gap-3">
            {tour && (
              <button
                id="tour-how-to-use"
                type="button"
                onClick={() => setShowTour(true)}
                className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-green-600 bg-white px-2 py-2 text-[13px] font-semibold text-green-700 transition hover:bg-green-50 sm:gap-1.5 sm:px-3 sm:text-sm"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 16v.01M12 8v4" strokeLinecap="round" />
                </svg>
                How to Use
              </button>
            )}
            <span id="tour-bell" className="shrink-0"><NotificationBell /></span>
            <div className="flex min-w-0 items-center gap-1.5 sm:gap-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-green-600 text-xs font-bold text-white sm:h-9 sm:w-9">
                {initials(userName)}
              </span>
              <div className="min-w-0 leading-tight">
                <p className="break-words text-sm font-semibold text-gray-900">{userName || roleLabel}</p>
                <p className="text-xs text-gray-500">{roleLabel}</p>
              </div>
            </div>
          </div>
        </header>

        <main className="min-w-0 p-4 sm:p-6 print:p-0">{children}</main>
      </div>

      {showTour && tour && <SpotlightTour steps={tour} onClose={() => setShowTour(false)} />}

      {confirmLogout && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 print:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => !loggingOut && setConfirmLogout(false)} />
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="logout-title"
            aria-describedby="logout-text"
            className="relative w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-xl"
          >
            <span className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-red-100 text-red-600">
              <LogoutGlyph />
            </span>
            <h2 id="logout-title" className="mb-1 text-lg font-bold text-gray-900">Log out?</h2>
            <p id="logout-text" className="mb-5 text-sm text-gray-600">
              Are you sure you want to log out of your account?
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                autoFocus
                disabled={loggingOut}
                onClick={() => setConfirmLogout(false)}
                className="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={loggingOut}
                onClick={() => {
                  setLoggingOut(true);
                  onLogout();
                }}
                className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-60"
              >
                {loggingOut ? "Logging out…" : "Log Out"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
