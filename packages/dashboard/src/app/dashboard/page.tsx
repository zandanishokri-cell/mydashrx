'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { RouteCard } from '@/components/RouteCard';
import { Package, Truck, CheckCircle, AlertCircle, RefreshCw } from 'lucide-react';
import type { Plan } from '@mydash-rx/shared';

interface RouteWithDriver {
  id: string;
  driverId: string;
  driverName: string;
  status: 'pending' | 'active' | 'completed';
  stopOrder: string[];
  completedCount: number;
  estimatedDuration: number | null;
}

export default function CommandCenter() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [routes, setRoutes] = useState<RouteWithDriver[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const user = getUser();
  const today = new Date().toISOString().split('T')[0];

  const load = async () => {
    if (!user) return;
    setLoading(true);
    setError('');
    try {
      const todayPlans = await api.get<Plan[]>(
        `/orgs/${user.orgId}/plans?date=${today}`,
      );
      setPlans(todayPlans);
    } catch (e) {
      setError('Failed to load dashboard data');
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const totalStops = routes.reduce((s, r) => s + r.stopOrder.length, 0);
  const completedStops = routes.reduce((s, r) => s + r.completedCount, 0);
  const activeDrivers = routes.filter((r) => r.status === 'active').length;

  const kpis = [
    { label: 'Total Stops', value: totalStops, icon: Package, color: 'text-[#0F4C81]' },
    { label: 'Active Drivers', value: activeDrivers, icon: Truck, color: 'text-[#00B8A9]' },
    { label: 'Completed', value: completedStops, icon: CheckCircle, color: 'text-[#2ECC71]' },
    { label: 'Plans Today', value: plans.length, icon: AlertCircle, color: 'text-[#F6A623]' },
  ];

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900" style={{ fontFamily: 'var(--font-sora)' }}>
            Command Center
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            {new Date().toLocaleDateString('en-US', {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
            })}
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {kpis.map(({ label, value, icon: Icon, color }) => (
          <div
            key={label}
            className="bg-white rounded-xl border border-gray-100 p-4"
          >
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

      {error && (
        <div className="bg-red-50 text-red-700 rounded-lg px-4 py-3 text-sm mb-4">
          {error}
        </div>
      )}

      {/* Routes */}
      <div>
        <h2 className="text-sm font-semibold text-gray-700 mb-3">
          Today&apos;s Routes
        </h2>
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-20 bg-white rounded-xl border border-gray-100 animate-pulse"
              />
            ))}
          </div>
        ) : routes.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 p-8 text-center">
            <p className="text-gray-400 text-sm">No routes planned for today.</p>
            <a
              href="/dashboard/plans/new"
              className="text-[#0F4C81] text-sm font-medium hover:underline mt-1 block"
            >
              Create a plan →
            </a>
          </div>
        ) : (
          <div className="space-y-3">
            {routes.map((r) => (
              <RouteCard
                key={r.id}
                driverName={r.driverName}
                stopCount={r.stopOrder.length}
                completedCount={r.completedCount}
                estimatedDuration={r.estimatedDuration}
                status={r.status}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
