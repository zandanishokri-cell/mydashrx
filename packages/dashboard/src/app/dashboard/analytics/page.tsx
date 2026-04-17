'use client';
import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { DepotFilter } from '@/components/ui/DepotFilter';
import { DateRangePicker, type DateRange } from '@/components/ui/DateRangePicker';
import { TrendingUp, TrendingDown, Download, Award, Lightbulb, Clock, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';

interface DriverStat { driverId: string; driverName: string; total: number; completed: number; failed: number; completionRate?: number; }

interface AnalyticsData {
  summary: {
    total: number; completed: number; failed: number;
    successRate: number; failureRate: number; avgPerDriver: number; activeDriverCount: number;
    avgDeliveryTime: number | null;
    onTimeRate: number | null;
  };
  daily: { date: string; total: number; completed: number; failed: number; rescheduled: number }[];
  failureReasons: { reason: string; count: number }[];
  drivers: DriverStat[];
  depots: { depotId: string; depotName: string; total: number; completed: number }[];
  topPerformers: DriverStat[];
  weekOverWeekChange: number | null;
}

const localDateStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const defaultRange = (): DateRange => {
  const now = new Date();
  return { from: localDateStr(new Date(now.getTime() - 7 * 86400000)), to: localDateStr(now) };
};

const BAR_COLORS = ['#0F4C81', '#00B8A9', '#F6A623', '#ef4444', '#8b5cf6', '#6b7280'];

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

/** Horizontal bar: pct [0-100], color hex, label left, value right */
function HBar({ label, pct, value, color = '#0F4C81' }: { label: string; pct: number; value: string | number; color?: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-gray-600 w-36 truncate shrink-0">{label}</span>
      <div className="flex-1 bg-gray-100 rounded-full h-2">
        <div className="h-2 rounded-full transition-all" style={{ width: `${Math.min(pct, 100)}%`, background: color }} />
      </div>
      <span className="text-xs text-gray-700 font-medium w-10 text-right shrink-0">{value}</span>
    </div>
  );
}

/** SVG sparkline showing completion rate trend per day */
function TrendSparkline({ data }: { data: { date: string; total: number; completed: number; failed: number; rescheduled: number }[] }) {
  // Use terminal stops only (completed+failed+returned) as denominator
  // so in-progress stops on today's date don't deflate the rate
  const pts = data.filter(d => d.total > 0).slice(-14);
  if (pts.length < 2) return null;
  const rates = pts.map(d => {
    const terminal = d.completed + d.failed + (d.rescheduled ?? 0);
    return terminal > 0 ? (d.completed / terminal) * 100 : 0;
  });
  const avgRate = rates.reduce((s, v) => s + v, 0) / rates.length;
  const trend = rates[rates.length - 1] - rates[0];
  const W = 400, H = 56;
  const xStep = W / (pts.length - 1);
  const coords = rates.map((r, i): [number, number] => [i * xStep, H - (r / 100) * H]);
  const linePath = coords.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]},${p[1]}`).join(' ');
  const areaPath = `${linePath} L${coords[coords.length - 1][0]},${H} L0,${H} Z`;
  const lineColor = avgRate >= 90 ? '#10b981' : avgRate >= 70 ? '#f59e0b' : '#ef4444';
  const areaColor = avgRate >= 90 ? '#d1fae5' : avgRate >= 70 ? '#fef3c7' : '#fee2e2';

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-700">Completion Rate Trend</h2>
        <span className={`text-xs font-medium flex items-center gap-1 ${trend >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
          {trend >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
          {trend >= 0 ? '+' : ''}{Math.round(trend)}pp over period
        </span>
      </div>
      <svg viewBox={`-4 -4 ${W + 8} ${H + 24}`} className="w-full h-20" preserveAspectRatio="none">
        <line x1="0" y1="0" x2={W} y2="0" stroke="#f3f4f6" strokeWidth="1" />
        <line x1="0" y1={H / 2} x2={W} y2={H / 2} stroke="#f3f4f6" strokeWidth="1" strokeDasharray="4 4" />
        <line x1="0" y1={H} x2={W} y2={H} stroke="#f3f4f6" strokeWidth="1" />
        <path d={areaPath} fill={areaColor} fillOpacity="0.6" />
        <path d={linePath} stroke={lineColor} strokeWidth="2.5" fill="none" strokeLinejoin="round" strokeLinecap="round" />
        {coords.map(([cx, cy], i) => (
          <g key={i}>
            <circle cx={cx} cy={cy} r="3.5" fill={rates[i] >= 90 ? '#10b981' : rates[i] >= 70 ? '#f59e0b' : '#ef4444'} stroke="white" strokeWidth="1.5" />
            <text x={cx} y={H + 16} textAnchor="middle" fontSize="9" fill="#9ca3af" fontFamily="monospace">{pts[i].date.slice(5)}</text>
          </g>
        ))}
      </svg>
      <div className="flex items-center gap-4 mt-1 text-xs text-gray-400">
        <span>Avg <strong className="text-gray-600">{Math.round(avgRate)}%</strong></span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full inline-block bg-emerald-400" /> ≥90%</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full inline-block bg-amber-400" /> 70–89%</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full inline-block bg-red-400" /> &lt;70%</span>
      </div>
    </div>
  );
}

/** Vertical grouped bar chart for daily totals */
function DailyBars({ data }: { data: { date: string; total: number; completed: number; failed: number; rescheduled: number }[] }) {
  if (data.length === 0) return <div className="flex items-center justify-center h-40 text-gray-400 text-sm">No data for this period</div>;
  const maxVal = Math.max(...data.map(d => d.total), 1);
  return (
    <div className="overflow-x-auto">
      <div className="flex items-end gap-1 min-w-0 h-40" style={{ minWidth: data.length * 32 }}>
        {data.map(d => {
          const resch = d.rescheduled ?? 0;
          const other = Math.max(0, d.total - d.completed - d.failed - resch);
          return (
            <div key={d.date} className="flex flex-col items-center gap-0.5 flex-1 min-w-[28px]">
              <div className="w-full flex items-end gap-px" style={{ height: 120 }}>
                <div className="flex-1 rounded-t transition-all" style={{ height: `${(d.completed / maxVal) * 100}%`, background: '#00B8A9', minHeight: d.completed > 0 ? 2 : 0 }} title={`Completed: ${d.completed}`} />
                <div className="flex-1 rounded-t transition-all" style={{ height: `${(d.failed / maxVal) * 100}%`, background: '#ef4444', minHeight: d.failed > 0 ? 2 : 0 }} title={`Failed: ${d.failed}`} />
                {resch > 0 && <div className="flex-1 rounded-t transition-all" style={{ height: `${(resch / maxVal) * 100}%`, background: '#f59e0b', minHeight: 2 }} title={`Rescheduled: ${resch}`} />}
                {other > 0 && <div className="flex-1 rounded-t transition-all" style={{ height: `${(other / maxVal) * 100}%`, background: '#d1d5db', minHeight: 2 }} title={`In progress: ${other}`} />}
              </div>
              <span className="text-[9px] text-gray-400 rotate-45 origin-top-left translate-x-1">{d.date.slice(5)}</span>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-4 mt-6 text-xs text-gray-500">
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded-sm bg-[#00B8A9]" /> Completed</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded-sm bg-[#ef4444]" /> Failed</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded-sm bg-[#f59e0b]" /> Rescheduled</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded-sm bg-gray-300" /> In progress</span>
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  const [user] = useState(getUser);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [depotId, setDepotId] = useState('');
  const [dateRange, setDateRange] = useState<DateRange>(defaultRange);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setLoadError(false);
    try {
      const params = new URLSearchParams();
      if (dateRange.from) params.set('from', dateRange.from);
      if (dateRange.to) params.set('to', dateRange.to);
      if (depotId) params.set('depotId', depotId);
      const result = await api.get<AnalyticsData>(`/orgs/${user.orgId}/analytics?${params}`);
      setData(result);
    } catch { setLoadError(true); }
    finally { setLoading(false); }
  }, [user, depotId, dateRange]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const exportCsv = () => {
    if (!data) return;
    const sections: string[] = [];

    // Daily summary
    sections.push('DAILY SUMMARY');
    sections.push(['Date', 'Total', 'Completed', 'Failed', 'Rescheduled'].join(','));
    sections.push(...data.daily.map(d => [d.date, d.total, d.completed, d.failed, d.rescheduled ?? 0].join(',')));

    // Driver breakdown
    sections.push('');
    sections.push('DRIVER BREAKDOWN');
    sections.push(['Driver', 'Total Stops', 'Completed', 'Failed', 'Completion Rate %'].join(','));
    sections.push(...data.drivers.map(d => [
      `"${d.driverName ?? ''}"`,
      d.total, d.completed, d.failed,
      d.total > 0 ? Math.round((d.completed / d.total) * 100) : 0,
    ].join(',')));

    // Failure reasons
    if (data.failureReasons.length > 0) {
      sections.push('');
      sections.push('FAILURE REASONS');
      sections.push(['Reason', 'Count'].join(','));
      sections.push(...data.failureReasons.map(r => [`"${r.reason}"`, r.count].join(',')));
    }

    // Depot breakdown
    if (data.depots.length > 0) {
      sections.push('');
      sections.push('DEPOT BREAKDOWN');
      sections.push(['Depot', 'Total', 'Completed', 'Success Rate %'].join(','));
      sections.push(...data.depots.map(d => [
        `"${d.depotName ?? ''}"`,
        d.total, d.completed,
        d.total > 0 ? Math.round((d.completed / d.total) * 100) : 0,
      ].join(',')));
    }

    const url = URL.createObjectURL(new Blob([sections.join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `analytics-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900" style={{ fontFamily: 'var(--font-sora)' }}>Analytics</h1>
        <div className="flex items-center gap-2">
          <DepotFilter value={depotId} onChange={(id) => setDepotId(id)} />
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

      {loadError ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <AlertCircle size={36} className="text-red-400 mb-3" />
          <p className="text-gray-700 font-medium mb-1">Failed to load analytics</p>
          <p className="text-gray-400 text-sm mb-4">Check your connection and try again.</p>
          <button onClick={load} className="flex items-center gap-2 text-sm bg-[#0F4C81] text-white px-4 py-2 rounded-lg hover:bg-[#0a3d6b]">
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      ) : loading || !data ? (
        <div className="space-y-4 animate-pulse">
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
            {[1,2,3,4,5,6].map(i => <div key={i} className="h-24 bg-gray-100 rounded-xl" />)}
          </div>
          <div className="h-64 bg-gray-100 rounded-xl" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="h-52 bg-gray-100 rounded-xl" />
            <div className="h-52 bg-gray-100 rounded-xl" />
          </div>
          <div className="h-56 bg-gray-100 rounded-xl" />
        </div>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
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
            {/* Avg Delivery Time */}
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <p className="text-xs text-gray-500 mb-1">Avg Delivery Time</p>
              <div className="flex items-end gap-2">
                <Clock size={16} className="text-gray-400 mb-0.5 shrink-0" />
                <span className="text-2xl font-bold text-gray-900" style={{ fontFamily: 'var(--font-sora)' }}>
                  {data.summary.avgDeliveryTime != null ? `${data.summary.avgDeliveryTime} min` : '—'}
                </span>
              </div>
            </div>
            {/* On-Time Rate */}
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <p className="text-xs text-gray-500 mb-1">On-Time Rate</p>
              <div className="flex items-end gap-2">
                <CheckCircle2 size={16} className="text-gray-400 mb-0.5 shrink-0" />
                {(() => {
                  const rate = data.summary.onTimeRate;
                  const pct = rate != null ? Math.round(rate) : null;
                  const color = pct == null ? 'text-gray-900' : pct >= 90 ? 'text-green-600' : pct >= 70 ? 'text-amber-600' : 'text-red-600';
                  return (
                    <span className={`text-2xl font-bold ${color}`} style={{ fontFamily: 'var(--font-sora)' }}>
                      {pct != null ? `${pct}%` : '—'}
                    </span>
                  );
                })()}
              </div>
            </div>
          </div>

          {/* Completion rate trend sparkline */}
          <TrendSparkline data={data.daily} />

          {/* Attempts volume — daily grouped bars */}
          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Attempts volume</h2>
            <DailyBars data={data.daily} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Failure reasons — horizontal bars */}
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-4">Failed delivery reasons</h2>
              {data.failureReasons.length === 0 ? (
                <div className="flex items-center justify-center h-40 text-gray-400 text-sm">No failures in this period</div>
              ) : (() => {
                const maxCount = Math.max(...data.failureReasons.map(r => r.count), 1);
                return (
                  <div className="space-y-3">
                    {data.failureReasons.map((r, i) => (
                      <HBar
                        key={r.reason}
                        label={r.reason}
                        pct={(r.count / maxCount) * 100}
                        value={r.count}
                        color={BAR_COLORS[i % BAR_COLORS.length]}
                      />
                    ))}
                  </div>
                );
              })()}
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

          {/* Driver performance table */}
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

          {/* Driver completion rate — horizontal bar chart */}
          {data.drivers.length > 0 && (() => {
            const chartData = data.drivers
              .filter(d => d.total > 0)
              .map(d => ({ name: d.driverName ?? 'Unknown', rate: Math.round((d.completed / d.total) * 100) }))
              .sort((a, b) => b.rate - a.rate)
              .slice(0, 10);
            return (
              <div className="bg-white rounded-xl border border-gray-100 p-6">
                <h2 className="text-sm font-semibold text-gray-700 mb-4">Completion rate by driver (top 10)</h2>
                <div className="space-y-3">
                  {chartData.map(d => (
                    <HBar key={d.name} label={d.name} pct={d.rate} value={`${d.rate}%`} color="#0F4C81" />
                  ))}
                </div>
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
              .sort((a, b) => (b.completed / b.total) - (a.completed / a.total))[0]; // total is routed stops; completed/total is completion rate
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
