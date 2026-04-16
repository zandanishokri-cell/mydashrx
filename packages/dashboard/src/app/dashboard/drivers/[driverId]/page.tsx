'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { FormField, SelectField } from '@/components/ui/FormField';
import { ArrowLeft, Award, CheckCircle2, XCircle, TrendingUp, Pencil } from 'lucide-react';

interface PerformanceData {
  driverId: string;
  driverName: string;
  period: { from: string; to: string };
  summary: {
    totalStops: number; completed: number; failed: number;
    completionRate: number; avgStopsPerDay: number; activeDays: number;
    onTimeRate: number | null;
  };
  daily: { date: string; total: number; completed: number; failed: number }[];
  failureReasons: { reason: string; count: number }[];
  rank: number | null;
  totalDrivers: number;
}

interface Driver {
  id: string; orgId: string; name: string; email: string; phone: string;
  drugCapable: boolean; vehicleType: string; status: string;
  currentLat: number | null; currentLng: number | null; lastPingAt: string | null;
}

interface Stop {
  id: string; status: string; address: string; recipientName: string;
  createdAt: string; completedAt: string | null; failureReason: string | null;
}

const REASON_COLORS = ['#ef4444', '#f97316', '#eab308', '#6b7280', '#8b5cf6'];

/** Vertical grouped bars for daily totals */
function DailyBars({ data, formatDate }: { data: { date: string; total: number; completed: number; failed: number }[]; formatDate: (s: string) => string }) {
  if (data.length === 0) return <p className="text-sm text-gray-400 text-center py-8">No delivery data for this period.</p>;
  const maxVal = Math.max(...data.map(d => d.total), 1);
  return (
    <div className="overflow-x-auto">
      <div className="flex items-end gap-1 h-40" style={{ minWidth: data.length * 32 }}>
        {data.map(d => (
          <div key={d.date} className="flex flex-col items-center gap-0.5 flex-1 min-w-[28px]">
            <div className="w-full flex items-end gap-px" style={{ height: 120 }}>
              <div className="flex-1 rounded-t transition-all bg-[#0F4C81]" style={{ height: `${(d.completed / maxVal) * 100}%`, minHeight: d.completed > 0 ? 2 : 0 }} title={`Completed: ${d.completed}`} />
              <div className="flex-1 rounded-t transition-all bg-red-400" style={{ height: `${(d.failed / maxVal) * 100}%`, minHeight: d.failed > 0 ? 2 : 0 }} title={`Failed: ${d.failed}`} />
            </div>
            <span className="text-[9px] text-gray-400 rotate-45 origin-top-left translate-x-1">{d.date.slice(5)}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-4 mt-6 text-xs text-gray-500">
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded-sm bg-[#0F4C81]" /> Completed</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded-sm bg-red-400" /> Failed</span>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-2xl font-bold text-gray-900" style={{ fontFamily: 'var(--font-sora)' }}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function DriverDetailPage() {
  const { driverId } = useParams<{ driverId: string }>();
  const router = useRouter();
  const [user] = useState(getUser);
  const [driver, setDriver] = useState<Driver | null>(null);
  const [perf, setPerf] = useState<PerformanceData | null>(null);
  const [recentStops, setRecentStops] = useState<Stop[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [showEdit, setShowEdit] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [driverData, perfData] = await Promise.all([
        api.get<Driver>(`/orgs/${user.orgId}/drivers/${driverId}`),
        api.get<PerformanceData>(`/orgs/${user.orgId}/drivers/${driverId}/performance`),
      ]);
      setDriver(driverData);
      setPerf(perfData);
      setLoadError(false);

      // Recent stops — best-effort, non-fatal if fails
      try {
        const resp = await api.get<{ stops: Stop[] }>(`/orgs/${user.orgId}/stops?driverId=${driverId}&limit=10`);
        setRecentStops(resp?.stops ?? []);
      } catch { setRecentStops([]); }
    } catch (e) {
      console.error(e);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [user, driverId]);

  useEffect(() => { load(); }, [load]);

  const formatDate = (s: string) => new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  if (loading) return (
    <div className="p-6 space-y-4">
      {[1, 2, 3].map(i => <div key={i} className="h-24 bg-white rounded-xl border border-gray-100 animate-pulse" />)}
    </div>
  );

  if (loadError) return (
    <div className="p-6 text-center">
      <p className="text-gray-700 font-medium mb-1">Failed to load driver profile</p>
      <p className="text-gray-400 text-sm mb-4">Check your connection and try again.</p>
      <button onClick={load} className="text-sm bg-[#0F4C81] text-white px-4 py-2 rounded-lg hover:bg-[#0a3d6b]">
        Retry
      </button>
    </div>
  );

  if (!driver || !perf) return (
    <div className="p-6 text-center text-gray-500">Driver not found.</div>
  );

  const statusColors: Record<string, string> = {
    available: 'bg-emerald-500',
    on_route: 'bg-blue-500',
    offline: 'bg-gray-400',
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      {/* Back + header */}
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 transition-colors">
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-xl font-bold text-gray-900" style={{ fontFamily: 'var(--font-sora)' }}>
          Driver Profile
        </h1>
      </div>

      {/* Driver info card */}
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-blue-50 flex items-center justify-center text-[#0F4C81] font-bold text-xl shrink-0">
              {driver.name?.[0] ?? '?'}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg font-semibold text-gray-900">{driver.name}</h2>
                <span className={`inline-block w-2 h-2 rounded-full ${statusColors[driver.status] ?? 'bg-gray-400'}`} />
                <Badge status={driver.status} />
                {driver.drugCapable && (
                  <span className="text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full font-medium">Rx Capable</span>
                )}
              </div>
              <p className="text-sm text-gray-500 mt-0.5">{driver.email}</p>
              <div className="flex items-center gap-4 mt-1 text-sm text-gray-500">
                <span>{driver.phone}</span>
                <span className="capitalize">{driver.vehicleType}</span>
              </div>
            </div>
          </div>
          <Button size="sm" variant="secondary" onClick={() => setShowEdit(true)}>
            <Pencil size={13} /> Edit Driver
          </Button>
        </div>
      </div>

      {/* Performance stats */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700">30-Day Performance</h3>
          {perf.rank && (
            <span className="flex items-center gap-1.5 text-sm font-semibold text-amber-600 bg-amber-50 px-3 py-1 rounded-full">
              <Award size={14} />
              #{perf.rank} of {perf.totalDrivers} drivers
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatCard label="Total Stops" value={perf.summary.totalStops} />
          <StatCard
            label="Completion Rate"
            value={`${perf.summary.completionRate}%`}
            sub={`${perf.summary.completed} completed`}
          />
          <StatCard label="Avg Stops/Day" value={perf.summary.avgStopsPerDay} sub={`${perf.summary.activeDays} active days`} />
          <StatCard
            label="On-Time Rate"
            value={perf.summary.onTimeRate !== null ? `${perf.summary.onTimeRate}%` : '—'}
            sub={perf.summary.onTimeRate !== null ? 'within delivery window' : 'no window data'}
          />
          <StatCard label="Failed Stops" value={perf.summary.failed} sub={perf.summary.failed > 0 ? 'See reasons below' : 'Clean record'} />
        </div>
      </div>

      {/* Daily delivery chart */}
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Daily Deliveries</h3>
        <DailyBars data={perf.daily} formatDate={formatDate} />
      </div>

      {/* Failure reasons + recent activity */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Failure reasons pie */}
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Failure Reasons</h3>
          {perf.failureReasons.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <CheckCircle2 size={28} className="text-emerald-400 mb-2" />
              <p className="text-sm text-gray-400">No failures this period</p>
            </div>
          ) : (() => {
            const maxCount = Math.max(...perf.failureReasons.map(r => r.count), 1);
            return (
              <div className="space-y-3">
                {perf.failureReasons.map((r, i) => (
                  <div key={r.reason} className="flex items-center gap-3">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: REASON_COLORS[i % REASON_COLORS.length] }} />
                    <span className="text-xs text-gray-600 w-36 truncate shrink-0 capitalize">{r.reason.replace(/_/g, ' ')}</span>
                    <div className="flex-1 bg-gray-100 rounded-full h-2">
                      <div className="h-2 rounded-full transition-all" style={{ width: `${(r.count / maxCount) * 100}%`, background: REASON_COLORS[i % REASON_COLORS.length] }} />
                    </div>
                    <span className="text-xs font-semibold text-gray-800 w-6 text-right shrink-0">{r.count}</span>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>

        {/* Recent activity */}
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Recent Activity</h3>
          {recentStops.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">No recent stops found.</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {recentStops.map(stop => (
                <div key={stop.id} className="flex items-start gap-2.5 text-sm">
                  {stop.status === 'completed'
                    ? <CheckCircle2 size={15} className="text-emerald-500 mt-0.5 shrink-0" />
                    : <XCircle size={15} className="text-red-400 mt-0.5 shrink-0" />
                  }
                  <div className="flex-1 min-w-0">
                    <p className="text-gray-800 truncate">{stop.address}</p>
                    <p className="text-xs text-gray-400">{stop.recipientName} · {formatDate(stop.createdAt)}</p>
                  </div>
                  <Badge status={stop.status} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showEdit && driver && (
        <EditDriverModal
          driver={driver}
          orgId={user!.orgId}
          onClose={() => setShowEdit(false)}
          onSaved={() => { setShowEdit(false); load(); }}
        />
      )}
    </div>
  );
}

function EditDriverModal({ driver, orgId, onClose, onSaved }: {
  driver: Driver; orgId: string; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: driver.name, phone: driver.phone,
    vehicleType: driver.vehicleType as 'car' | 'van' | 'bicycle',
    drugCapable: driver.drugCapable,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k: string, v: string | boolean) => setForm(f => ({ ...f, [k]: v }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true); setError('');
    try { await api.patch(`/orgs/${orgId}/drivers/${driver.id}`, form); onSaved(); }
    catch (err: any) { setError(err.message ?? 'Failed to update driver'); }
    finally { setSaving(false); }
  };
  return (
    <Modal title="Edit driver" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <FormField label="Full Name" value={form.name} onChange={e => set('name', e.target.value)} required />
        <FormField label="Phone" value={form.phone} onChange={e => set('phone', e.target.value)} />
        <SelectField label="Vehicle Type" value={form.vehicleType} onChange={e => set('vehicleType', e.target.value)}>
          <option value="car">Car</option>
          <option value="van">Van</option>
          <option value="bicycle">Bicycle</option>
        </SelectField>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={form.drugCapable} onChange={e => set('drugCapable', e.target.checked)} className="rounded border-gray-300" />
          <span className="text-sm text-gray-700">Rx / Drug Capable</span>
        </label>
        {error && <p className="text-red-500 text-sm">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" size="sm" type="button" onClick={onClose}>Cancel</Button>
          <Button size="sm" type="submit" loading={saving}>Save changes</Button>
        </div>
      </form>
    </Modal>
  );
}
