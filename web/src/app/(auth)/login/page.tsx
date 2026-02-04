"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";

export default function LoginPage() {
  const searchParams = useSearchParams();
  const roleParam = (searchParams?.get("role") as string) || "patient";
  const role = roleParam.toLowerCase();
  const isDoctor = role === "doctor";

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

        <input
          type="email"
          placeholder="Email"
          className="w-full border p-2 mb-3 rounded"
        />

        {isDoctor && (
          <input
            type="text"
            placeholder="Clinic / License ID"
            className="w-full border p-2 mb-3 rounded"
          />
        )}

        <input
          type="password"
          placeholder="Password"
          className="w-full border p-2 mb-2 rounded"
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

        <button className="w-full bg-black text-white py-2 rounded">
          Login
        </button>
      </div>
    </main>
  );
}
