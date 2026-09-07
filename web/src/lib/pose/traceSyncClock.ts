/**
 * Trace sync clock — the on-screen readout that lets a screen recording be
 * matched to an exported tuning trace.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * A recording session produces two artifacts that have to be lined up after
 * the fact: the tuning trace (numbers, no pictures) and a screen recording
 * (pictures, no numbers). Aligning them by wall clock or by counting frames
 * means fitting a mapping and hoping it does not drift.
 *
 * The alternative is to put the trace's OWN row key on screen. Pause the
 * recording anywhere, read the value, and look that row up directly — no
 * mapping, no drift, no nearest-neighbour search.
 *
 * ── WHY THE FORMAT IS LOSSLESS ──────────────────────────────────────────────
 * `elapsedMs` is stored in the trace as a whole number of milliseconds, and
 * `mm:ss.mmm` carries every one of those digits. `parseTraceElapsed` is the
 * exact inverse, so a value transcribed off a paused video frame converts back
 * to the integer in the export rather than to something near it. That is the
 * whole point of the format, and `traceSyncClock.test.ts` round-trips it
 * rather than taking it on trust.
 *
 * The companion frame index needs no formatting: it is already an integer and
 * is displayed as-is.
 *
 * ── SCOPE ───────────────────────────────────────────────────────────────────
 * Presentation and parsing only. This module holds no clock of its own and
 * reads no time source — the caller supplies the value it is about to persist,
 * which is what makes the readout and the stored row the same number rather
 * than two numbers that happen to agree.
 */

/** Milliseconds in one second / minute — named so the arithmetic reads. */
const MS_PER_SECOND = 1_000;
const SECONDS_PER_MINUTE = 60;
const MS_PER_MINUTE = MS_PER_SECOND * SECONDS_PER_MINUTE;

/** Shape `parseTraceElapsed` accepts and `formatTraceElapsed` produces. */
export const TRACE_ELAPSED_PATTERN = /^(\d{2,}):([0-5]\d)\.(\d{3})$/;

/**
 * Format a trace `elapsedMs` as `mm:ss.mmm` for the on-screen readout.
 *
 * Minutes are NOT clamped to two digits: a long set past 99 minutes widens the
 * field rather than wrapping, because a wrapped value would silently name the
 * wrong row. Negative or non-finite input returns null — the caller shows its
 * resting placeholder instead of rendering a misleading number.
 */
export function formatTraceElapsed(elapsedMs: number): string | null {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return null;
  if (!Number.isInteger(elapsedMs)) return null;

  const minutes = Math.floor(elapsedMs / MS_PER_MINUTE);
  const seconds = Math.floor((elapsedMs % MS_PER_MINUTE) / MS_PER_SECOND);
  const millis = elapsedMs % MS_PER_SECOND;

  return (
    `${String(minutes).padStart(2, "0")}:` +
    `${String(seconds).padStart(2, "0")}.` +
    `${String(millis).padStart(3, "0")}`
  );
}

/**
 * Exact inverse of `formatTraceElapsed`: turn a value read off a paused video
 * frame back into the `elapsed_ms` integer stored in the export.
 *
 * Returns null for anything that is not a well-formed reading, so a misread
 * digit fails loudly instead of resolving to a plausible wrong row.
 */
export function parseTraceElapsed(display: string): number | null {
  const match = TRACE_ELAPSED_PATTERN.exec(display.trim());
  if (!match) return null;

  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  const millis = Number(match[3]);

  return minutes * MS_PER_MINUTE + seconds * MS_PER_SECOND + millis;
}

/**
 * The full readout: the trace's frame index and its elapsed time, in the one
 * string the overlay renders.
 *
 * Both arguments must be the values the caller is persisting for THIS frame.
 * The frame index is the join key — it is an integer with no rounding argument
 * attached — and the elapsed time is what makes the recording scrubbable by
 * eye. Returns null if either value is unusable, so the overlay falls back to
 * its placeholder rather than displaying half a reading.
 */
export function formatTraceSyncReadout(
  frameIndex: number,
  elapsedMs: number,
): string | null {
  if (!Number.isInteger(frameIndex) || frameIndex < 0) return null;

  const elapsed = formatTraceElapsed(elapsedMs);
  if (elapsed === null) return null;

  return `#${frameIndex}  ${elapsed}`;
}

/** Shape `parseTraceSyncReadout` accepts and `formatTraceSyncReadout` emits. */
export const TRACE_SYNC_READOUT_PATTERN = /^#(\d+)\s+(\d{2,}):([0-5]\d)\.(\d{3})$/;

/**
 * Exact inverse of `formatTraceSyncReadout`: turn a full reading transcribed
 * off a paused video frame into the two fields that identify its export row.
 *
 * This is the function offline tooling should use. It returns null for anything
 * that is not a well-formed reading — INCLUDING the placeholder — so a frame
 * captured before tracing began, or a misread digit, fails loudly instead of
 * resolving to frame 0 at time zero, which is a real row and would look
 * entirely reasonable in a spreadsheet.
 */
export function parseTraceSyncReadout(
  display: string,
): { frameIndex: number; elapsedMs: number } | null {
  const match = TRACE_SYNC_READOUT_PATTERN.exec(display.trim());
  if (!match) return null;

  return {
    frameIndex: Number(match[1]),
    elapsedMs:
      Number(match[2]) * MS_PER_MINUTE +
      Number(match[3]) * MS_PER_SECOND +
      Number(match[4]),
  };
}

/** Shown before the first traced frame, and whenever a value is unusable. */
export const TRACE_SYNC_PLACEHOLDER = "#—  --:--.---";
