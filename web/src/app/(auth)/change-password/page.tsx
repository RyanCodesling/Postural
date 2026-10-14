"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import AuthFrame, { AUTH_INPUT_WITH_TOGGLE, AUTH_LABEL, AUTH_BUTTON, AUTH_ERROR, AUTH_TOGGLE } from "../AuthFrame";

export default function ChangePasswordPage() {
  const router = useRouter();
  const { user } = useAuth();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (newPassword === currentPassword) {
      setError("New password must be different from your current password.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }

    if (!user) {
      setError("You must be logged in to change your password.");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          currentPassword,
          newPassword,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to change password.");
      }

      // Redirect based on role
      const id: string = user.id;
      if (id.startsWith("admin_")) {
        router.push("/dashboard/admin");
      } else if (id.startsWith("therapist_")) {
        router.push("/dashboard/therapist");
      } else {
        router.push("/dashboard/patient");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change password.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthFrame>
        <form onSubmit={handleChangePassword} className="flex w-full flex-col gap-5">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Change your password</h2>
            <p className="text-sm text-gray-600">Welcome! Please change your default password to continue.</p>
          </div>

          {/* Current Password */}
          <div className="relative">
            <input
              type={showCurrentPassword ? "text" : "password"}
              id="currentPassword"
              placeholder=" "
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className={AUTH_INPUT_WITH_TOGGLE}
              required
            />
            <label
              htmlFor="currentPassword"
              className={AUTH_LABEL}
            >
              Current Password
            </label>
            <button
              type="button"
              onClick={() => setShowCurrentPassword(!showCurrentPassword)}
              className={AUTH_TOGGLE}
            >
              {showCurrentPassword ? "👁️" : "👁️‍🗨️"}
            </button>
          </div>

          {/* New Password */}
          <div className="relative">
            <input
              type={showNewPassword ? "text" : "password"}
              id="newPassword"
              placeholder=" "
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className={AUTH_INPUT_WITH_TOGGLE}
              required
            />
            <label
              htmlFor="newPassword"
              className={AUTH_LABEL}
            >
              New Password
            </label>
            <button
              type="button"
              onClick={() => setShowNewPassword(!showNewPassword)}
              className={AUTH_TOGGLE}
            >
              {showNewPassword ? "👁️" : "👁️‍🗨️"}
            </button>
          </div>

          {/* Confirm New Password */}
          <div className="relative">
            <input
              type={showConfirmPassword ? "text" : "password"}
              id="confirmPassword"
              placeholder=" "
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={AUTH_INPUT_WITH_TOGGLE}
              required
            />
            <label
              htmlFor="confirmPassword"
              className={AUTH_LABEL}
            >
              Confirm New Password
            </label>
            <button
              type="button"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              className={AUTH_TOGGLE}
            >
              {showConfirmPassword ? "👁️" : "👁️‍🗨️"}
            </button>
          </div>

          {error && (
            <p className={AUTH_ERROR}>{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className={AUTH_BUTTON}
          >
            {loading ? "Changing..." : "Change Password"}
          </button>
        </form>

    </AuthFrame>
  );
}
