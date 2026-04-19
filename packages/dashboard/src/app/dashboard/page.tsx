'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { Badge } from '@/components/ui/Badge';
import { DepotFilter } from '@/components/ui/DepotFilter';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { Package, Truck, CheckCircle, Calendar, RefreshCw, Plus, Map, Activity, AlertCircle, Circle } from 'lucide-react';

interface OnboardingStatus { hasDepot: boolean; hasDriver: boolean; hasPlan: boolean; hasCompletedStop: boolean; }

const ONBOARDING_STEPS = [
  { key: 'hasDepot',        label: 'Add your depot',             href: '/dashboard/settings' },
  { key: 'hasDriver',       label: 'Invite your first driver',   href: '/dashboard/drivers' },
  { key: 'hasPlan',         label: 'Create a delivery route',    href: '/dashboard/plans' },
  { key: 'hasCompletedStop',label: 'Complete your first delivery', href: '/dashboard/stops' },
] as const;

function OnboardingBanner({ orgId }: { orgId: string }) {
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [dismissed, setDismissed] = useState(() =>
    typeof window !== 'undefined' && localStorage.getItem(`onboarding_done_${orgId}`) === '1'
  );

  useEffect(() => {
    if (dismissed) return;
    api.get<OnboardingStatus>('/pharmacy/onboarding-status')
      .then(s => {
        if (s.hasDepot && s.hasDriver && s.hasPlan && s.hasCompletedStop) {
          localStorage.setItem(`onboarding_done_${orgId}`, '1');
          setDismissed(true);
        } else {
          setStatus(s);
        }
      })
      .catch(() => {});
  }, [orgId, dismissed]);

  if (dismissed || !status) return null;

  const done = ONBOARDING_STEPS.filter(s => status[s.key]).length;
  const remaining = ONBOARDING_STEPS.filter(s => !status[s.key]);

  return (
    <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-blue-900">Setup — {done}/{ONBOARDING_STEPS.length} complete</span>
        <div className="flex items-center gap-2">
          <div className="w-28 h-1.5 bg-blue-100 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${(done / ONBOARDING_STEPS.length) * 100}%` }} />
          </div>
          <span className="text-xs text-blue-400">{Math.round((done / ONBOARDING_STEPS.length) * 100)}%</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {remaining.map(step => (
          <Link key={step.key} href={step.href}
            className="flex items-center gap-1.5 text-xs text-blue-700 bg-white border border-blue-100 px-2.5 py-1.5 rounded-lg hover:bg-blue-600 hover:text-white hover:border-blue-600 transition-colors">
            <Circle size={10} /> {step.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
import { localDateStr } from '@/lib/dateUtils';

interface Plan { id: string; date: string; status: string; depotId: string; }
interface Route { id: string; driverId: string | null; status: string; stopOrder: string[]; estimatedDuration: number | null; stops: Stop[]; }
interface Stop { id: string; status: string; routeId: string; }
interface DashboardSummary { stopsToday: number; completedToday: number; inProgressToday: number; activeDrivers: number; }
interface DriverStatus {
  id: string;
  name: string;
  status: 'available' | 'on_route' | 'offline';
  vehicleType: string;
  routeId: string | null;
  routeStatus: string | null;
  totalStops: number;
  completedStops: number;
}

interface PlanWithRoutes extends Plan { routes: Route[]; }

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function CommandCenter() {
  const [plans, setPlans] = useState<PlanWithRoutes[]>([]);
  const [stops, setStops] = useState<Stop[]>([]);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [driversList, setDriversList] = useState<DriverStatus[]>([]);
  const [driversLoading, setDriversLoading] = useState(true);
  const [driversError, setDriversError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [depotId, setDepotId] = useState('');
  const [user] = useState(getUser);
  // P-PERF9: single combined timer (30s) replaces 3 independent timers (summaryTimer 60s + driversTimer 30s + plansTimer 60s)
  const combinedTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadCombined = useCallback(async (isRefresh = false) => {
    if (!user) return;
    if (isRefresh) setRefreshing(true);
    else if (!summary) { setLoading(true); setSummaryLoading(true); setDriversLoading(true); }
    setError('');
    try {
      const params = new URLSearchParams({ date: localDateStr() });
      if (depotId) params.set('depotId', depotId);
      const data = await api.get<{ summary: DashboardSummary; drivers: DriverStatus[]; plans: PlanWithRoutes[] }>(
        `/orgs/${user.orgId}/dashboard/combined?${params}`
      );
      setSummary(data.summary);
      setSummaryError(false);
      setDriversList(data.drivers);
      setDriversError(false);
      setPlans(data.plans);
      setStops(data.plans.flatMap(p => p.routes.flatMap(r => r.stops)));
    } catch {
      setSummaryError(true);
      setDriversError(true);
      setError('Failed to load dashboard data');
    } finally {
      setLoading(false);
      setSummaryLoading(false);
      setDriversLoading(false);
      setRefreshing(false);
    }
  }, [user, depotId, summary]);

  useEffect(() => {
    loadCombined();
    combinedTimer.current = setInterval(() => loadCombined(), 30_000);
    return () => { if (combinedTimer.current) clearInterval(combinedTimer.current); };
  }, [loadCombined]);

  const handleRefresh = () => loadCombined(true);
  // Keep legacy loaders as no-ops for retry buttons (they now call loadCombined)
  const loadSummary = () => loadCombined();
  const loadDrivers = () => loadCombined();

  const completedStops = stops.filter(s => s.status === 'completed').length;
  const failedStops = stops.filter(s => s.status === 'failed').length;
  const rescheduledStops = stops.filter(s => s.status === 'rescheduled').length;
  const pendingStops = stops.length - completedStops - failedStops - rescheduledStops;
  const completionPct = stops.length > 0 ? Math.round((completedStops / stops.length) * 100) : 0;

  const kpis = [
    {
      label: 'Stops Today',
      value: summary?.stopsToday ?? 0,
      icon: Package,
      valueColor: 'text-gray-900',
      bg: 'bg-white',
      iconBg: 'bg-gray-100',
      iconColor: 'text-gray-600',
    },
    {
      label: 'Completed',
      value: summary?.completedToday ?? 0,
      icon: CheckCircle,
      valueColor: 'text-emerald-700',
      bg: 'bg-emerald-50',
      iconBg: 'bg-emerald-100',
      iconColor: 'text-emerald-600',
    },
    {
      label: 'In Progress',
      value: summary?.inProgressToday ?? 0,
      icon: Activity,
      valueColor: 'text-blue-700',
      bg: 'bg-blue-50',
      iconBg: 'bg-blue-100',
      iconColor: 'text-blue-600',
    },
    {
      label: 'Active Drivers',
      value: summary?.activeDrivers ?? 0,
      icon: Truck,
      valueColor: 'text-violet-700',
      bg: 'bg-violet-50',
      iconBg: 'bg-violet-100',
      iconColor: 'text-violet-600',
    },
  ];

  const dateLabel = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      {user?.role === 'pharmacy_admin' && user.orgId && <OnboardingBanner orgId={user.orgId} />}
      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900 leading-tight" style={{ fontFamily: 'var(--font-sora)' }}>
            {getGreeting()} — here&apos;s today&apos;s operation
          </h1>
          <p className="text-gray-400 text-sm mt-1">{dateLabel}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <DepotFilter value={depotId} onChange={(id) => setDepotId(id)} />
          <Link
            href="/dashboard/map"
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors border border-gray-200"
          >
            <Map size={14} /> Live Map
          </Link>
          <button
            onClick={handleRefresh}
            disabled={loading || refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50 border border-gray-200"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {/* KPI cards */}
      {summaryError && !summaryLoading && (
        <div className="flex items-center gap-2 px-4 py-2 mb-3 bg-amber-50 border border-amber-100 rounded-xl text-xs text-amber-700">
          <AlertCircle size={12} />
          <span>Could not refresh KPI data — showing last known values</span>
          <button onClick={loadSummary} className="ml-auto underline hover:no-underline">Retry</button>
        </div>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {summaryLoading ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          kpis.map(({ label, value, icon: Icon, valueColor, bg, iconBg, iconColor }) => (
            <div key={label} className={`${bg} rounded-2xl border border-gray-100 shadow-sm p-4 text-center hover:shadow-md transition-shadow`}>
              <div className={`w-9 h-9 ${iconBg} rounded-xl flex items-center justify-center mx-auto mb-3`}>
                <Icon size={16} className={iconColor} />
              </div>
              <p className={`text-3xl font-bold ${valueColor}`} style={{ fontFamily: 'var(--font-sora)' }}>{value}</p>
              <p className="text-xs text-gray-500 mt-1 font-medium">{label}</p>
            </div>
          ))
        )}
      </div>

      {/* Fleet status */}
      {!driversLoading && (
        <div className="mb-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
            <Truck size={14} className="text-gray-400" /> Fleet Status
          </h2>
          {driversError && (
            <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-600">
              <AlertCircle size={14} />
              <span>Fleet data unavailable</span>
              <button onClick={loadDrivers} className="ml-auto text-xs underline hover:no-underline">Retry</button>
            </div>
          )}
          {!driversError && driversList.length === 0 && (
            <p className="text-xs text-gray-400 italic px-1">No drivers registered yet. <Link href="/dashboard/drivers" className="underline hover:no-underline">Add a driver</Link> to see fleet status here.</p>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {driversList.map(d => {
              const dotColor = d.status === 'on_route' ? 'bg-emerald-400' : d.status === 'available' ? 'bg-amber-400' : 'bg-gray-300';
              const pct = d.totalStops > 0 ? Math.round((d.completedStops / d.totalStops) * 100) : 0;
              return (
                <Link
                  key={d.id}
                  href={`/dashboard/drivers/${d.id}`}
                  className="bg-white rounded-xl border border-gray-100 shadow-sm p-3 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-center gap-2 mb-2 min-w-0">
                    <span className={`w-2 h-2 rounded-full ${dotColor} shrink-0`} />
                    <span className="text-sm font-semibold text-gray-900 truncate">{d.name}</span>
                  </div>
                  {d.routeId ? (
                    <>
                      <p className="text-xs text-gray-500 mb-1.5">{d.completedStops}/{d.totalStops} stops</p>
                      <div className="w-full bg-gray-100 rounded-full h-1">
                        <div className="bg-[#00B8A9] h-1 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-gray-400 italic">No route today</p>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Progress bar */}
      {!loading && stops.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 mb-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-gray-600">Delivery progress</span>
            <span className="text-xs font-semibold text-gray-500">{completionPct}%</span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-2 mb-2">
            <div className="flex h-2 rounded-full overflow-hidden">
              <div className="bg-[#2ECC71] h-2 transition-all duration-500" style={{ width: `${(completedStops / stops.length) * 100}%` }} />
              <div className="bg-red-400 h-2 transition-all duration-500" style={{ width: `${(failedStops / stops.length) * 100}%` }} />
              <div className="bg-amber-400 h-2 transition-all duration-500" style={{ width: `${(rescheduledStops / stops.length) * 100}%` }} />
            </div>
          </div>
          <div className="flex items-center gap-4 text-xs text-gray-400 flex-wrap">
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#2ECC71] inline-block" />{completedStops} completed</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" />{failedStops} failed</span>
            {rescheduledStops > 0 && <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />{rescheduledStops} rescheduled</span>}
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-gray-200 inline-block" />{pendingStops} remaining</span>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 bg-red-50 text-red-700 rounded-lg px-4 py-3 text-sm mb-4 border border-red-100">
          <AlertCircle size={14} className="shrink-0" />
          <span>{error}</span>
          <button onClick={() => load()} className="ml-auto underline hover:no-underline text-xs shrink-0">Retry</button>
        </div>
      )}

      {/* Today's Plans */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-700">Today&apos;s Plans</h2>
          <Link href="/dashboard/plans/new" className="flex items-center gap-1 text-xs text-[#0F4C81] hover:underline font-medium">
            <Plus size={12} /> New Plan
          </Link>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2].map(i => <div key={i} className="h-20 bg-white rounded-xl border border-gray-100 animate-pulse" />)}
          </div>
        ) : plans.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-10 text-center">
            <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Calendar size={22} className="text-[#0F4C81]" />
            </div>
            <p className="font-semibold text-gray-700 mb-1">No plans for today{depotId ? ' for this depot' : ''}</p>
            <p className="text-gray-400 text-sm mb-4">Create a delivery plan to get drivers on the road.</p>
            <Link
              href="/dashboard/plans/new"
              className="inline-flex items-center gap-2 bg-[#0F4C81] text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-[#0d3d69] transition-colors"
            >
              <Plus size={14} /> Create Today&apos;s Plan
            </Link>
          </div>
        ) : (
          <>
            {/* Desktop: plan cards */}
            <div className="space-y-3">
              {plans.map(plan => {
                const planStops = plan.routes.flatMap(r => r.stops);
                const planCompleted = planStops.filter(s => s.status === 'completed').length;
                const pct = planStops.length > 0 ? Math.round((planCompleted / planStops.length) * 100) : 0;
                return (
                  <Link
                    key={plan.id}
                    href={`/dashboard/plans/${plan.id}`}
                    className="block bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3.5 hover:shadow-md transition-shadow group"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-gray-900 group-hover:text-[#0F4C81] transition-colors">{plan.date}</span>
                        {plan.routes.length > 0 && (
                          <span className="text-xs text-gray-400">·</span>
                        )}
                        {plan.routes.length > 0 && (
                          <span className="text-xs text-gray-500">{plan.routes.length} routes</span>
                        )}
                      </div>
                      <Badge status={plan.status} />
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-500 mb-2.5">
                      <span className="flex items-center gap-1"><Truck size={11} />{plan.routes.length} driver{plan.routes.length !== 1 ? 's' : ''}</span>
                      <span>·</span>
                      <span className="flex items-center gap-1"><Package size={11} />{planStops.length} stop{planStops.length !== 1 ? 's' : ''}</span>
                      {planStops.length > 0 && <><span>·</span><span className="font-medium text-gray-600">{pct}% complete</span></>}
                    </div>
                    {planStops.length > 0 ? (
                      <div className="w-full bg-gray-100 rounded-full h-1.5">
                        <div className="bg-[#00B8A9] h-1.5 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400 italic">No routes yet — open plan to assign drivers</p>
                    )}
                  </Link>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
