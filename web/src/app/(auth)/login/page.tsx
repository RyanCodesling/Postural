"use client";

import { useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { loginUser, setStoredUser } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const roleParam = (searchParams?.get("role") as string) || "patient";
  const role = roleParam.toLowerCase();
  const isDoctor = role === "doctor";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const result = await loginUser(email, password, role);
      setStoredUser(result.user);
      router.push(isDoctor ? "/dashboard" : "/dashboard");
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
          Login — {isDoctor ? "Doctor Therapist" : "Patient"}
        </h2>

        <p className="text-sm text-gray-500 mb-4">
          {isDoctor
            ? "Please sign in with your clinic credentials."
            : "Sign in to access your posture and movement data."}
        </p>

        {/* Temporary Credentials Display */}
        <div className="bg-blue-50 border border-blue-200 p-3 rounded mb-4 text-xs">
          <p className="font-semibold text-blue-900 mb-2">Demo Credentials:</p>
          {isDoctor ? (
            <>
              <p className="text-blue-800">Email: doctor@clinic.com</p>
              <p className="text-blue-800">Password: doctor123</p>
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

          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border p-2 mb-2 rounded"
            required
          />

          {!isDoctor && (
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

        {/* Role Switcher */}
        <div className="text-center mt-4 border-t pt-4">
          <p className="text-sm text-gray-600 mb-2">Switch Role:</p>
          <button
            onClick={() =>
              router.push(`/login?role=${isDoctor ? "patient" : "doctor"}`)
            }
            className="text-sm text-blue-600 hover:underline"
          >
            {isDoctor ? "Login as Patient" : "Login as Doctor"}
          </button>
        </div>
      </div>
    </main>
  );
}
