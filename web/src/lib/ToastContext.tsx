"use client";

import React, { createContext, useCallback, useContext, useRef, useState } from "react";

type ToastVariant = "success" | "error" | "info";

interface Toast {
  id: number;
  message: string;
  variant: ToastVariant;
}

interface ToastContextType {
  showToast: (toast: { message: string; variant?: ToastVariant }) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

// Auto-dismiss delay for a toast (ms).
const TOAST_TTL_MS = 3500;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextIdRef = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    ({ message, variant = "info" }: { message: string; variant?: ToastVariant }) => {
      const id = nextIdRef.current++;
      setToasts((prev) => [...prev, { id, message, variant }]);
      // Auto-dismiss; the manual close button removes it earlier if pressed.
      setTimeout(() => dismiss(id), TOAST_TTL_MS);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {/* Toast stack — fixed, non-blocking, above modals (z-[60]). */}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onClose={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const palette =
    toast.variant === "success"
      ? "bg-green-700 text-white"
      : toast.variant === "error"
        ? "bg-red-600 text-white"
        : "bg-gray-800 text-white";
  return (
    <div
      role="status"
      className={`animate-toast-in pointer-events-auto flex items-center gap-3 rounded-xl px-4 py-3 shadow-lg max-w-md ${palette}`}
    >
      <span className="shrink-0">
        {toast.variant === "error" ? <XCircleIcon /> : <CheckCircleIcon />}
      </span>
      <span className="text-sm font-medium">{toast.message}</span>
      <button
        onClick={onClose}
        aria-label="Dismiss"
        className="ml-1 shrink-0 text-white/70 hover:text-white transition"
      >
        ✕
      </button>
    </div>
  );
}

function CheckCircleIcon() {
  return (
    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function XCircleIcon() {
  return (
    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (context === undefined) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return context;
}
