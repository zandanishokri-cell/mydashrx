'use client';
import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { isAuthenticated, clearSession } from '@/lib/auth';
import { LayoutDashboard, Route, Map, Users, LogOut, Search, BarChart2 } from 'lucide-react';

const navItems = [
  { href: '/dashboard', label: 'Command Center', icon: LayoutDashboard, exact: true },
  { href: '/dashboard/search', label: 'Search', icon: Search },
  { href: '/dashboard/stops', label: 'Stops', icon: Route },
  { href: '/dashboard/plans', label: 'Routes', icon: Route },
  { href: '/dashboard/map', label: 'Live Map', icon: Map },
  { href: '/dashboard/drivers', label: 'Drivers', icon: Users },
  { href: '/dashboard/analytics', label: 'Analytics', icon: BarChart2 },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!isAuthenticated()) router.replace('/login');
  }, [router]);

  const handleSignOut = () => { clearSession(); router.replace('/login'); };

  const isActive = (item: typeof navItems[0]) => {
    if (item.exact) return pathname === item.href;
    return pathname === item.href || pathname.startsWith(item.href + '/');
  };

  return (
    <div className="flex h-screen bg-[#F7F8FC]">
      <aside className="w-52 bg-white border-r border-gray-100 flex flex-col py-6 shrink-0">
        <div className="px-5 mb-8">
          <span className="font-bold text-[#0F4C81] text-lg" style={{ fontFamily: 'var(--font-sora)' }}>MyDashRx</span>
        </div>
        <nav className="flex-1 px-3 space-y-0.5">
          {navItems.map(({ href, label, icon: Icon, exact }) => (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                isActive({ href, label, icon: Icon, exact })
                  ? 'bg-blue-50 text-[#0F4C81]'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <Icon size={15} />
              {label}
            </Link>
          ))}
        </nav>
        <div className="px-3">
          <button
            onClick={handleSignOut}
            className="flex items-center gap-3 px-3 py-2 w-full rounded-lg text-sm text-gray-500 hover:bg-gray-50 transition-colors"
          >
            <LogOut size={15} />
            Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
