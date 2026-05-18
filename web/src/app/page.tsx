"use client";

import Image from "next/image";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function HomePage() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  return (
    <main className="min-h-screen flex items-center justify-center bg-blue-50">
      <div className="text-center space-y-6 px-6">
        <div className="flex flex-col items-center gap-2">
          <Image src="/acc_bacoor_logo.png" alt="ACC Bacoor Logo" width={140} height={140} className="mb-1" />
          <div className="w-16 h-16 rounded-full bg-blue-200 flex items-center justify-center mb-2">
            <svg className="w-9 h-9 text-blue-700" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
              {/* head */}
              <circle cx="12" cy="4" r="2" />
              {/* spine */}
              <line x1="12" y1="6" x2="12" y2="14" strokeLinecap="round" />
              {/* shoulders */}
              <path strokeLinecap="round" d="M8 9h8" />
              {/* arms */}
              <line x1="8" y1="9" x2="6.5" y2="13" strokeLinecap="round" />
              <line x1="16" y1="9" x2="17.5" y2="13" strokeLinecap="round" />
              {/* legs */}
              <line x1="12" y1="14" x2="10" y2="20" strokeLinecap="round" />
              <line x1="12" y1="14" x2="14" y2="20" strokeLinecap="round" />
            </svg>
          </div>
          <h1 className="text-2xl sm:text-4xl font-bold text-blue-900 tracking-tight">Postural Monitoring</h1>
          <p className="text-blue-700 text-sm sm:text-base">ML-assisted posture and movement analysis</p>
        </div>

        <button
          onClick={() => setOpen(true)}
          className="inline-block px-8 py-3 rounded-full bg-blue-600 text-white font-semibold shadow hover:bg-blue-700 transition-colors"
        >
          Get Started
        </button>

        {open && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div
              className="fixed inset-0 bg-blue-950/40 backdrop-blur-sm"
              onClick={() => setOpen(false)}
            />

            <div className="bg-white border border-blue-100 rounded-2xl p-8 z-10 w-11/12 max-w-sm text-center shadow-xl">
              <h2 className="text-xl font-bold text-blue-900 mb-1">Hello!</h2>
              <p className="text-sm text-blue-600 mb-6">Select your role to access your dashboard</p>
              <div className="flex gap-3 flex-col">
                <button
                  onClick={() => router.push('/login?role=patient')}
                  className="flex-1 px-4 py-3 rounded-xl bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors"
                >
                  Patient
                </button>
                <button
                  onClick={() => router.push('/login?role=therapist')}
                  className="flex-1 px-4 py-3 rounded-xl bg-blue-500 text-white font-medium hover:bg-blue-600 transition-colors"
                >
                  Therapist
                </button>
                <button
                  onClick={() => router.push('/login?role=admin')}
                  className="flex-1 px-4 py-3 rounded-xl bg-blue-800 text-white font-medium hover:bg-blue-900 transition-colors"
                >
                  Admin
                </button>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="mt-5 text-sm text-blue-500 hover:text-blue-700 transition-colors"
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
