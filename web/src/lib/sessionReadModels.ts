export interface CaptureQualityContext {
  framesTotal: number;
  framesOk: number;
  pctOk: number;
  /**
   * Rejected active frames by capture-readiness status, for example
   * "KNEES_NOT_VISIBLE"; a frame with no person found counts as "NOT_VISIBLE".
   * Absent from summaries saved before 2026-10-02.
   */
  rejectedFramesByStatus?: Record<string, number>;
  /**
   * How many times frames stayed rejected for the camera's dropout grace, so
   * the movement in progress was discarded. Absent before 2026-10-02.
   */
  sustainedDropoutResets?: number;
  /**
   * Frames that passed capture readiness but on which the tracking check found
   * a part the exercise depends on unsteady. Absent before the tracking check.
   */
  unsteadyFrames?: number;
  /**
   * Frames that passed capture readiness and on which the tracking check could
   * judge a part the exercise depends on: too few frames a second, or too
   * uneven, leave it unable to. Absent before 2026-10-10.
   */
  checkedFrames?: number;
  /**
   * Every camera frame size the session measured on, in pixels, with the
   * number of frames that passed capture readiness at that size, largest
   * count first. Readings depend on the frame's shape, and every threshold was
   * tuned on 16:9 (1280x720) frames, so this shows whether a session's
   * readings are comparable; more than one entry means the size changed during
   * the session. Counted by the session itself, so Stop does not clear it and
   * Resume carries it. Before 2026-10-14 the size was kept only in the opt-in
   * tuning trace.
   */
  frameSizes?: { width: number; height: number; frames: number }[];
  /**
   * Neck side bends only (trend data rule 4): what a still head read in the
   * rests between sets, per calibration, from the time that calibration was
   * taken. Each repetition's peak is measured from it. Absent before
   * 2026-10-19 and for other exercises.
   */
  neckRest?: NeckRestRecord;
}

/** Version of the neck rest record (trend data rule 4). */
export const NECK_REST_RULE = "neck_rest_reference_v1" as const;

/** The fewest still frames in a calibration's rests for a usable reading. */
export const NECK_REST_MIN_FRAMES = 30;

export interface NeckRestRecord {
  rule: typeof NECK_REST_RULE;
  epochs: { from: string; offsetDeg: number | null; frames: number }[];
}

/** The camera's running neck rest readings: one entry per calibration, in pipeline degrees. */
export type NeckRestTally = { epochs: { from: string; readings: number[] }[] };

/** The capture tallies the camera keeps for one session. */
export type CaptureTallies = {
  total: number;
  ok: number;
  rejectedByStatus: Record<string, number>;
  dropoutResets: number;
  unsteady?: number;
  checked?: number;
  /** Accepted frames per frame size, keyed "WxH" (for example "1280x720"). */
  frameSizes?: Record<string, number>;
  /** Neck side bends: the still-head readings in the rests between sets, per calibration. */
  neckRest?: NeckRestTally;
};

const isoTime = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value));

const medianOf = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * The neck rest record from the camera's readings: each calibration's median
 * still-head reading, or null below NECK_REST_MIN_FRAMES. Null without epochs.
 */
export function neckRestRecordFromTally(tally: NeckRestTally | undefined): NeckRestRecord | null {
  if (!tally || !Array.isArray(tally.epochs) || tally.epochs.length === 0) return null;
  const epochs: NeckRestRecord["epochs"] = [];
  for (const epoch of tally.epochs) {
    if (!isoTime(epoch?.from) || !Array.isArray(epoch.readings)) return null;
    const readings = epoch.readings.filter((v) => typeof v === "number" && Number.isFinite(v));
    epochs.push({
      from: epoch.from,
      offsetDeg: readings.length >= NECK_REST_MIN_FRAMES ? Math.round(medianOf(readings) * 100) / 100 : null,
      frames: readings.length,
    });
  }
  return { rule: NECK_REST_RULE, epochs };
}

/** A saved neck rest record, or null when absent or malformed. */
export function parseNeckRestRecord(value: unknown): NeckRestRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.rule !== NECK_REST_RULE || !Array.isArray(record.epochs) || record.epochs.length > 50) return null;
  const epochs: NeckRestRecord["epochs"] = [];
  for (const item of record.epochs) {
    if (!item || typeof item !== "object") return null;
    const { from, offsetDeg, frames } = item as Record<string, unknown>;
    const offsetOk = offsetDeg === null || (typeof offsetDeg === "number" && Number.isFinite(offsetDeg) && Math.abs(offsetDeg) <= 45);
    if (!isoTime(from) || !offsetOk || !frameCount(frames)) return null;
    epochs.push({ from, offsetDeg: offsetDeg as number | null, frames });
  }
  return { rule: NECK_REST_RULE, epochs };
}

type FrameSizeCount = { width: number; height: number; frames: number };

const plausibleSide = (n: unknown): n is number =>
  typeof n === "number" && Number.isInteger(n) && n > 0 && n <= 10_000;
const frameCount = (n: unknown): n is number =>
  typeof n === "number" && Number.isInteger(n) && n >= 0;

/**
 * A valid list of frame sizes with their counts, largest count first, or null.
 * Accepts the camera's "WxH" tally or the saved list. The counts must not add
 * up to more than the frames that passed (`maxFrames`); anything malformed or
 * inconsistent gives null, so the summary leaves the field out.
 */
function frameSizeList(value: unknown, maxFrames: number): FrameSizeCount[] | null {
  let entries: FrameSizeCount[];
  if (Array.isArray(value)) {
    entries = [];
    for (const item of value) {
      if (!item || typeof item !== "object") return null;
      const { width, height, frames } = item as Record<string, unknown>;
      if (!plausibleSide(width) || !plausibleSide(height) || !frameCount(frames)) return null;
      entries.push({ width, height, frames });
    }
  } else if (value && typeof value === "object") {
    entries = [];
    for (const [key, frames] of Object.entries(value as Record<string, unknown>)) {
      const match = /^(\d{1,5})x(\d{1,5})$/.exec(key);
      const width = match ? Number(match[1]) : NaN;
      const height = match ? Number(match[2]) : NaN;
      if (!plausibleSide(width) || !plausibleSide(height) || !frameCount(frames)) return null;
      entries.push({ width, height, frames });
    }
  } else {
    return null;
  }
  const keys = new Set(entries.map((e) => `${e.width}x${e.height}`));
  const total = entries.reduce((sum, e) => sum + e.frames, 0);
  if (entries.length === 0 || keys.size !== entries.length || total > maxFrames) return null;
  return entries.sort((a, b) => b.frames - a.frames || b.width - a.width || b.height - a.height);
}

/**
 * The capture-quality summary saved when a session ends, or undefined when no
 * active frame was processed. Read back by `parseCaptureQualitySummary`.
 */
export function buildCaptureQualitySummary(tallies: CaptureTallies): CaptureQualityContext | undefined {
  if (tallies.total <= 0) return undefined;
  const frameSizes = frameSizeList(tallies.frameSizes, tallies.ok);
  const neckRest = neckRestRecordFromTally(tallies.neckRest);
  return {
    framesTotal: tallies.total,
    framesOk: tallies.ok,
    pctOk: Math.round((tallies.ok / tallies.total) * 100),
    rejectedFramesByStatus: { ...tallies.rejectedByStatus },
    sustainedDropoutResets: tallies.dropoutResets,
    ...(tallies.unsteady === undefined ? {} : { unsteadyFrames: tallies.unsteady }),
    ...(tallies.checked === undefined ? {} : { checkedFrames: tallies.checked }),
    ...(frameSizes ? { frameSizes } : {}),
    ...(neckRest ? { neckRest } : {}),
  };
}

/**
 * The share of frames, in whole percent, on which the tracking check found the
 * points the exercise depends on unsteady: unsteady frames over the frames it
 * could judge, or over the frames that passed capture readiness for sessions
 * saved before that count. Null without a tracking count or a judged frame.
 */
export function unsteadyTrackingPct(
  quality: { framesOk: number; unsteadyFrames?: number; checkedFrames?: number } | null | undefined,
): number | null {
  if (!quality || quality.unsteadyFrames === undefined) return null;
  const judged = quality.checkedFrames ?? quality.framesOk;
  return judged > 0 ? Math.round((100 * quality.unsteadyFrames) / judged) : null;
}

/**
 * At this share of unsteady frames or more, staff views flag the session: the
 * line at which trend data rule 2 leaves a repetition out (D-39).
 */
export const UNSTEADY_TRACKING_NOTE_PCT = 25;

export interface DeviceContext {
  browser: string;
  platform: string;
}

function finiteNonnegative(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

export function parseCaptureQualitySummary(value: unknown): CaptureQualityContext | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const framesTotal = finiteNonnegative(record.framesTotal);
  const framesOk = finiteNonnegative(record.framesOk);
  const pctOk = finiteNonnegative(record.pctOk);
  if (framesTotal === null || framesOk === null || pctOk === null || framesOk > framesTotal) {
    return null;
  }
  const summary: CaptureQualityContext = {
    framesTotal: Math.round(framesTotal),
    framesOk: Math.round(framesOk),
    pctOk: Math.min(100, Math.round(pctOk)),
  };
  // The rejection detail is optional. Malformed or inconsistent detail (more
  // rejected frames than frames not OK) is left out rather than voiding the
  // summary.
  const rejected = record.rejectedFramesByStatus;
  if (rejected && typeof rejected === "object" && !Array.isArray(rejected)) {
    const counts: Record<string, number> = {};
    let valid = true;
    for (const [status, count] of Object.entries(rejected)) {
      const n = finiteNonnegative(count);
      if (n === null || !/^[A-Z_]{1,40}$/.test(status)) { valid = false; break; }
      counts[status] = Math.round(n);
    }
    const sum = Object.values(counts).reduce((a, b) => a + b, 0);
    if (valid && sum <= summary.framesTotal - summary.framesOk) summary.rejectedFramesByStatus = counts;
  }
  const resets = finiteNonnegative(record.sustainedDropoutResets);
  if (resets !== null) summary.sustainedDropoutResets = Math.round(resets);
  const unsteady = finiteNonnegative(record.unsteadyFrames);
  if (unsteady !== null && unsteady <= summary.framesOk) summary.unsteadyFrames = Math.round(unsteady);
  const checked = finiteNonnegative(record.checkedFrames);
  if (checked !== null && checked <= summary.framesOk) summary.checkedFrames = Math.round(checked);
  const frameSizes = frameSizeList(record.frameSizes, summary.framesOk);
  if (frameSizes) summary.frameSizes = frameSizes;
  const neckRest = parseNeckRestRecord(record.neckRest);
  if (neckRest) summary.neckRest = neckRest;
  return summary;
}

/**
 * Reduce the stored user-agent to a coarse browser/platform label. The full
 * string is intentionally not returned to the therapist because it adds
 * fingerprinting detail without improving clinical interpretation.
 */
export function summarizeDeviceInfo(value: unknown): DeviceContext | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const userAgent = (value as Record<string, unknown>).userAgent;
  if (typeof userAgent !== "string" || userAgent.length === 0) return null;

  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Firefox\//.test(userAgent)
      ? "Firefox"
      : /Chrome\//.test(userAgent)
        ? "Chrome"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : "Other browser";
  const platform = /Android/.test(userAgent)
    ? "Android"
    : /iPhone|iPad|iPod/.test(userAgent)
      ? "iOS"
      : /Windows/.test(userAgent)
        ? "Windows"
        : /Macintosh|Mac OS X/.test(userAgent)
          ? "macOS"
          : /Linux/.test(userAgent)
            ? "Linux"
            : "Other platform";

  return { browser, platform };
}
