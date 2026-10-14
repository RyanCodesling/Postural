"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AuthFrame, { AUTH_INPUT, AUTH_LABEL, AUTH_BUTTON, AUTH_ERROR, AUTH_LINK } from "../AuthFrame";

export default function FirstTimePasswordPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const router = useRouter();

  function handleSubmit(e: React.FormEvent) {
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
  }

  return (
    <AuthFrame>
      {!success ? (
        <form onSubmit={handleSubmit} className="flex w-full flex-col gap-5">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Set a new password</h2>
            <p className="text-sm text-gray-600">
              As this is your first login, please set a new password for your account.
            </p>
          </div>

          <div className="relative">
            <input
              type="password"
              id="password"
              placeholder=" "
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={AUTH_INPUT}
            />
            <label htmlFor="password" className={AUTH_LABEL}>New password</label>
          </div>

          <div className="relative">
            <input
              type="password"
              id="confirm"
              placeholder=" "
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={AUTH_INPUT}
            />
            <label htmlFor="confirm" className={AUTH_LABEL}>Confirm password</label>
          </div>

          {error && <p className={AUTH_ERROR}>{error}</p>}

          <button type="submit" className={AUTH_BUTTON}>
            Save password
          </button>
          <button
            type="button"
            onClick={() => router.push("/login")}
            className={`${AUTH_LINK} self-start`}
          >
            ‹ Cancel
          </button>
        </form>
      ) : (
        <div className="flex flex-col gap-5">
          <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
            Password updated successfully.
          </p>
          <Link href="/login" className={`${AUTH_BUTTON} block text-center`}>
            Go to Login
          </Link>
        </div>
      )}
    </AuthFrame>
  );
}
