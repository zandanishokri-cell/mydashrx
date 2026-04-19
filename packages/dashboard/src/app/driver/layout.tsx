'use client';
import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { attemptSilentBootstrap } from '@/lib/auth';
import { useIdleTimeout } from '@/hooks/useIdleTimeout';
import { IdleWarningModal } from '@/components/IdleWarningModal';
import { Home, TrendingUp } from 'lucide-react';

export default function DriverLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // P-SES23: bootstrap AT from RT cookie before checking auth — prevents reload logout
    attemptSilentBootstrap().then(() => {
      const user = (() => { try { const r = localStorage.getItem('user'); return r ? JSON.parse(r) : null; } catch { return null; } })();
      if (!user || user.role !== 'driver') { router.replace('/driver/login'); return; }
      setReady(true);
    });

    // P-DRV3: Register Service Worker for Background Sync (Chrome/Android offline POD queue drain)
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { scope: '/' })
        .catch(() => { /* non-fatal — iOS/Safari falls back to useOfflineSync 30s polling */ });
    }
  }, [router]);

  // P-SES25: HIPAA §164.312(a)(2)(iii) — automatic logoff for driver portal
  const { showWarning, extendSession, countdown } = useIdleTimeout();

  if (!ready) return null;

  // Show bottom nav only on top-level driver pages (not mid-delivery detail)
  const showNav = pathname === '/driver' || pathname === '/driver/performance' || pathname?.startsWith('/driver/routes');

  return (
    <div className="min-h-screen bg-gray-50 max-w-lg mx-auto pb-16">
      {children}
      {/* P-DRV4: bottom nav for driver portal */}
      {showNav && (
        <nav className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto bg-white border-t border-gray-100 flex items-center z-40">
          <Link href="/driver" className={`flex-1 flex flex-col items-center py-3 gap-0.5 text-xs font-medium transition-colors ${
            pathname === '/driver' ? 'text-[#0F4C81]' : 'text-gray-400 hover:text-gray-600'
          }`}>
            <Home size={20} />
            <span>Routes</span>
          </Link>
          <Link href="/driver/performance" className={`flex-1 flex flex-col items-center py-3 gap-0.5 text-xs font-medium transition-colors ${
            pathname === '/driver/performance' ? 'text-[#0F4C81]' : 'text-gray-400 hover:text-gray-600'
          }`}>
            <TrendingUp size={20} />
            <span>Performance</span>
          </Link>
        </nav>
      )}
      {showWarning && <IdleWarningModal countdown={countdown} onExtend={extendSession} />}
    </div>
  );
}
