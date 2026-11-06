"use client";

import { useCallback, useEffect, useState } from "react";
import { FIT_SCREEN, PageHeading, Panel } from "../_components/DashboardKit";

type Kind = "session_video" | "patient_file" | "exercise_video";

interface DeletedItem {
  id: number;
  kind: Kind;
  label: string;
  details: { startedAt?: string | null; source?: string; youtubeVideoId?: string };
  patientName: string | null;
  exerciseName: string | null;
  exerciseArchived: boolean;
  deletedByName: string | null;
  deletedByRole: string | null;
  deletedAt: string;
}

const FILTERS: { key: "all" | Kind; label: string }[] = [
  { key: "all", label: "All" },
  { key: "session_video", label: "Session videos" },
  { key: "patient_file", label: "Attached files" },
  { key: "exercise_video", label: "Guide videos" },
];

const KIND_BADGE: Record<Kind, { label: string; classes: string }> = {
  session_video: { label: "Session video", classes: "bg-blue-100 text-blue-800" },
  patient_file: { label: "Attached file", classes: "bg-amber-100 text-amber-800" },
  exercise_video: { label: "Guide video", classes: "bg-green-100 text-green-800" },
};

const manila = (iso: string, withTime: boolean) =>
  new Date(iso).toLocaleString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
    timeZone: "Asia/Manila",
  });

function itemTitle(item: DeletedItem): string {
  if (item.kind === "session_video") return `${item.label} session video`;
  if (item.kind === "exercise_video") return `${item.label} guide video`;
  return item.label;
}

function itemDetail(item: DeletedItem): string {
  if (item.kind === "session_video") {
    return item.details.startedAt ? `Session on ${manila(item.details.startedAt, false)}` : "Session video";
  }
  if (item.kind === "exercise_video") {
    return item.details.source === "youtube"
      ? `YouTube video (${item.details.youtubeVideoId ?? "unknown"})`
      : "Uploaded video file";
  }
  return "Attached to the patient's record";
}

function belongsTo(item: DeletedItem): string {
  if (item.kind === "exercise_video") {
    return `${item.exerciseName ?? item.label} (custom exercise${item.exerciseArchived ? ", archived" : ""})`;
  }
  return item.patientName ?? "Unknown patient";
}

/**
 * Recently Deleted: the admin restores a deleted session video, attached file
 * or guide video, or deletes it for good. Items stay until the admin acts;
 * their contents are never opened here.
 */
export default function RecentlyDeletedPanel() {
  const [items, setItems] = useState<DeletedItem[] | null>(null);
  const [ready, setReady] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [filter, setFilter] = useState<"all" | Kind>("all");
  const [query, setQuery] = useState("");
  const [confirming, setConfirming] = useState<{ item: DeletedItem; action: "restore" | "purge" } | null>(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/deleted-items", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not load Recently Deleted.");
      setReady(data.ready !== false);
      setItems(Array.isArray(data.items) ? data.items : []);
      setLoadError("");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load Recently Deleted.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const act = async () => {
    if (!confirming) return;
    const { item, action } = confirming;
    setWorking(true);
    try {
      const response = await fetch(`/api/admin/deleted-items/${item.id}`, { method: action === "restore" ? "POST" : "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Something went wrong. Please try again.");
      setMessage({
        tone: "ok",
        text: action === "restore" ? data.message ?? `${itemTitle(item)} was restored.` : `${itemTitle(item)} was deleted for good.`,
      });
      await load();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Something went wrong. Please try again." });
    } finally {
      setWorking(false);
      setConfirming(null);
    }
  };

  const needle = query.trim().toLowerCase();
  const shown = (items ?? []).filter((item) =>
    (filter === "all" || item.kind === filter) &&
    (!needle || [itemTitle(item), belongsTo(item), item.deletedByName ?? ""].some((text) => text.toLowerCase().includes(needle))),
  );
  const countOf = (key: "all" | Kind) => (items ?? []).filter((item) => key === "all" || item.kind === key).length;

  return (
    <div className={FIT_SCREEN}>
      <PageHeading
        title="Recently Deleted"
        subtitle="Session videos, attached files and guide videos that were deleted. Restore one when asked, or delete it for good."
      />

      {!ready && (
        <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Recently Deleted needs <code className="font-mono text-xs">scripts/deleted_items_pg.sql</code> to be run on the
          database. Until then, session videos and attached files cannot be deleted, so nothing is lost.
        </div>
      )}

      <div id="tour-deleted-filters" className="flex shrink-0 flex-wrap items-center gap-2">
        {FILTERS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            aria-pressed={filter === key}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
              filter === key ? "border-green-600 bg-green-50 text-green-800" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            {label} <span className="text-gray-400">({countOf(key)})</span>
          </button>
        ))}
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name, patient or who deleted it"
          aria-label="Search Recently Deleted"
          className="min-w-0 flex-1 basis-56 rounded-lg border border-green-200 bg-white px-3 py-1.5 text-sm focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-100"
        />
      </div>

      {message && (
        <p role="status" className={`shrink-0 text-sm ${message.tone === "ok" ? "text-green-700" : "text-red-600"}`}>{message.text}</p>
      )}

      <Panel id="tour-deleted-list" title={`Deleted items (${shown.length})`} className="min-h-0 flex-1" scroll>
        {loadError ? (
          <p className="py-6 text-center text-sm text-red-600">{loadError}</p>
        ) : items === null ? (
          <p className="py-6 text-center text-sm text-gray-500">Loading…</p>
        ) : shown.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-400">
            {items.length === 0 ? "Nothing has been deleted." : "No deleted items match."}
          </p>
        ) : (
          <table className="stack-table w-full min-w-[720px] text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="py-2 pr-4 font-medium">Item</th>
                <th className="px-4 py-2 font-medium">Patient / exercise</th>
                <th className="px-4 py-2 font-medium">Deleted by</th>
                <th className="px-4 py-2 font-medium">Deleted on</th>
                <th className="py-2 pl-4 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {shown.map((item) => (
                <tr key={item.id} className="align-top transition hover:bg-green-50/40">
                  <td className="py-3 pr-4">
                    <span className={`mb-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${KIND_BADGE[item.kind].classes}`}>
                      {KIND_BADGE[item.kind].label}
                    </span>
                    <p className="break-all font-semibold text-gray-900">{itemTitle(item)}</p>
                    <p className="text-xs text-gray-500">{itemDetail(item)}</p>
                  </td>
                  <td data-label="Patient / exercise" className="px-4 py-3 text-gray-700">{belongsTo(item)}</td>
                  <td data-label="Deleted by" className="px-4 py-3 text-gray-700">
                    {item.deletedByName ?? "Removed account"}
                    {item.deletedByRole && <span className="block text-xs capitalize text-gray-500">{item.deletedByRole}</span>}
                  </td>
                  <td data-label="Deleted on" className="px-4 py-3 text-gray-700">{manila(item.deletedAt, true)}</td>
                  <td className="py-3 pl-4">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setConfirming({ item, action: "restore" })}
                        className="rounded-lg bg-green-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-800"
                      >
                        Restore
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirming({ item, action: "purge" })}
                        className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
                      >
                        Delete for good
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      {confirming && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50" onClick={() => !working && setConfirming(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div role="dialog" aria-modal="true" aria-labelledby="deleted-confirm-title" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
              <h2 id="deleted-confirm-title" className="mb-1 text-lg font-bold text-gray-900">
                {confirming.action === "restore" ? "Restore this item?" : "Delete for good?"}
              </h2>
              <p className="break-words text-sm text-gray-600">
                <span className="font-semibold text-gray-900">{itemTitle(confirming.item)}</span> · {belongsTo(confirming.item)}
              </p>
              <p className="mt-3 text-sm text-gray-600">
                {confirming.action === "purge"
                  ? "It is removed from the system and cannot be restored here again. Copies in earlier nightly backups remain until those backups are removed."
                  : confirming.item.kind === "exercise_video"
                    ? "It becomes the exercise's guide video again. The video it replaces moves to Recently Deleted."
                    : confirming.item.kind === "session_video"
                      ? "The patient and their therapist can watch it again, and both are notified."
                      : "It returns to the patient's attached files, and the patient and their therapist are notified."}
              </p>
              <div className="mt-5 flex gap-3">
                <button
                  type="button"
                  onClick={() => setConfirming(null)}
                  disabled={working}
                  className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void act()}
                  disabled={working}
                  className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-60 ${
                    confirming.action === "purge" ? "bg-red-600 hover:bg-red-700" : "bg-green-700 hover:bg-green-800"
                  }`}
                >
                  {working ? "Working…" : confirming.action === "restore" ? "Restore" : "Delete for good"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
