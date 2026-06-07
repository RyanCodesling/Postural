"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { loginUser } from "@/lib/auth";
import { useAuth } from "@/lib/AuthContext";
import bgImage from "../../../../media/acc_bacoor_landing_page.png";

function LoginContent() {
  const router = useRouter();
  const { login } = useAuth();

  const searchParams = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");

  useEffect(() => {
    if (searchParams.get("reset") === "success") {
      setSuccessMsg("Password reset successful! Please log in with your new password.");
    }
  }, [searchParams]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const result = await loginUser(email, password);
      login(result.user);

      // Check if user must change password
      if (result.mustChangePassword) {
        router.push("/change-password");
        return;
      }

      const id: string = result.user.id;
      if (id.startsWith("admin_")) {
        router.push("/dashboard/admin");
      } else if (id.startsWith("therapist_")) {
        router.push("/dashboard/therapist");
      } else {
        router.push("/dashboard/patient");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
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

        <form onSubmit={handleLogin} className="w-full flex flex-col gap-5">
          <p className="text-lg font-semibold text-white text-left">Log In to access your dashboard</p>
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

          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              id="password"
              placeholder=" "
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="peer w-full bg-white/10 border border-green-600/50 text-white rounded-xl px-4 pt-6 pb-2 pr-11 text-base focus:outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent"
              required
            />
            <label
              htmlFor="password"
              className="absolute left-4 top-3 text-xs text-white/80 transition-all duration-200 pointer-events-none peer-placeholder-shown:top-1/2 peer-placeholder-shown:-translate-y-1/2 peer-placeholder-shown:text-base peer-placeholder-shown:text-white/50 peer-focus:top-3 peer-focus:translate-y-0 peer-focus:text-xs peer-focus:text-white/80"
            >
              Password
            </label>
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-white/70 hover:text-white transition-colors"
            >
              {showPassword ? "👁️" : "👁️‍🗨️"}
            </button>
          </div>

          <div className="text-right -mt-2">
            <button
              type="button"
              onClick={() => router.push("/forgot-password")}
              className="text-sm text-green-300 hover:text-white transition-colors underline underline-offset-2"
            >
              Forgot Password?
            </button>
          </div>

          {successMsg && (
            <p className="text-sm text-left px-3 py-2 rounded-lg bg-green-500/20 border border-green-400/40 text-green-200">{successMsg}</p>
          )}

          {error && (
            <p className="text-sm text-left px-3 py-2 rounded-lg bg-red-500/20 border border-red-400/40 text-red-200">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 rounded-xl bg-green-600 hover:bg-green-500 disabled:bg-green-800 disabled:opacity-60 text-white font-semibold shadow-lg transition-colors text-base tracking-wide"
          >
            {loading ? "Logging in..." : "Log In"}
          </button>
        </form>

        <button
          onClick={() => router.push("/")}
          className="px-4 py-1.5 rounded-lg bg-black/70 hover:bg-black text-white text-sm font-medium transition-colors"
        >
          Back
        </button>

      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}
