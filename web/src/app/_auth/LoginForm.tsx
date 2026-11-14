"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { loginUser } from "@/lib/auth";
import { useAuth } from "@/lib/AuthContext";
import { AUTH_BUTTON, AUTH_ERROR, AUTH_INPUT, AUTH_INPUT_WITH_TOGGLE, AUTH_LABEL, AUTH_TOGGLE } from "../(auth)/AuthFrame";

/**
 * The log in form, shown in the landing page's hero in place of the video.
 * `resetSuccess` shows the note left by a finished password reset.
 */
export default function LoginForm({ resetSuccess, onForgot }: {
  resetSuccess: boolean;
  onForgot: () => void;
}) {
  const router = useRouter();
  const { login } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // Log In works only once the page's script is running; a press before that
  // would reload the page and empty the form.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const result = await loginUser(email, password);
      login(result.user);

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
    <form onSubmit={handleLogin} method="post" className="flex w-full flex-col gap-5">
      <div>
        <h2 id="hero-auth-title" className="text-2xl font-bold text-gray-900">Welcome!</h2>
        <p className="text-sm text-gray-600">Log in to access your dashboard</p>
      </div>

      <div className="relative">
        <input
          type="email"
          id="email"
          autoComplete="email"
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
          autoComplete="current-password"
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
          className={AUTH_TOGGLE}
        >
          {showPassword ? "👁️" : "👁️‍🗨️"}
        </button>
      </div>

      <div className="-mt-2 text-right">
        <button
          type="button"
          onClick={onForgot}
          className="text-sm text-green-700 underline underline-offset-2 transition-colors hover:text-green-900"
        >
          Forgot Password?
        </button>
      </div>

      {resetSuccess && (
        <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-left text-sm text-green-800">
          Password reset successful! Please log in with your new password.
        </p>
      )}

      {error && <p className={AUTH_ERROR}>{error}</p>}

      <button type="submit" disabled={loading || !ready} className={AUTH_BUTTON}>
        {loading ? "Logging in..." : "Log In"}
      </button>
    </form>
  );
}
