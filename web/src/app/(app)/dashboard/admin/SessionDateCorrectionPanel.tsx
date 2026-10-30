"use client";

import { useEffect, useRef, useState } from "react";
import {
  correctionLocalValue,
  correctionStartOnDay,
  type CorrectableSession,
  type DateCorrectionDestination,
  type SessionDateCorrectionDetail,
} from "@/lib/sessionDateCorrection";

const displayTime = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" });

export function SessionDateCorrectionPreview({ session, targetAt, destination }: { session: CorrectableSession; targetAt: string; destination?: DateCorrectionDestination }) {
  const targetMs = Date.parse(targetAt);
  const duration = session.endedAt ? Date.parse(session.endedAt) - Date.parse(session.startedAt) : NaN;
  if (!Number.isFinite(targetMs) || !Number.isFinite(duration) || duration < 0) return null;
  const end = new Date(targetMs + duration);
  if (!Number.isFinite(end.getTime())) return null;
  return (
    <div className="rounded-lg bg-blue-50 p-3 text-sm text-blue-950">
      <p>Start: {displayTime(session.startedAt)} → {displayTime(targetAt)}</p>
      <p>End: {displayTime(session.endedAt!)} → {displayTime(end.toISOString())}</p>
      <p>Duration stays {Math.floor(duration / 60_000)} min {((duration % 60_000) / 1000).toFixed(1)} sec.</p>
      <p>Scheduled day: {session.scheduledDay ?? "unassigned"} → {destination?.dueDate ?? "choose a destination"} (Manila).</p>
      {destination && destination.id !== session.occurrenceId && <p>The session and its {session.endReason === "completed" ? "completion" : session.endReason === "pain" ? "pain-stop outcome" : "partial attempt"} move to this day. The old day becomes unfinished; any earlier partial attempts remain there.</p>}
    </div>
  );
}

export default function SessionDateCorrectionPanel() {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [sessions, setSessions] = useState<CorrectableSession[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<SessionDateCorrectionDetail | null>(null);
  const [target, setTarget] = useState("");
  const [destinationId, setDestinationId] = useState(0);
  const [reason, setReason] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const selectionRequest = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetch(`/api/demo-clock/sessions?q=${encodeURIComponent(query)}&offset=${offset}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Could not load sessions.");
        setSessions(body.sessions);
        setHasMore(body.hasMore);
      })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load sessions."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query, offset, refresh]);

  useEffect(() => () => { selectionRequest.current += 1; }, []);

  async function selectSession(id: number, keepMessage = false) {
    const request = ++selectionRequest.current;
    setSelecting(true);
    setDetail(null);
    setError("");
    if (!keepMessage) setMessage("");
    try {
      const response = await fetch(`/api/demo-clock/sessions/${id}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not load the session.");
      if (request !== selectionRequest.current) return;
      setDetail(body);
      setTarget(correctionLocalValue(body.session.startedAt));
      setDestinationId(body.session.occurrenceId ?? 0);
      setReason("");
    } catch (cause) {
      if (request === selectionRequest.current) setError(cause instanceof Error ? cause.message : "Could not load the session.");
    } finally {
      if (request === selectionRequest.current) setSelecting(false);
    }
  }

  async function save() {
    if (!detail) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/demo-clock/sessions/${detail.session.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetAt: new Date(target).toISOString(), expectedStartedAt: detail.session.startedAt, expectedRevision: detail.revision, targetOccurrenceId: destinationId, reason }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not save the correction.");
      setMessage("Recorded date and scheduled outcome corrected. Refresh any open schedules, history, or reports to see them.");
      setRefresh(value => value + 1);
      await selectSession(detail.session.id, true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the correction.");
    } finally {
      setSaving(false);
    }
  }

  const unchanged = !detail || (target === correctionLocalValue(detail.session.startedAt) && destinationId === detail.session.occurrenceId);
  const validTarget = Boolean(target) && Number.isFinite(Date.parse(target));
  const destination = detail?.destinations.find(day => day.id === destinationId);
  const disabled = saving || selecting;

  return (
    <section className="mt-6 max-w-3xl rounded-xl bg-white p-6 shadow-sm" aria-labelledby="correct-session-heading">
      <h2 id="correct-session-heading" className="text-lg font-semibold text-gray-900">Correct a recorded date</h2>
      <p className="mt-2 text-sm text-gray-600">Forgot to set the demo date? Select a finished session, choose the correct scheduled day, and set its recorded start. Its end moves by the same amount. The session and its outcome move together in schedules, history, trends, and reports.</p>
      <p className="mt-2 text-sm text-gray-600">Measurements and video timing stay unchanged. Every correction keeps the original dates and scheduled outcome, your name, and your reason. Existing notifications and emails remain as originally sent.</p>
      <form className="mt-4 flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); setQuery(search.trim()); setOffset(0); setRefresh(value => value + 1); }}>
        <label className="flex-1 text-sm font-medium text-gray-700">Find a session
          <input className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" placeholder="Patient, exercise, or session number" maxLength={100} value={search} disabled={disabled} onChange={event => setSearch(event.target.value)} />
        </label>
        <button className="rounded-lg border px-4 py-2 text-sm disabled:opacity-50" disabled={disabled || loading}>Search</button>
      </form>
      {loading ? <p className="mt-4 text-sm" role="status">Loading sessions…</p> : (
        <div className="mt-3 max-h-72 overflow-y-auto rounded-lg border border-gray-200">
          {sessions.length === 0 && <p className="p-3 text-sm text-gray-600">No finished sessions found.</p>}
          {sessions.map(session => (
            <button key={session.id} type="button" disabled={disabled} onClick={() => void selectSession(session.id)} aria-pressed={detail?.session.id === session.id} className={`block w-full border-b border-gray-100 p-3 text-left text-sm hover:bg-blue-50 disabled:opacity-50 ${detail?.session.id === session.id ? "bg-blue-50" : ""}`}>
              <span className="font-medium">{session.patientName} · {session.exerciseName}</span>
              <span className="mt-1 block text-gray-600">{displayTime(session.startedAt)} · Session {session.id}</span>
            </button>
          ))}
        </div>
      )}
      <div className="mt-2 flex items-center gap-3 text-sm">
        <button type="button" disabled={disabled || loading || offset === 0} onClick={() => setOffset(value => Math.max(0, value - 50))} className="rounded border px-3 py-1 disabled:opacity-40">Previous</button>
        <span>Page {Math.floor(offset / 50) + 1}</span>
        <button type="button" disabled={disabled || loading || !hasMore} onClick={() => setOffset(value => value + 50)} className="rounded border px-3 py-1 disabled:opacity-40">Next</button>
      </div>
      {selecting && <p className="mt-4 text-sm" role="status">Loading selected session…</p>}
      {detail && (
        <form className="mt-5 space-y-4 border-t pt-4" onSubmit={event => { event.preventDefault(); void save(); }}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-medium">{detail.session.patientName} · {detail.session.exerciseName} · Session {detail.session.id}</h3>
            <button type="button" className="text-sm text-blue-700 underline disabled:opacity-50" disabled={disabled} onClick={() => void selectSession(detail.session.id)}>Reload session</button>
          </div>
          {!detail.available && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Date correction setup is required. Have the database owner run scripts/session_date_corrections_pg.sql before saving corrections.</p>}
          {!detail.session.endedAt && <p role="alert">Finish this session before correcting its date.</p>}
          <label className="block text-sm font-medium text-gray-700">Destination scheduled day (Asia/Manila)
            <select required value={destinationId} disabled={disabled || !detail.available} onChange={event => {
              const id = Number(event.target.value);
              setDestinationId(id);
              const day = detail.destinations.find(item => item.id === id);
              if (day) setTarget(correctionLocalValue(correctionStartOnDay(detail.session.startedAt, day.dueDate)));
              setMessage("");
            }} className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2">
              <option value={0} disabled>Choose a scheduled day</option>
              {detail.destinations.map(day => <option key={day.id} value={day.id}>{day.dueDate}{day.id === detail.session.occurrenceId ? " (current)" : ""}{day.makeupUntil !== day.dueDate ? ` — make-up through ${day.makeupUntil}` : ""}</option>)}
            </select>
          </label>
          <p className="text-sm text-gray-600">Other days must be unused and belong to the same prescription with the same recorded dose, side, and resistance. If the intended day is missing, review the prescription&apos;s schedule first.</p>
          <label className="block text-sm font-medium text-gray-700">Corrected start date and time (this device&apos;s timezone)
            <input type="datetime-local" step="0.001" required value={target} min="0001-01-01T00:00" max="9999-12-31T23:59:59.999" disabled={disabled || !detail.available} onChange={event => { setTarget(event.target.value); setMessage(""); }} className="mt-1 block rounded-lg border border-gray-300 px-3 py-2" />
          </label>
          {validTarget && <SessionDateCorrectionPreview session={detail.session} targetAt={new Date(target).toISOString()} destination={destination} />}
          <label className="block text-sm font-medium text-gray-700">Reason for correction
            <textarea required maxLength={500} rows={2} value={reason} disabled={disabled || !detail.available} onChange={event => setReason(event.target.value)} placeholder="For example: forgot to set the demo date before recording." className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2" />
          </label>
          <button type="submit" disabled={disabled || !detail.available || !detail.session.endedAt || !destination || !validTarget || unchanged || !reason.trim()} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{saving ? "Saving…" : "Save date correction"}</button>
          {detail.history.length > 0 && (
            <div className="space-y-2 border-t pt-4">
              <h3 className="font-medium">Correction history</h3>
              <p className="text-sm text-gray-600">Originally recorded: {displayTime(detail.history[detail.history.length - 1].oldStartedAt)}</p>
              {detail.history.map(item => (
                <div key={item.id} className="rounded-lg bg-gray-50 p-3 text-sm">
                  <p>{displayTime(item.oldStartedAt)} → {displayTime(item.newStartedAt)}</p>
                  <p>Scheduled day: {item.oldScheduledDay} → {item.newScheduledDay}</p>
                  <p className="mt-1 whitespace-pre-wrap">{item.reason}</p>
                  <p className="mt-1 text-gray-600">{item.correctedByName} · {displayTime(item.correctedAt)} (actual correction time)</p>
                </div>
              ))}
            </div>
          )}
        </form>
      )}
      {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
      {message && <p role="status" className="mt-4 text-sm text-green-700">{message}</p>}
    </section>
  );
}
