"use client";

import { useState } from "react";
import { describePresence, type PresenceRole, type UserPresence } from "@/lib/presence";

const FILTERS: { key: "all" | PresenceRole; label: string }[] = [
  { key: "all", label: "All" },
  { key: "patient", label: "Patients" },
  { key: "therapist", label: "Therapists" },
];

/** The search box appears once the list is longer than this. */
const SEARCH_FROM = 8;

/**
 * Which patients and therapists are online now, and when the others were last
 * active. Replaces the old login/logout feed, which could not tell a closed tab
 * from someone still using the system.
 */
export default function UserStatusPanel({
  presence,
  now,
}: {
  presence: { available: boolean; users: UserPresence[] };
  /** When the data arrived, so the "ago" labels match it. */
  now: number;
}) {
  const [role, setRole] = useState<"all" | PresenceRole>("all");
  const [query, setQuery] = useState("");

  const onlineCount = presence.users.filter((u) => u.online).length;
  const needle = query.trim().toLowerCase();
  const shown = presence.users.filter(
    (u) => (role === "all" || u.role === role) && (!needle || u.name.toLowerCase().includes(needle)),
  );

  return (
    <div id="tour-presence" className="flex min-h-[260px] min-w-0 flex-col rounded-xl bg-white p-5 shadow-sm lg:col-span-7 lg:min-h-0">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 pb-2">
        <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
          <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 0 0-5.36-1.86M17 20H7m10 0v-2c0-.66-.13-1.28-.36-1.86M7 20H2v-2a3 3 0 0 1 5.36-1.86M7 20v-2c0-.66.13-1.28.36-1.86m0 0a5 5 0 0 1 9.28 0M15 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
          </svg>
          User Status
        </h2>
        {presence.available && (
          <span className="flex items-center gap-1.5 rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-800">
            <span className="h-2 w-2 rounded-full bg-green-500" />
            {onlineCount} of {presence.users.length} online
          </span>
        )}
      </div>

      {!presence.available ? (
        <p className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900">
          One-time setup is needed. Have the database owner run scripts/user_presence_pg.sql. After that, this list fills in
          without restarting the server.
        </p>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <div className="flex gap-1" role="group" aria-label="Show">
              {FILTERS.map((filter) => (
                <button
                  key={filter.key}
                  type="button"
                  onClick={() => setRole(filter.key)}
                  aria-pressed={role === filter.key}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                    role === filter.key ? "bg-green-700 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {filter.label}
                </button>
              ))}
            </div>
            {presence.users.length > SEARCH_FROM && (
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search name"
                aria-label="Search users by name"
                className="ml-auto w-40 rounded-lg border border-green-200 px-3 py-1 text-xs text-gray-900 focus:border-green-500 focus:outline-none"
              />
            )}
          </div>

          <ul className="min-h-0 flex-1 divide-y divide-gray-50 overflow-y-auto pr-1">
            {shown.length === 0 ? (
              <li className="py-12 text-center text-sm text-gray-400">
                {presence.users.length === 0 ? "No patients or therapists yet." : "No one matches."}
              </li>
            ) : (
              shown.map((user) => (
                <li key={user.id} className="flex items-center gap-3 px-2 py-2.5">
                  <span
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${user.online ? "bg-green-500 ring-4 ring-green-100" : "bg-gray-300"}`}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-800">{user.name}</span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      user.role === "therapist" ? "bg-green-100 text-green-800" : "bg-blue-100 text-blue-800"
                    }`}
                  >
                    {user.role === "therapist" ? "Therapist" : "Patient"}
                  </span>
                  <span className={`w-36 shrink-0 text-right text-xs ${user.online ? "font-semibold text-green-700" : "text-gray-500"}`}>
                    {describePresence(user, now)}
                  </span>
                </li>
              ))
            )}
          </ul>
        </>
      )}
    </div>
  );
}
