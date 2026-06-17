"use client";

import React from "react";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import ChangePasswordModal from "../../_components/ChangePasswordModal";

interface TherapistProfile {
  id: string;
  name: string;
  email: string;
  therapistIDNum: string | null;
  specialty: string | null;
  createdAt: string | null;
}

export default function TherapistProfilePage() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [profile, setProfile] = useState<TherapistProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [showChangePassword, setShowChangePassword] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    fetch(`/api/users/${user.id}`)
      .then(async (res) => {
        if (res.ok) {
          const d = await res.json();
          setProfile(d.user ?? null);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user?.id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12 text-gray-500">
        Loading profile…
      </div>
    );
  }

  const username = profile?.email?.split("@")[0] ?? "—";

  return (
    <div>
      <h1 className="text-2xl font-bold text-green-800 mb-1">My Profile</h1>
      <p className="text-gray-500 mb-6">Manage your personal and account information</p>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* ── Left column: Personal Information ── */}
        <div className="lg:col-span-2">
          <div className="bg-white border border-green-200 rounded-2xl p-6 h-full">
            <h2 className="text-base font-semibold text-green-700 mb-5">
              Personal Information
            </h2>

            {!profile ? (
              <p className="text-sm text-gray-400">
                Unable to load profile. Please contact the admin.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5">
                <InfoField icon={<PersonIcon />} label="Full Name"     value={profile.name} />
                <InfoField icon={<EmailIcon />}  label="Email"         value={profile.email} />
                <InfoField icon={<BriefcaseIcon />} label="Specialization" value={profile.specialty} />
              </div>
            )}
          </div>
        </div>

        {/* ── Right column: Account Information + Account Actions ── */}
        <div className="flex flex-col gap-4">

          {/* Account Information */}
          <div className="bg-white border border-green-200 rounded-2xl p-6">
            <h2 className="text-base font-semibold text-green-700 mb-4">
              Account Information
            </h2>
            <div className="space-y-4">
              <AccountField label="Username"     value={username} />
              <AccountField label="Account Type" value="Specialist" />
              <AccountField
                label="Member Since"
                value={formatMemberSince(profile?.createdAt ?? null)}
              />
            </div>
          </div>

          {/* Account Actions */}
          <div className="bg-white border border-green-200 rounded-2xl p-6">
            <h2 className="text-base font-semibold text-green-700 mb-4">
              Account Actions
            </h2>
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => setShowChangePassword(true)}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-green-700 hover:bg-green-800 text-white text-sm font-medium transition"
              >
                <KeyIcon />
                Change Password
              </button>
              <button
                type="button"
                onClick={async () => { await logout(); router.push("/"); }}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-red-500 text-red-600 text-sm font-medium hover:bg-red-50 transition"
              >
                <LogoutIcon />
                Log Out
              </button>
            </div>
          </div>

        </div>
      </div>

      {showChangePassword && profile?.email && (
        <ChangePasswordModal
          email={profile.email}
          onClose={() => setShowChangePassword(false)}
        />
      )}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatMemberSince(dateStr: string | null): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

// ── Sub-components ─────────────────────────────────────────────────────────

function InfoField({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 shrink-0 text-green-600">{icon}</div>
      <div>
        <p className="text-xs text-gray-500 mb-0.5">{label}</p>
        <p className="text-sm font-semibold text-gray-900">
          {value ?? "—"}
        </p>
      </div>
    </div>
  );
}

function AccountField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-gray-500 mb-0.5">{label}</p>
      <p className="text-sm font-semibold text-gray-900">{value}</p>
    </div>
  );
}

// ── Icons (inline SVG) ─────────────────────────────────────────────────────

function PersonIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 12c2.7 0 5-2.3 5-5s-2.3-5-5-5-5 2.3-5 5 2.3 5 5 5zm0 2c-3.3 0-10 1.7-10 5v1h20v-1c0-3.3-6.7-5-10-5z"/>
    </svg>
  );
}

function EmailIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z"/>
    </svg>
  );
}

function BriefcaseIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20 7h-4V5c0-1.1-.9-2-2-2h-4c-1.1 0-2 .9-2 2v2H4c-1.1 0-2 .9-2 2v11c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V9c0-1.1-.9-2-2-2zm-6 0h-4V5h4v2z"/>
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12.65 10C11.83 7.67 9.61 6 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6c2.61 0 4.83-1.67 5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/>
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4C2.9 3 2 3.9 2 5v14c0 1.1.9 2 2 2h8v-2H4V5z"/>
    </svg>
  );
}
