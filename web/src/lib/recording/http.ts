/**
 * One byte range from a `Range` header, clamped to the file size. Returns null
 * when the whole file should be served (no header, several ranges or a header
 * this server does not understand, which HTTP says to ignore) and
 * "unsatisfiable" when the range lies outside the file.
 */
export function parseRange(
  header: string | null,
  size: number,
): { start: number; end: number } | null | "unsatisfiable" {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === "" && match[2] === "")) return null;
  let start: number;
  let end: number;
  if (match[1] === "") {
    const suffix = Number(match[2]);
    if (suffix === 0) return "unsatisfiable";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  if (start >= size || start > end) return "unsatisfiable";
  return { start, end };
}
