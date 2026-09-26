/**
 * Places a recording part's sets, repetitions and coaching cues on its video,
 * in milliseconds from the part's start. Sets and repetitions carry wall-clock
 * timestamps, and each coaching record states the wall time of its clock's
 * origin; the recorder stamps the part from the same clock. Items that belong
 * to another part of a resumed session are left out; ones crossing the part's
 * edges are clipped.
 */
import type { MetricName } from "@/lib/exercises/registry";
import { cueEpisodes, setCoachingAudit } from "@/lib/pose/coachingAudit";
import { OVERLAY_LABELS } from "@/lib/pose/drawCompensationOverlay";

type Stamped = { startTs?: string | null; endTs?: string | null };
export type TimelineSource = {
  sets: Array<Stamped & { setIndex: number; holdQuality: unknown }>;
  reps: Array<Stamped & { setIndex: number; repIndex: number; side: string; classification: string }>;
  /** Attempts that credited no movement: their cues were still on screen. */
  auditAttempts?: Array<{ setIndex: number; holdQuality: unknown }>;
};

export type VideoTimeline = {
  durationMs: number;
  sets: Array<{ setIndex: number; startMs: number; endMs: number }>;
  reps: Array<{ setIndex: number; side: string; number: number; startMs: number; endMs: number; complete: boolean }>;
  cues: Array<{ metric: MetricName; label: string; text: string; startMs: number; endMs: number; uncredited: boolean }>;
  /** Sets whose coaching record reached its cap and dropped its earliest entries. */
  cappedSets: number[];
};

const wallMs = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
};

export function buildVideoTimeline(
  part: { startWallMs: number },
  durationMs: number,
  source: TimelineSource,
): VideoTimeline {
  const place = (start: number | null, end: number | null) => {
    if (start === null) return null;
    const from = start - part.startWallMs;
    const to = (end ?? start) - part.startWallMs;
    if (to < 0 || from > durationMs) return null;
    return { startMs: Math.max(0, from), endMs: Math.min(durationMs, Math.max(from, to)) };
  };

  const sets = source.sets.flatMap((set) => {
    const at = place(wallMs(set.startTs), wallMs(set.endTs));
    return at ? [{ setIndex: set.setIndex, ...at }] : [];
  });

  // Repetitions are numbered per set and side across the whole session, so a
  // set split by a reload keeps counting in the next part.
  const counts = new Map<string, number>();
  const reps = [...source.reps]
    .sort((a, b) => (wallMs(a.startTs) ?? 0) - (wallMs(b.startTs) ?? 0) || a.repIndex - b.repIndex)
    .flatMap((rep) => {
      const key = `${rep.setIndex}:${rep.side}`;
      const number = (counts.get(key) ?? 0) + 1;
      counts.set(key, number);
      const at = place(wallMs(rep.startTs), wallMs(rep.endTs));
      return at ? [{ setIndex: rep.setIndex, side: rep.side, number, ...at, complete: rep.classification === "complete" }] : [];
    });

  const cues: VideoTimeline["cues"] = [];
  const cappedSets = new Set<number>();
  const readAudits = (rows: Array<{ setIndex: number; holdQuality: unknown }>, uncredited: boolean) => {
    for (const row of rows) {
      const audit = setCoachingAudit(row.holdQuality);
      if (!audit) continue;
      if (audit.droppedRecords > 0) cappedSets.add(row.setIndex);
      const origin = Date.parse(audit.clockOriginIso);
      if (!Number.isFinite(origin)) continue;
      for (const episode of cueEpisodes(audit)) {
        const at = place(origin + episode.startMs, origin + episode.endMs);
        if (at) {
          cues.push({
            metric: episode.metric,
            label: OVERLAY_LABELS[episode.metric] ?? episode.metric,
            text: episode.text,
            ...at,
            uncredited,
          });
        }
      }
    }
  };
  readAudits(source.sets, false);
  readAudits(source.auditAttempts ?? [], true);
  cues.sort((a, b) => a.startMs - b.startMs);

  return { durationMs, sets, reps, cues, cappedSets: [...cappedSets].sort((a, b) => a - b) };
}

/** "m:ss" for a position on the video. */
export function formatVideoTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
