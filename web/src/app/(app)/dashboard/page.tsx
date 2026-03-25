'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/lib/AuthContext';

export default function DashboardPage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading) return;

    if (!user) {
      router.push('/login');
      return;
    }

    switch (user.role) {
      case 'admin':
        router.push('/dashboard/admin');
        break;
      case 'therapist':
        router.push('/dashboard/therapist');
        break;
      case 'patient':
        router.push('/dashboard/patient');
        break;
      default:
        router.push('/login');
    }
  }, [router, user, loading]);

  return null;
}
