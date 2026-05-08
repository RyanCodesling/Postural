"use client";

import { useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { loginUser, setStoredUser } from "@/lib/auth";
import { useAuth } from "@/lib/AuthContext";

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setUser } = useAuth();
  const roleParam = (searchParams?.get("role") as string) || "patient";
  const role = roleParam.toLowerCase();
  const isTherapist = role === "therapist";
  const isAdmin = role === "admin";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const result = await loginUser(email, password, role);
      setStoredUser(result.user);
      setUser(result.user);
      if (isAdmin) {
        router.push("/dashboard/admin");
      } else if (isTherapist) {
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
    <main className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="w-full max-w-sm bg-white p-6 rounded shadow">
        <h2 className="text-xl font-semibold mb-4">
          Login — {isAdmin ? "Admin" : isTherapist ? "Therapist" : "Patient"}
        </h2>

        <p className="text-sm text-gray-500 mb-4">
          {isAdmin
            ? "Sign in to manage the system and content."
            : isTherapist
            ? "Sign in to manage your patients and sessions."
            : "Sign in to access your posture and movement data."}
        </p>

        {/* Temporary Credentials Display */}
        <div className="bg-blue-50 border border-blue-200 p-3 rounded mb-4 text-xs">
          <p className="font-semibold text-blue-900 mb-2">Demo Credentials:</p>
          {isAdmin ? (
            <>
              <p className="text-blue-800">Email: admin@postural.com</p>
              <p className="text-blue-800">Password: admin123</p>
            </>
          ) : isTherapist ? (
            <>
              <p className="text-blue-800">Email: therapist@clinic.com</p>
              <p className="text-blue-800">Password: therapist123</p>
            </>
          ) : (
            <>
              <p className="text-blue-800">Email: patient@example.com</p>
              <p className="text-blue-800">Password: patient123</p>
            </>
          )}
        </div>

        <form onSubmit={handleLogin}>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border p-2 mb-3 rounded"
            required
          />

          <div className="relative mb-2">
            <input
              type={showPassword ? "text" : "password"}
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border p-2 pr-10 rounded"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
            >
              {showPassword ? "👁️" : "👁️‍🗨️"}
            </button>
          </div>

          {role === "patient" && (
            <div className="text-right mb-4">
              <Link
                href={`/forgot-password?role=patient`}
                className="text-sm text-blue-600 hover:underline"
              >
                Forgot password?
              </Link>
            </div>
          )}

          {error && (
            <p className="text-red-600 text-sm mb-3">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-black text-white py-2 rounded disabled:opacity-50"
          >
            {loading ? "Logging in..." : "Login"}
          </button>
        </form>

        <button
          onClick={() => router.push("/")}
          className="mt-4 text-sm text-gray-500 w-full text-center block"
        >
          Cancel
        </button>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading...</div>}>
      <LoginPageContent />
    </Suspense>
  );
}
