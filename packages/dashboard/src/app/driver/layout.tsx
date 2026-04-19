'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { attemptSilentBootstrap } from '@/lib/auth';

export default function DriverLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // P-SES23: bootstrap AT from RT cookie before checking auth — prevents reload logout
    attemptSilentBootstrap().then(() => {
      const user = (() => { try { const r = localStorage.getItem('user'); return r ? JSON.parse(r) : null; } catch { return null; } })();
      if (!user || user.role !== 'driver') { router.replace('/driver/login'); return; }
      setReady(true);
    });
  }, [router]);

  if (!ready) return null;

  return (
    <div className="min-h-screen bg-gray-50 max-w-lg mx-auto">
      {children}
    </div>
  );
}
