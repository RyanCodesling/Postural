"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { loginUser } from "@/lib/auth";
import { useAuth } from "@/lib/AuthContext";
import AuthFrame, { AUTH_INPUT_WITH_TOGGLE, AUTH_INPUT, AUTH_LABEL } from "../AuthFrame";

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
  // Log In works only once the page's script is running; a press before that
  // would reload the page and empty the form.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

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
    <AuthFrame>
    <form onSubmit={handleLogin} method="post" className="flex w-full flex-col gap-5">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Welcome back</h2>
        <p className="text-sm text-gray-600">Log in to access your dashboard</p>
      </div>

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
        <label htmlFor="email" className={AUTH_LABEL}>Email</label>
      </div>

      <div className="relative">
        <input
          type={showPassword ? "text" : "password"}
          id="password"
          placeholder=" "
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={AUTH_INPUT_WITH_TOGGLE}
          required
        />
        <label htmlFor="password" className={AUTH_LABEL}>Password</label>
        <button
          type="button"
          onClick={() => setShowPassword(!showPassword)}
          aria-label={showPassword ? "Hide password" : "Show password"}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 transition-colors hover:text-green-700"
        >
          {showPassword ? "👁️" : "👁️‍🗨️"}
        </button>
      </div>

      <div className="-mt-2 text-right">
        <button
          type="button"
          onClick={() => router.push("/forgot-password")}
          className="text-sm text-green-700 underline underline-offset-2 transition-colors hover:text-green-900"
        >
          Forgot Password?
        </button>
      </div>

      {successMsg && (
        <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-left text-sm text-green-800">{successMsg}</p>
      )}

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-left text-sm text-red-700">{error}</p>
      )}

      <button
        type="submit"
        disabled={loading || !ready}
        className="w-full rounded-lg bg-green-600 py-3 text-base font-semibold tracking-wide text-white transition-colors hover:bg-green-700 disabled:bg-green-300"
      >
        {loading ? "Logging in..." : "Log In"}
      </button>
    </form>

    <button
      onClick={() => router.push("/")}
      className="self-start text-sm font-medium text-green-700 transition-colors hover:text-green-900"
    >
      ‹ Back
    </button>
    </AuthFrame>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}
