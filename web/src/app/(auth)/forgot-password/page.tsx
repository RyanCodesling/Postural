"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import AuthFrame, { AUTH_INPUT_WITH_TOGGLE, AUTH_INPUT, AUTH_LABEL, AUTH_BUTTON, AUTH_ERROR, AUTH_TOGGLE, AUTH_LINK } from "../AuthFrame";

export default function ForgotPasswordPage() {
  const router = useRouter();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState<string[]>(["", "", "", "", "", ""]);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(300); // 5 minutes in seconds
  const [resetToken, setResetToken] = useState("");

  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Countdown timer for OTP
  useEffect(() => {
    if (step !== 2) return;
    if (countdown <= 0) return;

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [step, countdown]);

  const formatCountdown = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  // Step 1: Send OTP
  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to send OTP.");
      }

      setCountdown(300);
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send OTP.");
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Verify OTP
  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const otpValue = otp.join("");
    if (otpValue.length !== 6) {
      setError("Please enter all 6 digits.");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, otp: otpValue }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Invalid or expired OTP.");
      }

      setResetToken(data.resetToken);
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid or expired OTP.");
    } finally {
      setLoading(false);
    }
  };

  // Step 3: Reset Password
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
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

      if (!res.ok) {
        throw new Error(data.error || "Failed to reset password.");
      }

      router.push("/login?reset=success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset password.");
    } finally {
      setLoading(false);
    }
  };

  // Resend OTP
  const handleResendOtp = useCallback(async () => {
    if (countdown > 0) return;
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to resend OTP.");
      }

      setOtp(["", "", "", "", "", ""]);
      setCountdown(300);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resend OTP.");
    } finally {
      setLoading(false);
    }
  }, [countdown, email]);

  // OTP input handlers
  const handleOtpChange = (index: number, value: string) => {
    if (value.length > 1) {
      // Handle paste
      const digits = value.replace(/\D/g, "").slice(0, 6);
      if (digits.length > 0) {
        const newOtp = [...otp];
        for (let i = 0; i < 6; i++) {
          newOtp[i] = digits[i] || "";
        }
        setOtp(newOtp);
        const focusIndex = Math.min(digits.length, 5);
        otpRefs.current[focusIndex]?.focus();
        return;
      }
    }

    const digit = value.replace(/\D/g, "").slice(-1);
    const newOtp = [...otp];
    newOtp[index] = digit;
    setOtp(newOtp);

    if (digit && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  const handleOtpPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (pastedData.length > 0) {
      const newOtp = [...otp];
      for (let i = 0; i < 6; i++) {
        newOtp[i] = pastedData[i] || "";
      }
      setOtp(newOtp);
      const focusIndex = Math.min(pastedData.length, 5);
      otpRefs.current[focusIndex]?.focus();
    }
  };

  // Step indicator component
  const StepIndicator = () => (
    <div className="flex items-center justify-center gap-0 w-full mb-2">
      {[1, 2, 3].map((s, i) => (
        <div key={s} className="flex items-center">
          <div
            className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-colors ${
              s < step
                ? "bg-green-500 border-green-500 text-white"
                : s === step
                ? "bg-green-600 border-green-400 text-white"
                : "bg-white border-green-200 text-green-300"
            }`}
          >
            {s < step ? "✓" : s}
          </div>
          {i < 2 && (
            <div
              className={`w-12 h-0.5 transition-colors ${
                s < step ? "bg-green-500" : "bg-green-100"
              }`}
            />
          )}
        </div>
      ))}
    </div>
  );

  return (
    <AuthFrame>
        <StepIndicator />

        {/* Step 1: Enter Email */}
        {step === 1 && (
          <form onSubmit={handleSendOtp} className="flex w-full flex-col gap-5">
            <p className="text-2xl font-bold text-gray-900 text-left">Forgot your password?</p>
            <p className="text-sm text-gray-600 text-left -mt-3">
              Enter your email address and we&apos;ll send you a verification code.
            </p>

            <div className="relative">
              <input
                type="email"
                id="email"
                placeholder=" "
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={AUTH_INPUT}
                required
              />
              <label
                htmlFor="email"
                className={AUTH_LABEL}
              >
                Email
              </label>
            </div>

            {error && (
              <p className={AUTH_ERROR}>{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className={AUTH_BUTTON}
            >
              {loading ? "Sending..." : "Send OTP"}
            </button>
          </form>
        )}

        {/* Step 2: Enter OTP */}
        {step === 2 && (
          <form onSubmit={handleVerifyOtp} className="flex w-full flex-col gap-5">
            <p className="text-2xl font-bold text-gray-900 text-left">Verify your identity</p>
            <p className="text-sm text-gray-600 text-left -mt-3">
              We&apos;ve sent a 6-digit code to <span className="font-medium text-gray-900">{email}</span>
            </p>

            <div className="flex justify-center gap-2.5">
              {otp.map((digit, index) => (
                <input
                  key={index}
                  ref={(el) => { otpRefs.current[index] = el; }}
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={digit}
                  onChange={(e) => handleOtpChange(index, e.target.value)}
                  onKeyDown={(e) => handleOtpKeyDown(index, e)}
                  onPaste={handleOtpPaste}
                  className="h-14 w-12 rounded-lg border border-green-200 bg-white text-center text-2xl font-bold text-gray-900 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-200"
                  autoFocus={index === 0}
                />
              ))}
            </div>

            <div className="flex items-center justify-between text-sm">
              <span className={`${countdown > 0 ? "text-gray-600" : "text-red-600"}`}>
                {countdown > 0
                  ? `Code expires in ${formatCountdown(countdown)}`
                  : "Code expired"}
              </span>
              <button
                type="button"
                onClick={handleResendOtp}
                disabled={countdown > 0 || loading}
                className={`underline underline-offset-2 transition-colors ${
                  countdown > 0
                    ? "text-gray-300 cursor-not-allowed"
                    : "text-green-700 hover:text-green-900"
                }`}
              >
                Resend OTP
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
              {loading ? "Verifying..." : "Verify OTP"}
            </button>
          </form>
        )}

        {/* Step 3: New Password */}
        {step === 3 && (
          <form onSubmit={handleResetPassword} className="flex w-full flex-col gap-5">
            <p className="text-2xl font-bold text-gray-900 text-left">Set new password</p>
            <p className="text-sm text-gray-600 text-left -mt-3">
              Enter your new password below.
            </p>

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
                Confirm Password
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
              {loading ? "Resetting..." : "Reset Password"}
            </button>
          </form>
        )}

        {/* Back to login link */}
        <button
          onClick={() => router.push("/login")}
          className={`${AUTH_LINK} self-start`}
        >
          ‹ Back to Login
        </button>

    </AuthFrame>
  );
}
