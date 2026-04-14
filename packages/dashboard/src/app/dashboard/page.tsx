'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { RouteCard } from '@/components/RouteCard';
import { Badge } from '@/components/ui/Badge';
import { Package, Truck, CheckCircle, Calendar, RefreshCw, Plus, Map } from 'lucide-react';

interface Plan { id: string; date: string; status: string; }
interface Route { id: string; driverId: string; status: string; stopOrder: string[]; estimatedDuration: number | null; }
interface Driver { id: string; name: string; status: string; }
interface Stop { id: string; status: string; }

interface PlanWithRoutes extends Plan {
  routes: Route[];
}

export default function CommandCenter() {
  const [plans, setPlans] = useState<PlanWithRoutes[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [stops, setStops] = useState<Stop[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const user = getUser();
  const today = new Date().toISOString().split('T')[0];

  const load = async () => {
    if (!user) return;
    setLoading(true);
    setError('');
    try {
      const [todayPlans, allDrivers] = await Promise.all([
        api.get<Plan[]>(`/orgs/${user.orgId}/plans?date=${today}`),
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

      // Load all stops for today's distributed plans
      const allStops: Stop[] = [];
      for (const plan of plansWithRoutes) {
        if (plan.status === 'distributed') {
          for (const route of plan.routes) {
            const routeStops = await api.get<Stop[]>(`/plans/${plan.id}/routes/${route.id}/stops`);
            allStops.push(...routeStops);
          }
        }
      }
      setStops(allStops);
    } catch {
      setError('Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const allRoutes = plans.flatMap((p) => p.routes);
  const completedStops = stops.filter((s) => s.status === 'completed').length;
  const activeDrivers = drivers.filter((d) => d.status === 'on_route').length;

  const kpis = [
    { label: 'Total Stops', value: stops.length, icon: Package, color: 'text-[#0F4C81]' },
    { label: 'Active Drivers', value: activeDrivers, icon: Truck, color: 'text-[#00B8A9]' },
    { label: 'Completed', value: completedStops, icon: CheckCircle, color: 'text-[#2ECC71]' },
    { label: 'Plans Today', value: plans.length, icon: Calendar, color: 'text-[#F6A623]' },
  ];

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900" style={{ fontFamily: 'var(--font-sora)' }}>Command Center</h1>
          <p className="text-gray-500 text-sm mt-1">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/dashboard/map" className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors border border-gray-200">
            <Map size={14} /> Live Map
          </Link>
          <button onClick={load} disabled={loading} className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {kpis.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-100 p-4">
            <div className="flex items-center gap-2 mb-2">
              <Icon size={16} className={color} />
              <span className="text-xs text-gray-500">{label}</span>
            </div>
            <div className={`text-2xl font-bold ${color}`} style={{ fontFamily: 'var(--font-sora)' }}>
              {loading ? '—' : value}
            </div>
          </div>
        ))}
      </div>

      {error && <div className="bg-red-50 text-red-700 rounded-lg px-4 py-3 text-sm mb-4">{error}</div>}

      {/* Today's Plans */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-700">Today&apos;s Plans</h2>
          <Link href="/dashboard/plans/new" className="flex items-center gap-1 text-xs text-[#0F4C81] hover:underline">
            <Plus size={12} /> New Plan
          </Link>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2].map((i) => <div key={i} className="h-20 bg-white rounded-xl border border-gray-100 animate-pulse" />)}
          </div>
        ) : plans.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 p-8 text-center">
            <p className="text-gray-400 text-sm">No plans for today.</p>
            <Link href="/dashboard/plans/new" className="text-[#0F4C81] text-sm font-medium hover:underline mt-1 block">
              Create a plan →
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {plans.map((plan) => (
              <Link key={plan.id} href={`/dashboard/plans/${plan.id}`} className="block bg-white rounded-xl border border-gray-100 px-4 py-3 hover:shadow-sm transition-shadow">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-900">{plan.date}</span>
                  <Badge status={plan.status} />
                </div>
                <div className="space-y-1">
                  {plan.routes.map((route) => (
                    <RouteCard
                      key={route.id}
                      driverName={drivers.find((d) => d.id === route.driverId)?.name ?? 'Driver'}
                      stopCount={route.stopOrder?.length ?? 0}
                      completedCount={0}
                      estimatedDuration={route.estimatedDuration}
                      status={route.status}
                    />
                  ))}
                  {plan.routes.length === 0 && (
                    <p className="text-xs text-gray-400">No routes yet — open plan to assign drivers</p>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
