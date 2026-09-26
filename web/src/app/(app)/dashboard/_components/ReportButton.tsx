"use client";

import { useState, type CSSProperties } from "react";

/**
 * A button that builds and saves a PDF report. The report code loads only
 * when clicked, so pages do not carry it in their bundle.
 */
export default function ReportButton({
  label,
  onDownload,
  className,
  style,
  wrapperStyle,
}: {
  label: string;
  onDownload: () => Promise<void>;
  className?: string;
  style?: CSSProperties;
  /** Sizing for the wrapper, e.g. a flex share inside a button row. */
  wrapperStyle?: CSSProperties;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4, ...wrapperStyle }}>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(false);
          try {
            await onDownload();
          } catch (err) {
            console.error("Report download failed:", err);
            setError(true);
          } finally {
            setBusy(false);
          }
        }}
        className={className}
        style={style}
      >
        {busy ? "Preparing PDF…" : label}
      </button>
      {error && (
        <span role="alert" style={{ fontSize: 12, color: "#b91c1c" }}>
          The report could not be created. Please try again.
        </span>
      )}
    </span>
  );
}
