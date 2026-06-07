"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useAuth } from "@/lib/AuthContext";
import bgImage from "../../../../media/acc_bacoor_landing_page.png";

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
    <main className="relative min-h-screen flex items-center justify-end pr-56 overflow-hidden">

      {/* Background image */}
      <Image
        src={bgImage}
        alt=""
        fill
        unoptimized
        className="object-cover object-center"
        priority
      />

      {/* Card */}
      <div className="dark-autofill relative z-10 flex flex-col items-center gap-9 px-14 py-16 rounded-3xl bg-green-800/55 backdrop-blur-sm border border-green-700/50 shadow-2xl text-center max-w-md w-11/12">

        <div className="space-y-2 w-full">
          <h1 className="text-3xl font-bold text-white tracking-tight">ACC Bacoor</h1>
          <p className="text-base font-medium text-white">Postural Monitoring System</p>
        </div>

        <form onSubmit={handleChangePassword} className="w-full flex flex-col gap-5">
          <p className="text-sm text-white/80 text-left">
            Welcome! Please change your default password to continue.
          </p>

          {/* Current Password */}
          <div className="relative">
            <input
              type={showCurrentPassword ? "text" : "password"}
              id="currentPassword"
              placeholder=" "
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="peer w-full bg-white/10 border border-green-600/50 text-white rounded-xl px-4 pt-6 pb-2 pr-11 text-base focus:outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent"
              required
            />
            <label
              htmlFor="currentPassword"
              className="absolute left-4 top-3 text-xs text-white/80 transition-all duration-200 pointer-events-none peer-placeholder-shown:top-1/2 peer-placeholder-shown:-translate-y-1/2 peer-placeholder-shown:text-base peer-placeholder-shown:text-white/50 peer-focus:top-3 peer-focus:translate-y-0 peer-focus:text-xs peer-focus:text-white/80"
            >
              Current Password
            </label>
            <button
              type="button"
              onClick={() => setShowCurrentPassword(!showCurrentPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-white/70 hover:text-white transition-colors"
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
              className="peer w-full bg-white/10 border border-green-600/50 text-white rounded-xl px-4 pt-6 pb-2 pr-11 text-base focus:outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent"
              required
            />
            <label
              htmlFor="newPassword"
              className="absolute left-4 top-3 text-xs text-white/80 transition-all duration-200 pointer-events-none peer-placeholder-shown:top-1/2 peer-placeholder-shown:-translate-y-1/2 peer-placeholder-shown:text-base peer-placeholder-shown:text-white/50 peer-focus:top-3 peer-focus:translate-y-0 peer-focus:text-xs peer-focus:text-white/80"
            >
              New Password
            </label>
            <button
              type="button"
              onClick={() => setShowNewPassword(!showNewPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-white/70 hover:text-white transition-colors"
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
              className="peer w-full bg-white/10 border border-green-600/50 text-white rounded-xl px-4 pt-6 pb-2 pr-11 text-base focus:outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent"
              required
            />
            <label
              htmlFor="confirmPassword"
              className="absolute left-4 top-3 text-xs text-white/80 transition-all duration-200 pointer-events-none peer-placeholder-shown:top-1/2 peer-placeholder-shown:-translate-y-1/2 peer-placeholder-shown:text-base peer-placeholder-shown:text-white/50 peer-focus:top-3 peer-focus:translate-y-0 peer-focus:text-xs peer-focus:text-white/80"
            >
              Confirm New Password
            </label>
            <button
              type="button"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-white/70 hover:text-white transition-colors"
            >
              {showConfirmPassword ? "👁️" : "👁️‍🗨️"}
            </button>
          </div>

          {error && (
            <p className="text-sm text-left px-3 py-2 rounded-lg bg-red-500/20 border border-red-400/40 text-red-200">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 rounded-xl bg-green-600 hover:bg-green-500 disabled:bg-green-800 disabled:opacity-60 text-white font-semibold shadow-lg transition-colors text-base tracking-wide"
          >
            {loading ? "Changing..." : "Change Password"}
          </button>
        </form>

      </div>
    </main>
  );
}
