"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";

export default function HomePage() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  const handleOpenDialog = useCallback(() => {
    setOpen(true);
  }, []);

  const handleCloseDialog = useCallback(() => {
    setOpen(false);
  }, []);

  const handlePatientLogin = useCallback(() => {
    router.push('/login?role=patient');
  }, [router]);

  const handleDoctorLogin = useCallback(() => {
    router.push('/login?role=doctor');
  }, [router]);

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center space-y-4">
        <h1 className="text-3xl font-bold">Postural Monitoring System</h1>
        <p className="text-gray-600">AI-assisted posture and movement analysis</p>
        <button
          onClick={handleOpenDialog}
          className="inline-block px-6 py-2 rounded bg-black text-white"
        >
          Go to Login
        </button>

        {open && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div
              className="fixed inset-0 bg-black/50"
              onClick={handleCloseDialog}
            />

            <div className="bg-white rounded-lg p-6 z-10 w-11/12 max-w-sm text-center">
              <h2 className="text-lg font-semibold mb-4">Login as</h2>
              <div className="flex gap-3">
                <button
                  onClick={handlePatientLogin}
                  className="flex-1 px-4 py-2 rounded bg-gray-800 text-white"
                >
                  Patient
                </button>
                <button
                  onClick={handleDoctorLogin}
                  className="flex-1 px-4 py-2 rounded bg-blue-600 text-white"
                >
                  Doctor Therapist
                </button>
              </div>
              <button
                onClick={handleCloseDialog}
                className="mt-4 text-sm text-gray-500"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
