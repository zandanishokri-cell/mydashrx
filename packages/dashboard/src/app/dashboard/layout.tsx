'use client';
import { useEffect, useState, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { isAuthenticated, clearSession, getUser } from '@/lib/auth';
import { api } from '@/lib/api';
import { LayoutDashboard, Route, Map, Users, LogOut, Search, BarChart2, Target, Shield, Scale, Menu, X, Zap, CreditCard, Settings2, ChevronDown, Crown, RefreshCw, TrendingUp } from 'lucide-react';
import NotificationPanel from '@/components/NotificationPanel';

const baseNavItems = [
  { href: '/dashboard', label: 'Command Center', icon: LayoutDashboard, exact: true },
  { href: '/dashboard/search', label: 'Search', icon: Search },
  { href: '/dashboard/stops', label: 'Stops', icon: Route },
  { href: '/dashboard/recurring', label: 'Recurring', icon: RefreshCw },
  { href: '/dashboard/plans', label: 'Routes', icon: Route },
  { href: '/dashboard/map', label: 'Live Map', icon: Map },
  { href: '/dashboard/drivers', label: 'Drivers', icon: Users },
  { href: '/dashboard/analytics', label: 'Analytics', icon: BarChart2 },
  { href: '/dashboard/leads', label: 'Lead Finder', icon: Target },
  { href: '/dashboard/compliance', label: 'Compliance', icon: Shield },
  { href: '/dashboard/mi-compliance', label: 'MI Compliance', icon: Scale },
  { href: '/dashboard/automation', label: 'Automation', icon: Zap },
  { href: '/dashboard/intel', label: 'Intel', icon: TrendingUp },
  { href: '/dashboard/billing', label: 'Billing', icon: CreditCard },
  { href: '/dashboard/settings', label: 'Settings', icon: Settings2 },
];

const avatarColors = ['bg-blue-500', 'bg-teal-500', 'bg-violet-500', 'bg-amber-500', 'bg-rose-500'];
const getInitials = (name: string) => name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
const getAvatarColor = (name: string) => avatarColors[name.charCodeAt(0) % avatarColors.length];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const onboardingChecked = useRef(false);
  const user = getUser();

  const navItems = [
    ...baseNavItems,
    ...(user?.role === 'super_admin' ? [{ href: '/dashboard/admin', label: 'Platform Admin', icon: Crown }] : []),
  ];

  useEffect(() => {
    if (!isAuthenticated()) router.replace('/login');
  }, [router]);

  useEffect(() => { setDrawerOpen(false); }, [pathname]);

  // Close profile dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfileOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Cmd+K / Ctrl+K → navigate to search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        router.push('/dashboard/search');
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [router]);

  // Onboarding check: redirect new orgs with no depots to setup wizard
  useEffect(() => {
    if (onboardingChecked.current) return;
    if (!user || pathname !== '/dashboard') return;
    onboardingChecked.current = true;
    api.get<unknown[]>(`/orgs/${user.orgId}/depots`)
      .then(depots => {
        if (depots.length === 0) router.replace('/dashboard/onboarding');
      })
      .catch(() => { /* non-blocking */ });
  }, [user, pathname, router]);

  const handleSignOut = () => { clearSession(); router.replace('/login'); };

  const isActive = (item: typeof navItems[0]) =>
    item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(item.href + '/');

  const userName = user?.name ?? 'User';
  const orgName = 'MyDashRx';

  const NavLinks = () => (
    <>
      {navItems.map(({ href, label, icon: Icon, exact }) => {
        const active = isActive({ href, label, icon: Icon, exact });
        return (
          <Link
            key={href}
            href={href}
            className={`flex items-center gap-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              active
                ? 'bg-blue-50 text-[#0F4C81] border-l-2 border-[#0F4C81] pl-[10px] pr-3'
                : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700 px-3'
            }`}
          >
            <Icon size={15} />
            {label}
          </Link>
        );
      })}
    </>
  );

  return (
    <div className="flex h-screen bg-[#F7F8FC]">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-56 bg-white border-r border-gray-100 flex-col shrink-0">
        <div className="px-5 py-5 bg-gradient-to-b from-blue-50/60 to-transparent border-b border-gray-100 mb-2">
          <div className="flex items-center justify-between">
            <span className="font-bold text-[#0F4C81] text-base" style={{ fontFamily: 'var(--font-sora)' }}>
              {orgName}
            </span>
            <NotificationPanel />
          </div>
          {/* Profile dropdown trigger */}
          <div className="relative mt-3" ref={profileRef}>
            <button
              onClick={() => setProfileOpen(v => !v)}
              className="flex items-center gap-2 w-full rounded-lg hover:bg-blue-50/80 transition-colors -mx-1 px-1 py-1"
            >
              <div className={`w-7 h-7 rounded-full ${getAvatarColor(userName)} flex items-center justify-center text-white text-xs font-bold shrink-0`}>
                {getInitials(userName)}
              </div>
              <span className="text-xs text-gray-600 font-medium truncate flex-1 text-left">{userName}</span>
              <ChevronDown size={12} className={`text-gray-400 shrink-0 transition-transform ${profileOpen ? 'rotate-180' : ''}`} />
            </button>
            {profileOpen && (
              <div className="absolute left-0 right-0 top-full mt-1 bg-white rounded-xl border border-gray-100 shadow-lg z-50 py-1 overflow-hidden">
                <div className="px-3 py-2.5 border-b border-gray-100">
                  <p className="text-xs font-semibold text-gray-800 truncate">{user?.name}</p>
                  <p className="text-xs text-gray-400 truncate">{user?.email}</p>
                </div>
                <Link href="/dashboard/settings" onClick={() => setProfileOpen(false)}
                  className="flex items-center gap-2 px-3 py-2 text-xs text-gray-600 hover:bg-gray-50 transition-colors">
                  <Settings2 size={13} /> Settings
                </Link>
                <button onClick={() => { setProfileOpen(false); handleSignOut(); }}
                  className="flex items-center gap-2 px-3 py-2 w-full text-xs text-red-500 hover:bg-red-50 transition-colors">
                  <LogOut size={13} /> Sign out
                </button>
              </div>
            )}
          </div>
        </div>
        <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto">
          <NavLinks />
        </nav>
        <div className="px-3 pb-4">
          <button
            onClick={handleSignOut}
            className="flex items-center gap-3 px-3 py-2 w-full rounded-lg text-sm text-gray-400 hover:bg-gray-50 hover:text-gray-600 transition-colors"
          >
            <LogOut size={15} />
            Sign out
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between shadow-sm">
        <span className="font-bold text-[#0F4C81] text-base" style={{ fontFamily: 'var(--font-sora)' }}>
          {orgName}
        </span>
        <div className="flex items-center gap-1">
          <NotificationPanel />
          <button
            onClick={() => setDrawerOpen(v => !v)}
            className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
            aria-label="Toggle menu"
          >
            {drawerOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {/* Mobile drawer backdrop */}
      {drawerOpen && (
        <div
          className="md:hidden fixed inset-0 z-30 bg-black/20 backdrop-blur-sm"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      <aside className={`md:hidden fixed top-0 left-0 h-full w-64 bg-white z-40 flex flex-col shadow-xl transition-transform duration-200 ${drawerOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="px-5 pt-20 pb-4 bg-gradient-to-b from-blue-50/60 to-transparent border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-full ${getAvatarColor(userName)} flex items-center justify-center text-white text-sm font-bold shrink-0`}>
              {getInitials(userName)}
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-800 truncate">{userName}</p>
              <p className="text-xs text-gray-400">{orgName}</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 px-3 pt-3 space-y-0.5 overflow-y-auto">
          <NavLinks />
        </nav>
        <div className="px-3 pb-8">
          <button
            onClick={handleSignOut}
            className="flex items-center gap-3 px-3 py-2 w-full rounded-lg text-sm text-gray-400 hover:bg-gray-50 hover:text-gray-600 transition-colors"
          >
            <LogOut size={15} />
            Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto mt-14 md:mt-0">{children}</main>
    </div>
  );
}
