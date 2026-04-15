'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { Badge } from '@/components/ui/Badge';
import { DepotFilter } from '@/components/ui/DepotFilter';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { Package, Truck, CheckCircle, Calendar, RefreshCw, Plus, Map, TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface Plan { id: string; date: string; status: string; depotId: string; }
interface Route { id: string; driverId: string; status: string; stopOrder: string[]; estimatedDuration: number | null; }
interface Driver { id: string; name: string; status: string; }
interface Stop { id: string; status: string; routeId: string; }

interface PlanWithRoutes extends Plan { routes: Route[]; }

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function TrendIcon({ value, prev }: { value: number; prev: number }) {
  if (value > prev) return <TrendingUp size={12} className="text-emerald-500" />;
  if (value < prev) return <TrendingDown size={12} className="text-red-400" />;
  return <Minus size={12} className="text-gray-300" />;
}

export default function CommandCenter() {
  const [plans, setPlans] = useState<PlanWithRoutes[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [stops, setStops] = useState<Stop[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [depotId, setDepotId] = useState('');
  const [user] = useState(getUser);
  const today = new Date().toISOString().split('T')[0];

  const load = useCallback(async (isRefresh = false) => {
    if (!user) return;
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ date: today });
      if (depotId) params.set('depotId', depotId);

      const [todayPlans, allDrivers] = await Promise.all([
        api.get<Plan[]>(`/orgs/${user.orgId}/plans?${params}`),
        api.get<Driver[]>(`/orgs/${user.orgId}/drivers`),
      ]);
      setDrivers(allDrivers);

      const plansWithRoutes = await Promise.all(
        todayPlans.map(async (plan) => {
          const routes = await api.get<Route[]>(`/plans/${plan.id}/routes`);
          return { ...plan, routes };
        }),
      );
      setPlans(plansWithRoutes);

      const allStops: Stop[] = [];
      for (const plan of plansWithRoutes) {
        for (const route of plan.routes) {
          const routeStops = await api.get<Stop[]>(`/routes/${route.id}/stops`);
          allStops.push(...routeStops);
        }
      }
      setStops(allStops);
    } catch {
      setError('Failed to load dashboard data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user, today, depotId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const allRoutes = plans.flatMap(p => p.routes);
  const completedStops = stops.filter(s => s.status === 'completed').length;
  const failedStops = stops.filter(s => s.status === 'failed').length;
  const activeDrivers = drivers.filter(d => d.status === 'on_route').length;
  const completionPct = stops.length > 0 ? Math.round((completedStops / stops.length) * 100) : 0;

  const kpis = [
    { label: 'Total Stops', value: stops.length, prev: 0, icon: Package, color: 'text-[#0F4C81]', bg: 'bg-blue-50' },
    { label: 'Active Drivers', value: activeDrivers, prev: 0, icon: Truck, color: 'text-[#00B8A9]', bg: 'bg-teal-50' },
    { label: 'Completed', value: completedStops, prev: 0, icon: CheckCircle, color: 'text-[#2ECC71]', bg: 'bg-emerald-50' },
    { label: "Today's Plans", value: plans.length, prev: 0, icon: Calendar, color: 'text-[#F6A623]', bg: 'bg-amber-50' },
  ];

  const dateLabel = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900 leading-tight" style={{ fontFamily: 'var(--font-sora)' }}>
            {getGreeting()} — here&apos;s today&apos;s operation
          </h1>
          <p className="text-gray-400 text-sm mt-1">{dateLabel}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <DepotFilter value={depotId} onChange={setDepotId} />
          <Link
            href="/dashboard/map"
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors border border-gray-200"
          >
            <Map size={14} /> Live Map
          </Link>
          <button
            onClick={() => load(true)}
            disabled={loading || refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50 border border-gray-200"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          kpis.map(({ label, value, prev, icon: Icon, color, bg }) => (
            <div key={label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between mb-3">
                <div className={`w-8 h-8 ${bg} rounded-lg flex items-center justify-center`}>
                  <Icon size={15} className={color} />
                </div>
                <div className="flex items-center gap-1 text-xs text-gray-400">
                  <TrendIcon value={value} prev={prev} />
                </div>
              </div>
              <div className={`text-2xl font-bold ${color} mb-0.5`} style={{ fontFamily: 'var(--font-sora)' }}>
                {value}
              </div>
              <div className="text-xs text-gray-500">{label}</div>
            </div>
          ))
        )}
      </div>

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
            </div>
          </div>
          <div className="flex items-center gap-4 text-xs text-gray-400">
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#2ECC71] inline-block" />{completedStops} completed</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" />{failedStops} failed</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-gray-200 inline-block" />{stops.length - completedStops - failedStops} remaining</span>
          </div>
        </div>
      )}

      {error && <div className="bg-red-50 text-red-700 rounded-lg px-4 py-3 text-sm mb-4 border border-red-100">{error}</div>}

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
                const planStops = stops.filter(s => plan.routes.some(r => r.id === s.routeId));
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
                          <span className="text-xs text-gray-500">{allRoutes.filter(r => plan.routes.some(pr => pr.id === r.id)).length} routes</span>
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
