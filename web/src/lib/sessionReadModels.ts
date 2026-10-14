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
}

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
};

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
  return {
    framesTotal: tallies.total,
    framesOk: tallies.ok,
    pctOk: Math.round((tallies.ok / tallies.total) * 100),
    rejectedFramesByStatus: { ...tallies.rejectedByStatus },
    sustainedDropoutResets: tallies.dropoutResets,
    ...(tallies.unsteady === undefined ? {} : { unsteadyFrames: tallies.unsteady }),
    ...(tallies.checked === undefined ? {} : { checkedFrames: tallies.checked }),
    ...(frameSizes ? { frameSizes } : {}),
  };
}

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
