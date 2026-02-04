"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function FirstTimePasswordPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const router = useRouter();

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!password) {
      setError("Please enter a new password.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setError("");
    setSuccess(true);
  }, [password, confirm]);

  const handleCancel = useCallback(() => {
    router.push('/login?role=patient');
  }, [router]);

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="w-full max-w-md bg-white p-6 rounded shadow">
        <h2 className="text-xl font-semibold mb-4">Set a new password</h2>

        {!success ? (
          <form onSubmit={handleSubmit}>
            <p className="text-sm text-gray-600 mb-4">
              As this is your first login, please set a new password for your
              account.
            </p>

            <label className="block text-sm mb-1">New password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border p-2 mb-3 rounded"
            />

            <label className="block text-sm mb-1">Confirm password</label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full border p-2 mb-3 rounded"
            />

            {error && <div className="text-red-600 mb-3">{error}</div>}

            <div className="flex gap-3">
              <button
                type="submit"
                className="flex-1 bg-black text-white py-2 rounded"
              >
                Save password
              </button>
              <button
                type="button"
                onClick={handleCancel}
                className="flex-1 border py-2 rounded"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="text-center">
            <p className="mb-4 text-green-600">Password updated successfully.</p>
            <div className="flex gap-3 justify-center">
              <Link
                href="/login?role=patient"
                className="px-4 py-2 bg-black text-white rounded"
              >
                Go to Login
              </Link>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
