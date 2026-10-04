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
}

/** The capture tallies the camera keeps for one session. */
export type CaptureTallies = {
  total: number;
  ok: number;
  rejectedByStatus: Record<string, number>;
  dropoutResets: number;
};

/**
 * The capture-quality summary saved when a session ends, or undefined when no
 * active frame was processed. Read back by `parseCaptureQualitySummary`.
 */
export function buildCaptureQualitySummary(tallies: CaptureTallies): CaptureQualityContext | undefined {
  if (tallies.total <= 0) return undefined;
  return {
    framesTotal: tallies.total,
    framesOk: tallies.ok,
    pctOk: Math.round((tallies.ok / tallies.total) * 100),
    rejectedFramesByStatus: { ...tallies.rejectedByStatus },
    sustainedDropoutResets: tallies.dropoutResets,
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
