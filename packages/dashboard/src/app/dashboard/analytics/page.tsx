'use client';
import { useEffect, useState, useCallback } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, BarChart, Bar,
} from 'recharts';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { DepotFilter } from '@/components/ui/DepotFilter';
import { DateRangePicker, type DateRange } from '@/components/ui/DateRangePicker';
import { TrendingUp, TrendingDown, Download, Award, Lightbulb } from 'lucide-react';

interface DriverStat { driverId: string; driverName: string; total: number; completed: number; failed: number; completionRate?: number; }

interface AnalyticsData {
  summary: {
    total: number; completed: number; failed: number;
    successRate: number; failureRate: number; avgPerDriver: number; activeDriverCount: number;
  };
  daily: { date: string; total: number; completed: number; failed: number }[];
  failureReasons: { reason: string; count: number }[];
  drivers: DriverStat[];
  depots: { depotId: string; depotName: string; total: number; completed: number }[];
  topPerformers: DriverStat[];
  weekOverWeekChange: number | null;
  avgDeliveryTime: number | null;
  onTimeRate: number | null;
}

const defaultRange = (): DateRange => {
  const to = new Date().toISOString().split('T')[0];
  const from = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
  return { from, to };
};

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
  const [user] = useState(getUser);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [depotId, setDepotId] = useState('');
  const [dateRange, setDateRange] = useState<DateRange>(defaultRange);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (dateRange.from) params.set('from', dateRange.from);
      if (dateRange.to) params.set('to', dateRange.to);
      if (depotId) params.set('depotId', depotId);
      const result = await api.get<AnalyticsData>(`/orgs/${user.orgId}/analytics?${params}`);
      setData(result);
    } catch { setData(null); }
    finally { setLoading(false); }
  }, [user, depotId, dateRange]); // eslint-disable-line react-hooks/exhaustive-deps

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
          <DateRangePicker
            value={dateRange}
            onChange={setDateRange}
            presets={['7d', '30d', '90d', 'custom']}
          />
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
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <p className="text-xs text-gray-500 mb-1">Total stops</p>
              <div className="flex items-end gap-2">
                <span className="text-2xl font-bold text-gray-900" style={{ fontFamily: 'var(--font-sora)' }}>{data.summary.total}</span>
                {data.weekOverWeekChange !== null && (
                  <span className={`text-xs mb-0.5 flex items-center gap-0.5 font-medium px-1.5 py-0.5 rounded-full ${
                    data.weekOverWeekChange >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'
                  }`}>
                    {data.weekOverWeekChange >= 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                    {data.weekOverWeekChange >= 0 ? '+' : ''}{data.weekOverWeekChange}% vs prior period
                  </span>
                )}
              </div>
            </div>
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

          {/* Driver completion rate bar chart */}
          {data.drivers.length > 0 && (() => {
            const chartData = data.drivers
              .filter(d => d.total > 0)
              .map(d => ({ driverName: d.driverName ?? 'Unknown', completionRate: Math.round((d.completed / d.total) * 100) }))
              .sort((a, b) => b.completionRate - a.completionRate)
              .slice(0, 10);
            return (
              <div className="bg-white rounded-xl border border-gray-100 p-6">
                <h2 className="text-sm font-semibold text-gray-700 mb-4">Completion rate by driver (top 10)</h2>
                <ResponsiveContainer width="100%" height={Math.max(chartData.length * 36, 120)}>
                  <BarChart layout="vertical" data={chartData} margin={{ left: 100 }}>
                    <XAxis type="number" domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 11 }} />
                    <YAxis dataKey="driverName" type="category" width={100} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v) => [`${Number(v)}%`, 'Completion rate']} />
                    <Bar dataKey="completionRate" fill="#0F4C81" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            );
          })()}

          {/* Top Performing Drivers */}
          {data.topPerformers?.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 p-6">
              <div className="flex items-center gap-2 mb-4">
                <Award size={16} className="text-[#F6A623]" />
                <h2 className="text-sm font-semibold text-gray-700">Top Performing Drivers</h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {data.topPerformers.map((d, i) => {
                  const rate = d.completionRate ?? (d.total > 0 ? Math.round((d.completed / d.total) * 100) : 0);
                  const medals = ['#F6A623', '#9CA3AF', '#CD7F32'];
                  return (
                    <div key={d.driverId ?? d.driverName} className="flex items-center gap-3 p-3 rounded-lg bg-gray-50">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0" style={{ background: medals[i] }}>
                        {i + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{d.driverName ?? 'Unknown'}</p>
                        <p className="text-xs text-gray-500">{d.total} deliveries</p>
                      </div>
                      <div className="text-right shrink-0">
                        <span className={`text-sm font-bold ${rate >= 95 ? 'text-emerald-600' : rate >= 80 ? 'text-[#F6A623]' : 'text-red-500'}`}>
                          {rate}%
                        </span>
                        <div className="flex items-center justify-end gap-0.5 mt-0.5">
                          {rate >= 95 ? <TrendingUp size={11} className="text-emerald-500" /> : <TrendingDown size={11} className="text-red-400" />}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Performance Insights */}
          {(() => {
            const bestDay = data.daily.length > 0
              ? data.daily.reduce((best, d) => d.completed > best.completed ? d : best)
              : null;
            const mostReliable = data.drivers.filter(d => d.total > 0)
              .sort((a, b) => (b.completed / b.total) - (a.completed / a.total))[0];
            const topFailure = data.failureReasons.length > 0
              ? data.failureReasons.reduce((top, r) => r.count > top.count ? r : top)
              : null;
            if (!bestDay && !mostReliable && !topFailure) return null;
            return (
              <div className="bg-white rounded-xl border border-gray-100 p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Lightbulb size={16} className="text-[#00B8A9]" />
                  <h2 className="text-sm font-semibold text-gray-700">Performance Insights</h2>
                </div>
                <div className="space-y-2">
                  {bestDay && (
                    <div className="flex items-start gap-2 text-sm">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#0F4C81] mt-2 shrink-0" />
                      <span className="text-gray-700"><strong>Best day:</strong> {new Date(bestDay.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })} with {bestDay.completed} completed deliveries</span>
                    </div>
                  )}
                  {mostReliable && (
                    <div className="flex items-start gap-2 text-sm">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#00B8A9] mt-2 shrink-0" />
                      <span className="text-gray-700"><strong>Most reliable driver:</strong> {mostReliable.driverName ?? 'Unknown'} ({Math.round((mostReliable.completed / mostReliable.total) * 100)}% completion rate)</span>
                    </div>
                  )}
                  {topFailure && (
                    <div className="flex items-start gap-2 text-sm">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#F6A623] mt-2 shrink-0" />
                      <span className="text-gray-700"><strong>Most common failure reason:</strong> <span className="capitalize">{topFailure.reason}</span> ({topFailure.count} occurrence{topFailure.count !== 1 ? 's' : ''})</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </>
      )}
    </div>
  );
}
