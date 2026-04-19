'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { attemptSilentBootstrap } from '@/lib/auth';
import { useIdleTimeout } from '@/hooks/useIdleTimeout';
import { IdleWarningModal } from '@/components/IdleWarningModal';

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

  // P-SES25: HIPAA §164.312(a)(2)(iii) — automatic logoff for driver portal
  const { showWarning, extendSession, countdown } = useIdleTimeout();

  if (!ready) return null;

  return (
    <div className="min-h-screen bg-gray-50 max-w-lg mx-auto">
      {children}
      {showWarning && <IdleWarningModal countdown={countdown} onExtend={extendSession} />}
    </div>
  );
}
