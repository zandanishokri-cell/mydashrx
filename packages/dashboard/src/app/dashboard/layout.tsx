'use client';
import { useEffect, useState, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { isAuthenticated, clearSession, getUser, attemptSilentBootstrap } from '@/lib/auth';
import { api, setImpersonateOrgId } from '@/lib/api';
import { LayoutDashboard, Route, Map, Users, LogOut, Search, BarChart2, Target, Shield, Scale, Menu, X, Zap, CreditCard, Settings2, ChevronDown, Crown, RefreshCw, TrendingUp, AlertTriangle } from 'lucide-react';
import NotificationPanel from '@/components/NotificationPanel';
import { CommandPalette } from '@/components/CommandPalette';
import { useIdleTimeout } from '@/hooks/useIdleTimeout';
import { IdleWarningModal } from '@/components/IdleWarningModal';
import { OnboardingChecklist } from '@/components/OnboardingChecklist';
import { OnboardingNudgeBar } from '@/components/OnboardingNudgeBar';

// Which roles can see each nav item. '*' = all authenticated roles.
const NAV_ROLE_MAP: Record<string, string[]> = {
  '/dashboard':           ['*'],
  '/dashboard/search':    ['*'],
  '/dashboard/stops':     ['super_admin', 'pharmacy_admin', 'dispatcher'],
  '/dashboard/recurring': ['super_admin', 'pharmacy_admin', 'dispatcher'],
  '/dashboard/plans':     ['super_admin', 'pharmacy_admin', 'dispatcher'],
  '/dashboard/map':       ['super_admin', 'pharmacy_admin', 'dispatcher'],
  '/dashboard/drivers':   ['super_admin', 'pharmacy_admin', 'dispatcher'],
  '/dashboard/analytics': ['super_admin', 'pharmacy_admin', 'dispatcher'],
  '/dashboard/leads':     ['super_admin', 'pharmacy_admin'],
  '/dashboard/compliance':    ['super_admin', 'pharmacy_admin', 'pharmacist'],
  '/dashboard/mi-compliance': ['super_admin', 'pharmacy_admin', 'pharmacist'],
  '/dashboard/automation': ['super_admin', 'pharmacy_admin'],
  '/dashboard/intel':     ['super_admin', 'pharmacy_admin'],
  '/dashboard/billing':   ['super_admin', 'pharmacy_admin'],
  '/dashboard/settings':  ['*'],
};

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
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  // P-RBAC31: super admin impersonation state
  const [impersonatedOrg, setImpersonatedOrg] = useState<{ orgId: string; orgName: string } | null>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const onboardingChecked = useRef(false);
  // P-SES23: bootstrapped=false until silent refresh resolves — prevents flash redirect on reload
  const [bootstrapped, setBootstrapped] = useState(false);
  // useState(null) ensures server and client render identically (no hydration mismatch).
  // useEffect sets the real user after hydration completes.
  const [user, setUser] = useState<ReturnType<typeof getUser>>(null);
  useEffect(() => {
    attemptSilentBootstrap().then(() => {
      setUser(getUser());
      setBootstrapped(true);
    });
  }, []);

  const { showWarning, extendSession, countdown } = useIdleTimeout();

  const navItems = [
    ...baseNavItems.filter(item => {
      const allowed = NAV_ROLE_MAP[item.href];
      if (!allowed || !user?.role) return true;
      return allowed.includes('*') || allowed.includes(user.role);
    }),
    ...(user?.role === 'super_admin' ? [
      { href: '/dashboard/admin', label: 'Platform Admin', icon: Crown },
      { href: '/admin/approvals', label: 'Approvals', icon: Crown, badge: pendingCount },
      { href: '/admin/audit-log', label: 'Audit Log', icon: Shield },
    ] : []),
  ];

  // P-SES23: only redirect after bootstrap completes — avoids false logout on reload
  useEffect(() => {
    if (!bootstrapped) return;
    if (!isAuthenticated()) router.replace('/login');
  }, [bootstrapped, router]);

  useEffect(() => {
    if (user && (user as any).mustChangePassword) {
      router.replace('/change-password');
    }
  }, [user, router]);

  // Role-based portal redirects — drivers and pharmacists have dedicated portals
  // P-ONB35: dispatcher/driver first-run welcome fork — show once then skip via localStorage
  useEffect(() => {
    if (!user) return;
    if (user.role === 'driver' && !pathname.startsWith('/dashboard/driver') && !pathname.startsWith('/dashboard/welcome')) {
      router.replace('/dashboard/driver/me/routes');
    } else if (user.role === 'pharmacist' && !pathname.startsWith('/pharmacist') && !pathname.startsWith('/dashboard/compliance') && !pathname.startsWith('/dashboard/mi-compliance') && !pathname.startsWith('/dashboard/settings')) {
      router.replace('/pharmacist/queue');
    } else if ((user.role === 'dispatcher' || user.role === 'driver') && pathname === '/dashboard' && typeof window !== 'undefined') {
      // Show welcome page on first login if not yet seen
      const key = `mdrx_welcome_seen_${user.role}`;
      if (!localStorage.getItem(key)) router.replace('/dashboard/welcome');
    }
  }, [user, pathname, router]);

  useEffect(() => { setDrawerOpen(false); }, [pathname]);

  // P-RBAC31: restore impersonation state from sessionStorage on load
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = sessionStorage.getItem('mdrx_impersonate');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setImpersonatedOrg(parsed);
        setImpersonateOrgId(parsed.orgId); // sync module-level header for api.ts
      } catch { sessionStorage.removeItem('mdrx_impersonate'); }
    }
  }, []);

  const startImpersonation = async (orgId: string) => {
    const data = await api.post<{ orgId: string; orgName: string }>(`/admin/impersonate/${orgId}`, {});
    const impState = { orgId: data.orgId, orgName: data.orgName };
    sessionStorage.setItem('mdrx_impersonate', JSON.stringify(impState));
    setImpersonateOrgId(data.orgId);
    setImpersonatedOrg(impState);
  };

  const endImpersonation = async () => {
    if (!impersonatedOrg) return;
    await api.del('/admin/impersonate').catch(() => {});
    sessionStorage.removeItem('mdrx_impersonate');
    setImpersonateOrgId(null);
    setImpersonatedOrg(null);
  };

  // Close profile dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfileOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Cmd+K / Ctrl+K → open command palette overlay
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setPaletteOpen(prev => !prev);
      }
      if (e.key === 'Escape') setPaletteOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // Poll pending approvals count for super_admin badge
  useEffect(() => {
    if (user?.role !== 'super_admin') return;
    const fetch = () => {
      api.get<{ org: unknown; admin: unknown }[]>('/admin/approvals')
        .then(list => setPendingCount(list.length))
        .catch(() => {});
    };
    fetch();
    const interval = setInterval(fetch, 60_000);
    return () => clearInterval(interval);
  }, [user]);

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

  // P-SES23: show blank while bootstrap is pending — avoids flash of redirect
  if (!bootstrapped) return null;

  const handleSignOut = () => { clearSession(); router.replace('/login'); };

  const isActive = (item: { href: string; exact?: boolean }) =>
    item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(item.href + '/');

  const userName = user?.name ?? 'User';
  const orgName = 'MyDashRx';

  // Render nav links as plain JSX (not as a component) to avoid React treating
  // a new function type on every render, which causes unnecessary unmount/remount.
  const navLinks = navItems.map((item) => {
    const { href, label, icon: Icon } = item;
    const exact = (item as any).exact as boolean | undefined;
    const badge = (item as any).badge as number | undefined;
    const active = isActive({ href, exact });
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
        <span className="flex-1">{label}</span>
        {badge != null && badge > 0 && (
          <span className="bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
            {badge > 9 ? '9+' : badge}
          </span>
        )}
      </Link>
    );
  });

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
          {navLinks}
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
          {navLinks}
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

      <main className="flex-1 overflow-auto mt-14 md:mt-0">
        {/* P-RBAC31: impersonation amber banner — visible whenever super_admin is acting as another org */}
        {impersonatedOrg && (
          <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center gap-2 text-amber-800 text-sm">
            <AlertTriangle size={15} className="shrink-0 text-amber-600" />
            <span className="font-semibold">Impersonating:</span>
            <span>{impersonatedOrg.orgName}</span>
            <span className="text-amber-500 text-xs ml-1">({impersonatedOrg.orgId})</span>
            <button
              onClick={endImpersonation}
              className="ml-auto text-xs bg-amber-200 hover:bg-amber-300 text-amber-900 font-medium px-2 py-0.5 rounded transition-colors"
            >
              End Impersonation
            </button>
          </div>
        )}
        {/* P-ONB40: amber nudge bar for stuck pharmacy admins >48hr post-approval with no routes */}
        {user?.role === 'pharmacy_admin' && user?.orgId && <OnboardingNudgeBar orgId={user.orgId} />}
        {user?.role === 'pharmacy_admin' && <OnboardingChecklist />}
        {children}
      </main>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      {showWarning && <IdleWarningModal countdown={countdown} onExtend={extendSession} />}
    </div>
  );
}
