"use client";

/**
 * A full-screen "please wait" message for actions that take a few seconds,
 * such as opening another page or building a PDF, so the person knows the
 * tap was received and does not press again.
 */
export default function PleaseWait({ message }: { message: string }) {
  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4 print:hidden"
      style={{ colorScheme: "light" }}
    >
      <div
        role="alertdialog"
        aria-live="assertive"
        aria-busy="true"
        aria-label={message}
        className="flex w-full max-w-xs flex-col items-center gap-4 rounded-2xl bg-white px-6 py-7 text-center shadow-2xl"
      >
        <span
          aria-hidden
          className="h-10 w-10 animate-spin rounded-full border-4 border-green-100 border-t-green-600 motion-reduce:animate-none"
        />
        <div>
          <p className="text-lg font-semibold text-gray-900">{message}</p>
          <p className="mt-1 text-sm text-gray-600">Please wait, this can take a few seconds.</p>
        </div>
      </div>
    </div>
  );
}
