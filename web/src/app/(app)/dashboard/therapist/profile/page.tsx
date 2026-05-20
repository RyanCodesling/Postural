"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/AuthContext";

interface TherapistProfile {
  id: string;
  name: string;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  email: string;
  clinicId: string | null;
  therapistIDNum: string | null;
  specialty: string | null;
  dateOfBirth: string | null;
  age: number | null;
  gender: string | null;
}

interface PatientData {
  id: string;
  name: string;
  email: string;
}

export default function TherapistProfilePage() {
  const { user } = useAuth();
  const [therapistProfile, setTherapistProfile] = useState<TherapistProfile | null>(null);
  const [patients, setPatients] = useState<PatientData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.id) return;
    Promise.all([
      fetch(`/api/users/${user.id}`),
      fetch(`/api/users?role=patient&therapistId=${user.id}`),
    ])
      .then(async ([profileRes, patientsRes]) => {
        if (profileRes.ok) {
          const d = await profileRes.json();
          setTherapistProfile(d.user ?? null);
        }
        if (patientsRes.ok) {
          const d = await patientsRes.json();
          setPatients(d.users ?? []);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user?.id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12 text-gray-500">
        Loading profile...
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-1">My Profile</h1>
      <p className="text-gray-500 mb-6">Your account information.</p>

      <section className="bg-white border border-gray-200 rounded-2xl p-6 mb-6 max-w-2xl">
        <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-4">
          Therapist Information
        </h2>
        {!therapistProfile ? (
          <p className="text-gray-400 text-sm">Unable to load profile. Please contact the admin.</p>
        ) : (
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
            <ProfileField label="Full Name" value={therapistProfile.name} />
            <ProfileField label="First Name" value={therapistProfile.firstName} />
            <ProfileField label="Middle Name" value={therapistProfile.middleName} />
            <ProfileField label="Last Name" value={therapistProfile.lastName} />
            <ProfileField label="Email" value={therapistProfile.email} />
            <ProfileField label="Therapist ID" value={therapistProfile.therapistIDNum ?? therapistProfile.id} />
            <ProfileField label="Specialty" value={therapistProfile.specialty} />
            <ProfileField label="Clinic ID" value={therapistProfile.clinicId} />
            <ProfileField label="Gender" value={therapistProfile.gender} />
            <ProfileField label="Age" value={therapistProfile.age != null ? String(therapistProfile.age) : null} />
            <ProfileField label="Date of Birth" value={therapistProfile.dateOfBirth} />
          </dl>
        )}
      </section>

      <section className="bg-white border border-gray-200 rounded-2xl p-6 max-w-2xl">
        <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-4">
          Assigned Patients ({patients.length})
        </h2>
        {patients.length === 0 ? (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
            <p className="font-semibold mb-1">No patients assigned yet</p>
            <p>You currently have no patients assigned to you. Please contact or inform the admin to assign patients to your account.</p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {patients.map((p) => (
              <li key={p.id} className="py-3 flex items-center justify-between gap-4">
                <div>
                  <p className="font-medium text-gray-900 text-sm">{p.name}</p>
                  <p className="text-xs text-gray-500">{p.email}</p>
                </div>
                <span className="text-xs text-gray-400 font-mono shrink-0">{p.id}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ProfileField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs text-gray-500 font-medium mb-0.5">{label}</dt>
      <dd className="text-sm text-gray-900">
        {value ? value : (
          <span className="text-gray-400 italic">Not set — contact admin</span>
        )}
      </dd>
    </div>
  );
}
