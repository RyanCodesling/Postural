"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import NotificationBell from "./NotificationBell";
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

function initials(name: string | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return ((parts[0][0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

function SearchIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
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
 * with a quick-jump search, the notification bell and the user's name, and a
 * soft green page background that cards sit on.
 */
export default function AppShell({
  items,
  userName,
  roleLabel,
  onLogout,
  children,
}: {
  items: ShellNavItem[];
  userName: string | undefined;
  roleLabel: string;
  onLogout: () => void;
  children: ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? items.filter((item) => item.label.toLowerCase().includes(q)) : [];
  }, [items, query]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) setSearchOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

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
      <Link key={item.key} href={item.href} className={itemClass(item.active)} onClick={() => setDrawerOpen(false)}>
        {inner}
      </Link>
    ) : (
      <button
        key={item.key}
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

  const choose = (item: ShellNavItem) => {
    setQuery("");
    setSearchOpen(false);
    if (item.href) window.location.assign(item.href);
    else item.onSelect?.();
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
            <p className="truncate text-sm font-bold text-green-900">ACC Bacoor</p>
            <p className="truncate text-[10px] text-green-900/60">Postural Monitoring</p>
          </div>
        </div>
        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto">{items.map(renderItem)}</nav>
        <button
          type="button"
          onClick={onLogout}
          className="mt-2 flex w-full shrink-0 items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-red-700/80 transition hover:bg-white/60 hover:text-red-700"
        >
          <LogoutGlyph />
          Log Out
        </button>
      </aside>

      <div className="md:pl-52 print:pl-0">
        <header className="sticky top-0 z-20 flex items-center gap-3 bg-white px-4 py-3 shadow-sm print:hidden sm:px-6">
          <button
            type="button"
            aria-label="Open menu"
            className="rounded-lg border border-green-200 px-3 py-2 text-sm text-green-800 md:hidden"
            onClick={() => setDrawerOpen(true)}
          >
            ☰
          </button>

          <div ref={searchRef} className="relative min-w-0 flex-1 sm:max-w-md">
            <div className="flex items-center gap-2 rounded-lg bg-[#eef4ef] px-3 py-2 text-gray-500">
              <SearchIcon />
              <input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSearchOpen(true);
                }}
                onFocus={() => setSearchOpen(true)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && matches[0]) choose(matches[0]);
                  if (event.key === "Escape") setSearchOpen(false);
                }}
                placeholder="Search pages"
                aria-label="Search pages"
                className="w-full bg-transparent text-sm text-gray-800 outline-none placeholder:text-gray-400"
              />
            </div>
            {searchOpen && query.trim() && (
              <ul className="absolute left-0 right-0 top-full mt-1 overflow-hidden rounded-lg border border-green-100 bg-white py-1 shadow-lg">
                {matches.length === 0 ? (
                  <li className="px-3 py-2 text-sm text-gray-500">No matching page</li>
                ) : (
                  matches.map((item) => (
                    <li key={item.key}>
                      <button
                        type="button"
                        onClick={() => choose(item)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-800 hover:bg-green-50"
                      >
                        <span className="text-green-700">{item.icon}</span>
                        {item.label}
                      </button>
                    </li>
                  ))
                )}
              </ul>
            )}
          </div>

          <div className="ml-auto flex items-center gap-3">
            <NotificationBell />
            <div className="hidden items-center gap-3 sm:flex">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-green-600 text-xs font-bold text-white">
                {initials(userName)}
              </span>
              <div className="leading-tight">
                <p className="text-sm font-semibold text-gray-900">{userName || roleLabel}</p>
                <p className="text-xs text-gray-500">{roleLabel}</p>
              </div>
            </div>
          </div>
        </header>

        <main className="min-w-0 p-4 sm:p-6 print:p-0">{children}</main>
      </div>
    </div>
  );
}
