'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function DriverLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  useEffect(() => {
    const user = (() => { try { const r = localStorage.getItem('user'); return r ? JSON.parse(r) : null; } catch { return null; } })();
    if (!user) { router.replace('/driver/login'); return; }
    if (user.role !== 'driver') { router.replace('/driver/login'); }
  }, [router]);

  return (
    <div className="min-h-screen bg-gray-50 max-w-lg mx-auto">
      {children}
    </div>
  );
}
