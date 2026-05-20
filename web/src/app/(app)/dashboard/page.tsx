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
        router.replace('/dashboard/admin');
        break;
      case 'therapist':
        router.replace('/dashboard/therapist');
        break;
      case 'patient':
        router.replace('/dashboard/patient');
        break;
      default:
        router.replace('/login');
    }
  }, [router, user, loading]);

  return null;
}
