"use client";

import React from "react";
import Link from "next/link";
import { useState, useEffect } from "react";
import { useAuth } from "@/lib/AuthContext";
import ChangePasswordModal from "../../_components/ChangePasswordModal";
import ProfileLayout, { ProfileField } from "../../_components/ProfileLayout";

interface TherapistProfile {
  id: string;
  name: string;
  email: string;
  therapistIDNum: string | null;
  specialty: string | null;
  createdAt: string | null;
}

interface AssignedPatient {
  id: string;
  name: string;
  email: string;
}

export default function TherapistProfilePage() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<TherapistProfile | null>(null);
  const [patients, setPatients] = useState<AssignedPatient[]>([]);
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

    fetch(`/api/users?role=patient&therapistId=${user.id}`)
      .then(async (res) => {
        if (res.ok) {
          const d = await res.json();
          setPatients(d.users ?? []);
        }
      })
      .catch(() => {});
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
    <>
      <ProfileLayout
        name={profile?.name ?? user?.name}
        email={profile?.email}
        roleLabel="Therapist"
        onChangePassword={() => setShowChangePassword(true)}
        leftTitle="Personal Information"
        left={
          !profile ? (
            <p className="text-sm text-gray-400">Unable to load profile. Please contact the admin.</p>
          ) : (
            <div className="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2">
              <ProfileField icon={<PersonIcon />} label="Full Name" value={profile.name} />
              <ProfileField icon={<EmailIcon />} label="Email" value={profile.email} />
              <ProfileField icon={<BriefcaseIcon />} label="Specialization" value={profile.specialty} />
              <ProfileField icon={<BriefcaseIcon />} label="Therapist ID" value={profile.therapistIDNum} />
            </div>
          )
        }
        bottomTitle={`Assigned Patients (${patients.length})`}
        bottom={
          patients.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-400">
              No patients assigned yet. The admin assigns patients to you.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-gray-100 text-left text-xs text-gray-400">
                  <th className="py-2 pr-4 font-medium">Patient</th>
                  <th className="px-4 py-2 font-medium">Email</th>
                  <th className="py-2 pl-4 text-right font-medium" />
                </tr>
              </thead>
              <tbody>
                {patients.map((patient) => (
                  <tr key={patient.id} className="border-b border-gray-50 transition hover:bg-green-50/40">
                    <td className="py-2.5 pr-4 font-semibold text-gray-900">{patient.name}</td>
                    <td className="px-4 py-2.5 text-gray-600">{patient.email}</td>
                    <td className="py-2.5 pl-4 text-right">
                      <Link
                        href={`/dashboard/therapist/patients/${patient.id}`}
                        className="text-sm font-medium text-green-700 hover:underline"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
        rightTitle="Account Information"
        right={
          <div className="space-y-5">
            <ProfileField label="Username" value={username} />
            <ProfileField label="Account Type" value="Specialist" />
            <ProfileField label="Member Since" value={formatMemberSince(profile?.createdAt ?? null)} />
          </div>
        }
      />

      {showChangePassword && profile?.email && (
        <ChangePasswordModal email={profile.email} onClose={() => setShowChangePassword(false)} />
      )}
    </>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatMemberSince(dateStr: string | null): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
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

