'use client';
import { useEffect, useState, useCallback } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { DepotFilter } from '@/components/ui/DepotFilter';
import { TrendingUp, TrendingDown, Download } from 'lucide-react';

interface AnalyticsData {
  summary: {
    total: number; completed: number; failed: number;
    successRate: number; failureRate: number; avgPerDriver: number; activeDriverCount: number;
  };
  daily: { date: string; total: number; completed: number; failed: number }[];
  failureReasons: { reason: string; count: number }[];
  drivers: { driverId: string; driverName: string; total: number; completed: number; failed: number }[];
  depots: { depotId: string; depotName: string; total: number; completed: number }[];
}

const PRESET_RANGES = [
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
];

const PIE_COLORS = ['#0F4C81', '#00B8A9', '#F6A623', '#ef4444', '#8b5cf6', '#6b7280'];

function StatCard({ label, value, sub, up }: { label: string; value: string | number; sub?: string; up?: boolean }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <div className="flex items-end gap-2">
        <span className="text-2xl font-bold text-gray-900" style={{ fontFamily: 'var(--font-sora)' }}>{value}</span>
        {sub && (
          <span className={`text-xs mb-0.5 flex items-center gap-0.5 ${up ? 'text-emerald-600' : 'text-red-500'}`}>
            {up ? <TrendingUp size={10} /> : <TrendingDown size={10} />} {sub}
          </span>
        )}
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  const user = getUser();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [depotId, setDepotId] = useState('');
  const [range, setRange] = useState('Last 7 days');

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const preset = PRESET_RANGES.find(r => r.label === range)!;
      const from = new Date(Date.now() - preset.days * 86400000).toISOString().split('T')[0];
      const params = new URLSearchParams({ from });
      if (depotId) params.set('depotId', depotId);
      const result = await api.get<AnalyticsData>(`/orgs/${user.orgId}/analytics?${params}`);
      setData(result);
    } catch { setData(null); }
    finally { setLoading(false); }
  }, [user, depotId, range]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const exportCsv = () => {
    if (!data) return;
    const rows = data.daily.map(d => [d.date, d.total, d.completed, d.failed]);
    const csv = [['Date', 'Total', 'Completed', 'Failed'], ...rows].map(r => r.join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `analytics-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900" style={{ fontFamily: 'var(--font-sora)' }}>Analytics</h1>
        <div className="flex items-center gap-2">
          <DepotFilter value={depotId} onChange={setDepotId} />
          <select
            value={range}
            onChange={e => setRange(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white text-gray-700"
          >
            {PRESET_RANGES.map(r => <option key={r.label}>{r.label}</option>)}
          </select>
          <button onClick={exportCsv} className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600">
            <Download size={14} /> Export data
          </button>
        </div>
      </div>

      {loading || !data ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => <div key={i} className="h-24 bg-white rounded-xl border border-gray-100 animate-pulse" />)}
        </div>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Attempts today" value={data.summary.total} />
            <StatCard label="Success rate" value={`${data.summary.successRate}%`} up={data.summary.successRate >= 95} sub={data.summary.successRate >= 95 ? 'Good' : 'Needs attention'} />
            <StatCard label="Failed attempts" value={data.summary.failed} up={false} />
            <StatCard label="Avg per driver" value={data.summary.avgPerDriver} />
          </div>

          {/* Attempts volume chart */}
          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Attempts volume</h2>
            {data.daily.length === 0 ? (
              <div className="flex items-center justify-center h-40 text-gray-400 text-sm">No data for this period</div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={data.daily} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={d => d.slice(5)} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip labelFormatter={l => `Date: ${l}`} />
                  <Line type="monotone" dataKey="total" stroke="#0F4C81" strokeWidth={2} dot={false} name="Total" />
                  <Line type="monotone" dataKey="completed" stroke="#00B8A9" strokeWidth={2} dot={false} name="Completed" />
                  <Line type="monotone" dataKey="failed" stroke="#ef4444" strokeWidth={2} dot={false} name="Failed" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Failure reasons */}
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-4">Failed delivery reasons</h2>
              {data.failureReasons.length === 0 ? (
                <div className="flex items-center justify-center h-40 text-gray-400 text-sm">No failures in this period</div>
              ) : (
                <div className="flex items-center gap-4">
                  <ResponsiveContainer width="50%" height={160}>
                    <PieChart>
                      <Pie data={data.failureReasons} dataKey="count" nameKey="reason" cx="50%" cy="50%" outerRadius={60} innerRadius={35}>
                        {data.failureReasons.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex-1 space-y-1.5">
                    {data.failureReasons.map((r, i) => (
                      <div key={r.reason} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5">
                          <div className="w-2.5 h-2.5 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                          <span className="text-gray-600 capitalize">{r.reason}</span>
                        </div>
                        <span className="text-gray-900 font-medium">{r.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Depot breakdown */}
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-4">By pharmacy</h2>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {data.depots.length === 0 ? (
                  <p className="text-gray-400 text-sm text-center py-8">No data</p>
                ) : data.depots.map(d => {
                  const rate = d.total > 0 ? Math.round((d.completed / d.total) * 100) : 0;
                  return (
                    <div key={d.depotId ?? d.depotName} className="flex items-center gap-3">
                      <span className="text-xs text-gray-600 w-44 truncate">{d.depotName ?? 'Unknown'}</span>
                      <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                        <div className="bg-[#00B8A9] h-1.5 rounded-full transition-all" style={{ width: `${rate}%` }} />
                      </div>
                      <span className="text-xs text-gray-500 w-16 text-right">{d.completed}/{d.total}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Driver performance */}
          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Driver performance</h2>
            {data.drivers.length === 0 ? (
              <p className="text-gray-400 text-sm text-center py-8">No data</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left py-2 text-xs font-semibold text-gray-500">Driver</th>
                      <th className="text-right py-2 text-xs font-semibold text-gray-500">Total</th>
                      <th className="text-right py-2 text-xs font-semibold text-gray-500">Completed</th>
                      <th className="text-right py-2 text-xs font-semibold text-gray-500">Failed</th>
                      <th className="text-right py-2 text-xs font-semibold text-gray-500">Success rate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {data.drivers.map(d => (
                      <tr key={d.driverId ?? d.driverName} className="hover:bg-gray-50">
                        <td className="py-2.5 text-gray-900 font-medium">{d.driverName ?? 'Unknown'}</td>
                        <td className="py-2.5 text-right text-gray-600">{d.total}</td>
                        <td className="py-2.5 text-right text-emerald-600">{d.completed}</td>
                        <td className="py-2.5 text-right text-red-500">{d.failed}</td>
                        <td className="py-2.5 text-right">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                            d.total > 0 && (d.completed / d.total) >= 0.95
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-red-50 text-red-600'
                          }`}>
                            {d.total > 0 ? `${Math.round((d.completed / d.total) * 100)}%` : '—'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
