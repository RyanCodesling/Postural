"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { AUTH_INPUT_WITH_TOGGLE, AUTH_INPUT, AUTH_LABEL, AUTH_BUTTON, AUTH_ERROR, AUTH_TOGGLE } from "../(auth)/AuthFrame";

/**
 * The three-step password reset (email, code, new password), shown in the
 * landing page's hero in place of the video. `onDone` runs after the new
 * password is saved.
 */
export default function ForgotPasswordForm({ onDone }: { onDone: () => void }) {
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

      onDone();
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

  // Title and subtitle laid out the same as the log in form's, with a slim
  // progress bar for the three steps.
  const Header = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div>
      <div className="mb-4 flex items-center gap-3" aria-label={`Step ${step} of 3`}>
        <div className="grid flex-1 grid-cols-3 gap-1.5" aria-hidden>
          {[1, 2, 3].map((s) => (
            <span key={s} className={`h-1.5 rounded-full transition-colors ${s <= step ? "bg-green-600" : "bg-green-100"}`} />
          ))}
        </div>
        <span className="shrink-0 text-xs font-medium text-gray-500">Step {step} of 3</span>
      </div>
      <h2 id="hero-auth-title" className="text-2xl font-bold text-gray-900">{title}</h2>
      <p className="text-sm text-gray-600">{children}</p>
    </div>
  );

  return (
    <div className="flex w-full flex-col gap-5">
        {/* Step 1: Enter Email */}
        {step === 1 && (
          <form onSubmit={handleSendOtp} className="flex w-full flex-col gap-5">
            <Header title="Forgot your password?">
              Enter your email and we&apos;ll send you a verification code.
            </Header>

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
            <Header title="Verify your identity">
              We&apos;ve sent a 6-digit code to <span className="font-medium text-gray-900">{email}</span>
            </Header>

            <div className="flex justify-center gap-2">
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
                  aria-label={`Digit ${index + 1} of 6`}
                  className="h-14 w-full min-w-0 max-w-12 flex-1 rounded-lg border border-green-200 bg-white text-center text-2xl font-bold text-gray-900 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-200"
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
            <Header title="Set new password">
              Enter your new password below.
            </Header>

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
                aria-label={showNewPassword ? "Hide password" : "Show password"}
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
                aria-label={showConfirmPassword ? "Hide password" : "Show password"}
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
    </div>
  );
}
