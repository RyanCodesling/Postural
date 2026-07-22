export interface CaptureQualityContext {
  framesTotal: number;
  framesOk: number;
  pctOk: number;
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
  return {
    framesTotal: Math.round(framesTotal),
    framesOk: Math.round(framesOk),
    pctOk: Math.min(100, Math.round(pctOk)),
  };
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
