"use client";

import { useState, useEffect, useRef } from "react";

interface ChangePasswordModalProps {
  email: string;
  onClose: () => void;
}

type Step = 1 | 2 | 3;

export default function ChangePasswordModal({ email, onClose }: ChangePasswordModalProps) {
  const [step, setStep] = useState<Step>(1);
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [resetToken, setResetToken] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);

  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setInterval(() => setCountdown((c) => c - 1), 1000);
    return () => clearInterval(t);
  }, [countdown]);

  // Step 1: Send OTP
  const handleSendOTP = async () => {
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send OTP");
      setStep(2);
      setCountdown(300);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send OTP");
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Verify OTP
  const handleVerifyOTP = async () => {
    setError("");
    const code = otp.join("");
    if (code.length !== 6) {
      setError("Please enter the 6-digit code.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, otp: code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Invalid or expired OTP");
      setResetToken(data.resetToken);
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setLoading(false);
    }
  };

  // Step 3: Reset password
  const handleResetPassword = async () => {
    setError("");
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, newPassword, resetToken }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to reset password");
      setSuccess("Password changed successfully!");
      setTimeout(() => onClose(), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setLoading(false);
    }
  };

  // OTP handlers
  const handleOtpChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const next = [...otp];
    next[index] = value.slice(-1);
    setOtp(next);
    if (value && index < 5) otpRefs.current[index + 1]?.focus();
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  const handleOtpPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (text.length === 6) {
      setOtp(text.split(""));
      otpRefs.current[5]?.focus();
    }
  };

  const handleResendOTP = async () => {
    setError("");
    setLoading(true);
    try {
      await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setCountdown(300);
      setOtp(["", "", "", "", "", ""]);
    } catch {
      setError("Failed to resend OTP.");
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (s: number) =>
    `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Frosted glass card */}
      <div className="relative z-10 flex flex-col items-center gap-6 px-10 py-10 rounded-2xl bg-white shadow-xl text-center max-w-md w-11/12">
        {/* Header */}
        <div className="space-y-1 w-full">
          <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Change Password</h2>
          <p className="text-sm text-gray-600">Verify your identity to set a new password</p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-0">
          {[1, 2, 3].map((s, i) => (
            <div key={s} className="flex items-center">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition ${
                  step > s
                    ? "bg-green-500 text-white"
                    : step === s
                    ? "bg-green-600 text-white"
                    : "bg-green-50 text-green-700"
                }`}
              >
                {step > s ? (
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                ) : (
                  s
                )}
              </div>
              {i < 2 && (
                <div
                  className={`w-12 h-0.5 ${
                    step > s ? "bg-green-500" : "bg-green-100"
                  }`}
                />
              )}
            </div>
          ))}
        </div>

        {/* Success message */}
        {success && (
          <p className="w-full text-sm px-3 py-2 rounded-lg bg-green-50 border border-green-200 text-green-800">
            {success}
          </p>
        )}

        {/* Error message */}
        {error && (
          <p className="w-full text-sm px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700">
            {error}
          </p>
        )}

        {/* Step 1: Email confirmation */}
        {step === 1 && !success && (
          <div className="w-full flex flex-col gap-4">
            <div className="text-left">
              <label className="block text-xs text-gray-700 mb-1">Email Address</label>
              <input
                type="email"
                value={email}
                readOnly
                className="w-full bg-white border border-green-200 text-gray-900 rounded-xl px-4 py-2.5 text-sm cursor-not-allowed opacity-80"
              />
              <p className="text-xs text-gray-500 mt-1">
                An OTP will be sent to verify your identity.
              </p>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-2.5 rounded-xl border border-green-200 text-green-800 text-sm font-medium hover:bg-green-50 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSendOTP}
                disabled={loading}
                className="flex-1 py-2.5 rounded-xl bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white text-sm font-semibold shadow-lg transition"
              >
                {loading ? "Sending..." : "Send OTP"}
              </button>
            </div>
          </div>
        )}

        {/* Step 2: OTP */}
        {step === 2 && !success && (
          <div className="w-full flex flex-col gap-4">
            <p className="text-sm text-gray-700 text-left">
              We&apos;ve sent a 6-digit code to <strong className="text-gray-900">{email}</strong>
            </p>

            <div className="flex justify-center gap-2" onPaste={handleOtpPaste}>
              {otp.map((digit, i) => (
                <input
                  key={i}
                  ref={(el) => { otpRefs.current[i] = el; }}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleOtpChange(i, e.target.value)}
                  onKeyDown={(e) => handleOtpKeyDown(i, e)}
                  className="w-11 h-13 text-center text-xl font-bold bg-white border border-green-200 text-gray-900 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent transition"
                />
              ))}
            </div>

            <div className="text-center text-sm">
              {countdown > 0 ? (
                <span className="text-gray-600">
                  Code expires in{" "}
                  <span className="font-semibold text-green-700">{formatTime(countdown)}</span>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={handleResendOTP}
                  disabled={loading}
                  className="text-green-700 hover:text-green-900 font-medium underline underline-offset-2 transition"
                >
                  Resend OTP
                </button>
              )}
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-2.5 rounded-xl border border-green-200 text-green-800 text-sm font-medium hover:bg-green-50 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleVerifyOTP}
                disabled={loading}
                className="flex-1 py-2.5 rounded-xl bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white text-sm font-semibold shadow-lg transition"
              >
                {loading ? "Verifying..." : "Verify OTP"}
              </button>
            </div>
          </div>
        )}

        {/* Step 3: New Password */}
        {step === 3 && !success && (
          <div className="w-full flex flex-col gap-4">
            <div className="relative text-left">
              <label className="block text-xs text-gray-700 mb-1">New Password</label>
              <input
                type={showNewPassword ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full bg-white border border-green-200 text-gray-900 rounded-xl px-4 py-2.5 pr-11 text-sm focus:outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent"
                required
              />
              <button
                type="button"
                onClick={() => setShowNewPassword(!showNewPassword)}
                className="absolute right-3 top-7 text-gray-500 hover:text-green-700 transition"
              >
                {showNewPassword ? "👁️" : "👁️‍🗨️"}
              </button>
            </div>

            <div className="relative text-left">
              <label className="block text-xs text-gray-700 mb-1">Confirm Password</label>
              <input
                type={showConfirmPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full bg-white border border-green-200 text-gray-900 rounded-xl px-4 py-2.5 pr-11 text-sm focus:outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent"
                required
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-3 top-7 text-gray-500 hover:text-green-700 transition"
              >
                {showConfirmPassword ? "👁️" : "👁️‍🗨️"}
              </button>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-2.5 rounded-xl border border-green-200 text-green-800 text-sm font-medium hover:bg-green-50 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleResetPassword}
                disabled={loading}
                className="flex-1 py-2.5 rounded-xl bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white text-sm font-semibold shadow-lg transition"
              >
                {loading ? "Resetting..." : "Change Password"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
