"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { isPatientImageMimeType } from "@/lib/patientAttachments";

export interface PatientFile {
  id: number;
  fileName: string;
  mimeType: string;
}

/**
 * Opens one of a patient's attached files after the viewer re-enters their
 * own password: an image or PDF is shown, any other document is offered as a
 * download. Closing it revokes the file's address, locking it again.
 */
export default function PatientFileViewer({ patientId, file, onClose }: {
  patientId: string;
  file: PatientFile;
  onClose: () => void;
}) {
  const [password, setPassword] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [verifying, setVerifying] = useState(false);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const verifyAndView = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!password) return;
    setVerifying(true);
    setError("");
    try {
      const response = await fetch(
        `/api/users/${encodeURIComponent(patientId)}/attachments/${file.id}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password }),
        },
      );
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || "Unable to open this file.");
        return;
      }
      setPreviewUrl(URL.createObjectURL(await response.blob()));
      setPassword("");
    } catch {
      setError("Unable to open this file. Please try again.");
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" role="presentation">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="patient-file-dialog-title"
        className="w-full max-w-3xl rounded-xl bg-white p-5 shadow-2xl sm:p-6"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id="patient-file-dialog-title" className="text-lg font-semibold text-gray-900">
              Confidential patient file
            </h2>
            <p className="mt-1 truncate text-sm text-gray-500">{file.fileName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
          >
            Close
          </button>
        </div>
        {previewUrl ? (
          <div className="space-y-4">
            {isPatientImageMimeType(file.mimeType) ? (
              <Image
                src={previewUrl}
                alt={file.fileName}
                width={1200}
                height={900}
                unoptimized
                className="mx-auto max-h-[70vh] w-auto max-w-full rounded-lg object-contain"
              />
            ) : file.mimeType === "application/pdf" ? (
              <iframe
                src={previewUrl}
                title={file.fileName}
                className="h-[70vh] w-full rounded-lg border border-gray-200"
              />
            ) : (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-6 text-center">
                <p className="mb-4 text-sm text-gray-700">This document is ready to download.</p>
                <a
                  href={previewUrl}
                  download={file.fileName}
                  className="inline-flex rounded-lg bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800"
                >
                  Download file
                </a>
              </div>
            )}
            <p className="text-center text-xs text-gray-500">Close this window to lock the file again.</p>
          </div>
        ) : (
          <form onSubmit={verifyAndView} className="space-y-4">
            <p className="text-sm text-gray-600">
              Enter your account password to open this file.
            </p>
            <label className="block text-sm font-medium text-gray-700" htmlFor="patient-file-password">
              Password
              <input
                id="patient-file-password"
                type="password"
                autoComplete="current-password"
                autoFocus
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-200"
              />
            </label>
            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={verifying || !password}
                className="rounded-lg bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800 disabled:cursor-wait disabled:opacity-60"
              >
                {verifying ? "Verifying…" : "Verify & View"}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
