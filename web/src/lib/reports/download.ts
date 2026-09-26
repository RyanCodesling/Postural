/** Saves a generated report in the browser. */
export function downloadPdf(bytes: Uint8Array<ArrayBuffer>, filename: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Some browsers read the blob after click() returns, so revoke it later.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** e.g. "postural-session-report-lateral-arm-raises-2026-09-26.pdf" (local date). */
export function reportFileName(kind: "session" | "progress", subject: string, date: Date): string {
  const slug = subject
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const day = [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((n) => String(n).padStart(2, "0"))
    .join("-");
  return `postural-${kind}-report-${slug || "patient"}-${day}.pdf`;
}
