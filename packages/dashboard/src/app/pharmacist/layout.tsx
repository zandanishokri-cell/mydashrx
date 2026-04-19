'use client';
import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { attemptSilentBootstrap } from '@/lib/auth';
import Link from 'next/link';
import { FlaskConical, ListOrdered, BarChart2, LogOut } from 'lucide-react';
import { useIdleTimeout } from '@/hooks/useIdleTimeout';
import { IdleWarningModal } from '@/components/IdleWarningModal';

export default function PharmacistLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // P-SES23: bootstrap AT from RT cookie before auth check
    attemptSilentBootstrap().then(() => {
      const user = (() => { try { return JSON.parse(localStorage.getItem('user') ?? 'null'); } catch { return null; } })();
      if (!user) { router.replace('/pharmacist/login'); return; }
      const allowed = ['pharmacist', 'pharmacy_admin', 'super_admin'];
      if (!allowed.includes(user.role)) { router.replace('/pharmacist/login'); return; }
      setReady(true);
    });
  }, [router]);

  // P-SES25: HIPAA §164.312(a)(2)(iii) — automatic logoff for pharmacist portal
  const { showWarning, extendSession, countdown } = useIdleTimeout();

  if (!ready) return null;

  const signOut = () => { localStorage.clear(); router.replace('/pharmacist/login'); };

  const nav = [
    { href: '/pharmacist/queue', label: 'Queue', icon: ListOrdered },
    { href: '/pharmacist/analytics', label: 'Analytics', icon: BarChart2 },
  ];

  return (
    <div className="min-h-screen bg-[#F0FDF9]">
      {/* Header */}
      <div className="bg-white border-b border-emerald-100 px-4 md:px-6 py-3.5 flex items-center justify-between sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-emerald-50 rounded-lg flex items-center justify-center">
            <FlaskConical size={16} className="text-emerald-600" />
          </div>
          <div>
            <span className="font-bold text-gray-900 text-sm" style={{ fontFamily: 'var(--font-sora)' }}>MyDashRx</span>
            <span className="hidden sm:inline text-gray-300 mx-2 text-sm">|</span>
            <span className="hidden sm:inline text-xs text-gray-500 font-medium">Dispensing Portal</span>
          </div>
        </div>
        <button
          onClick={signOut}
          className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 transition-colors px-2 py-1.5 rounded-lg hover:bg-gray-50"
        >
          <LogOut size={16} />
          <span className="hidden sm:inline">Sign out</span>
        </button>
      </div>

      {/* Nav tabs */}
      <div className="flex bg-white border-b border-emerald-50 px-2 md:px-4 sticky top-[53px] z-10">
        {nav.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-2 px-5 py-4 text-sm font-semibold border-b-2 transition-colors min-w-[100px] justify-center md:justify-start ${
                active
                  ? 'border-emerald-500 text-emerald-700'
                  : 'border-transparent text-gray-400 hover:text-gray-600 hover:border-gray-200'
              }`}
            >
              <Icon size={16} />
              {label}
            </Link>
          );
        })}
      </div>

      <main className="max-w-4xl mx-auto px-4 py-6">{children}</main>
      {showWarning && <IdleWarningModal countdown={countdown} onExtend={extendSession} />}
    </div>
  );
}
