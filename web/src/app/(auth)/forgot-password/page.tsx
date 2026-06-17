"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import bgImage from "../../../../media/acc_bacoor_landing_page.png";

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
                : "bg-transparent border-white/30 text-white/40"
            }`}
          >
            {s < step ? "✓" : s}
          </div>
          {i < 2 && (
            <div
              className={`w-12 h-0.5 transition-colors ${
                s < step ? "bg-green-500" : "bg-white/20"
              }`}
            />
          )}
        </div>
      ))}
    </div>
  );

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
      <div className="dark-autofill relative z-10 flex flex-col items-center gap-9 px-14 py-16 rounded-3xl bg-green-800/55 backdrop-blur-sm border border-green-700/50 shadow-2xl text-center max-w-lg w-11/12">

        <div className="space-y-2 w-full">
          <h1 className="text-3xl font-bold text-white tracking-tight">ACC Bacoor</h1>
          <p className="text-base font-medium text-white">Postural Monitoring System</p>
        </div>

        <StepIndicator />

        {/* Step 1: Enter Email */}
        {step === 1 && (
          <form onSubmit={handleSendOtp} className="w-full flex flex-col gap-5">
            <p className="text-lg font-semibold text-white text-left">Forgot your password?</p>
            <p className="text-sm text-white/70 text-left -mt-3">
              Enter your email address and we&apos;ll send you a verification code.
            </p>

            <div className="relative">
              <input
                type="email"
                id="email"
                placeholder=" "
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="peer w-full bg-white/10 border border-green-600/50 text-white rounded-xl px-4 pt-6 pb-2 text-base focus:outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent"
                required
              />
              <label
                htmlFor="email"
                className="absolute left-4 top-3 text-xs text-white/80 transition-all duration-200 pointer-events-none peer-placeholder-shown:top-1/2 peer-placeholder-shown:-translate-y-1/2 peer-placeholder-shown:text-base peer-placeholder-shown:text-white/50 peer-focus:top-3 peer-focus:translate-y-0 peer-focus:text-xs peer-focus:text-white/80"
              >
                Email
              </label>
            </div>

            {error && (
              <p className="text-sm text-left px-3 py-2 rounded-lg bg-red-500/20 border border-red-400/40 text-red-200">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 rounded-xl bg-green-600 hover:bg-green-500 disabled:bg-green-800 disabled:opacity-60 text-white font-semibold shadow-lg transition-colors text-base tracking-wide"
            >
              {loading ? "Sending..." : "Send OTP"}
            </button>
          </form>
        )}

        {/* Step 2: Enter OTP */}
        {step === 2 && (
          <form onSubmit={handleVerifyOtp} className="w-full flex flex-col gap-5">
            <p className="text-lg font-semibold text-white text-left">Verify your identity</p>
            <p className="text-sm text-white/70 text-left -mt-3">
              We&apos;ve sent a 6-digit code to <span className="text-white font-medium">{email}</span>
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
                  className="w-12 h-14 text-center text-2xl font-bold bg-white/10 border border-green-600/50 text-white rounded-xl focus:outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent"
                  autoFocus={index === 0}
                />
              ))}
            </div>

            <div className="flex items-center justify-between text-sm">
              <span className={`${countdown > 0 ? "text-white/60" : "text-red-300"}`}>
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
                    ? "text-white/30 cursor-not-allowed"
                    : "text-green-300 hover:text-white"
                }`}
              >
                Resend OTP
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
              {loading ? "Verifying..." : "Verify OTP"}
            </button>
          </form>
        )}

        {/* Step 3: New Password */}
        {step === 3 && (
          <form onSubmit={handleResetPassword} className="w-full flex flex-col gap-5">
            <p className="text-lg font-semibold text-white text-left">Set new password</p>
            <p className="text-sm text-white/70 text-left -mt-3">
              Enter your new password below.
            </p>

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
                Confirm Password
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
              {loading ? "Resetting..." : "Reset Password"}
            </button>
          </form>
        )}

        {/* Back to login link */}
        <button
          onClick={() => router.push("/login")}
          className="text-sm text-green-300 hover:text-white transition-colors underline underline-offset-2"
        >
          Back to Login
        </button>

      </div>
    </main>
  );
}
