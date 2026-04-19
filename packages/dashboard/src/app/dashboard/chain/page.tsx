'use client';
import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { Building2, TrendingUp, Truck, Users, AlertCircle, ChevronRight } from 'lucide-react';
import Link from 'next/link';

interface LocationKpi {
  orgId: string;
  name: string;
  timezone: string;
  stopsToday: number;
  activeRoutes: number;
  driverCount: number;
  completedToday: number;
  completionRate: number | null;
}

interface ChainSummary {
  totalStopsToday: number;
  activeRoutes: number;
  completionRate: number | null;
  locationCount: number;
}

interface ChainInfo {
  id: string;
  name: string;
}

interface DashboardData {
  chain: ChainInfo | null;
  locations: LocationKpi[];
  summary: ChainSummary;
}

export default function ChainDashboardPage() {
  const [user] = useState(getUser);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.get<DashboardData>('/chain/dashboard');
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load chain dashboard');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-64">
        <div className="animate-pulse text-gray-400 text-sm">Loading chain dashboard…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-100 rounded-xl p-6 text-center">
          <AlertCircle size={24} className="text-red-400 mx-auto mb-2" />
          <p className="text-red-700 font-medium text-sm">{error}</p>
          <button onClick={load} className="mt-3 text-sm text-red-600 underline">Retry</button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { chain, locations, summary } = data;

  const completionColor = (rate: number | null) => {
    if (rate === null) return 'text-gray-400';
    if (rate >= 90) return 'text-green-600';
    if (rate >= 70) return 'text-amber-600';
    return 'text-red-600';
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900" style={{ fontFamily: 'var(--font-sora)' }}>
          {chain ? chain.name : 'Chain Dashboard'}
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">{summary.locationCount} location{summary.locationCount !== 1 ? 's' : ''} · Today&apos;s operations</p>
      </div>

      {/* Chain Summary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Stops Today', value: summary.totalStopsToday, icon: <Truck size={18} className="text-[#0F4C81]" /> },
          { label: 'Active Routes', value: summary.activeRoutes, icon: <TrendingUp size={18} className="text-green-600" /> },
          { label: 'Locations', value: summary.locationCount, icon: <Building2 size={18} className="text-purple-600" /> },
          {
            label: 'Completion Rate',
            value: summary.completionRate !== null ? `${summary.completionRate}%` : '—',
            icon: <Users size={18} className="text-amber-600" />,
          },
        ].map(kpi => (
          <div key={kpi.label} className="bg-white rounded-xl border border-gray-100 p-4 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              {kpi.icon}
              <span className="text-xs font-medium text-gray-500">{kpi.label}</span>
            </div>
            <span className="text-2xl font-bold text-gray-900">{kpi.value}</span>
          </div>
        ))}
      </div>

      {/* Location Cards */}
      <div>
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Locations</h2>
        {locations.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-gray-400 text-sm">
            No locations found in this chain.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {locations.map(loc => (
              <Link
                key={loc.orgId}
                href={`/dashboard?orgId=${loc.orgId}`}
                className="group bg-white rounded-xl border border-gray-100 hover:border-[#0F4C81]/30 hover:shadow-sm p-5 flex flex-col gap-3 transition-all"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Building2 size={16} className="text-gray-400 group-hover:text-[#0F4C81] transition-colors" />
                    <span className="font-semibold text-gray-800 text-sm truncate">{loc.name}</span>
                  </div>
                  <ChevronRight size={14} className="text-gray-300 group-hover:text-[#0F4C81] transition-colors shrink-0" />
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-gray-50 rounded-lg p-2.5">
                    <p className="text-gray-400 mb-0.5">Stops Today</p>
                    <p className="font-bold text-gray-800">{loc.stopsToday}</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-2.5">
                    <p className="text-gray-400 mb-0.5">Active Routes</p>
                    <p className="font-bold text-gray-800">{loc.activeRoutes}</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-2.5">
                    <p className="text-gray-400 mb-0.5">Drivers</p>
                    <p className="font-bold text-gray-800">{loc.driverCount}</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-2.5">
                    <p className="text-gray-400 mb-0.5">Completion</p>
                    <p className={`font-bold ${completionColor(loc.completionRate)}`}>
                      {loc.completionRate !== null ? `${loc.completionRate}%` : '—'}
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
