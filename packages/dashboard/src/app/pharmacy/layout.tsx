'use client';
import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { attemptSilentBootstrap } from '@/lib/auth';
import Link from 'next/link';
import { LayoutDashboard, ClipboardList, LogOut } from 'lucide-react';

export default function PharmacyLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // P-SES23: bootstrap AT from RT cookie before auth check
    attemptSilentBootstrap().then(() => {
      const user = (() => { try { return JSON.parse(localStorage.getItem('user') ?? 'null'); } catch { return null; } })();
      if (!user || user.role !== 'pharmacist') { router.replace('/pharmacy/login'); return; }
      setReady(true);
    });
  }, [router]);

  if (!ready) return null;

  const signOut = () => { localStorage.clear(); router.replace('/pharmacy/login'); };

  const nav = [
    { href: '/pharmacy', label: 'Submit Order', icon: LayoutDashboard, exact: true },
    { href: '/pharmacy/orders', label: 'My Orders', icon: ClipboardList },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Sticky header */}
      <div className="bg-white border-b border-gray-100 px-4 md:px-6 py-3.5 flex items-center justify-between sticky top-0 z-10 shadow-sm">
        <div>
          <span className="font-bold text-[#0F4C81] text-base" style={{ fontFamily: 'var(--font-sora)' }}>MyDashRx</span>
          <span className="hidden sm:inline text-gray-300 mx-2">|</span>
          <span className="hidden sm:inline text-xs text-gray-500 font-medium">Pharmacy Portal</span>
        </div>
        <button
          onClick={signOut}
          className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 transition-colors px-2 py-1.5 rounded-lg hover:bg-gray-50"
        >
          <LogOut size={16} />
          <span className="hidden sm:inline">Sign out</span>
        </button>
      </div>

      {/* Tab navigation — large touch targets for tablet/phone */}
      <div className="flex bg-white border-b border-gray-100 px-2 md:px-4 sticky top-[53px] z-10">
        {nav.map(({ href, label, icon: Icon, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href + '/') || pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-2 px-5 py-4 text-sm font-semibold border-b-2 transition-colors min-w-[100px] justify-center md:justify-start ${
                active ? 'border-[#0F4C81] text-[#0F4C81]' : 'border-transparent text-gray-400 hover:text-gray-600 hover:border-gray-200'
              }`}
            >
              <Icon size={16} />
              {label}
            </Link>
          );
        })}
      </div>

      <main className="max-w-2xl mx-auto px-0 md:px-4 py-4 md:py-6">{children}</main>
    </div>
  );
}
