'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import {
  AlertTriangle, CheckCircle2, Clock, Package, RefreshCw, Flag,
  ChevronDown, ChevronUp, X, MapPin,
} from 'lucide-react';

interface QueueStop {
  id: string;
  recipientName: string;
  address: string;
  rxNumbers: string[];
  controlledSubstance: boolean;
  requiresRefrigeration: boolean;
  requiresSignature: boolean;
  deliveryNotes?: string;
  windowStart?: string;
  windowEnd?: string;
  arrivedAt?: string;
  createdAt: string;
  routeId?: string;
  routeStatus?: string;
  pharmacistApproved?: boolean;
}

interface AwaitingReturnStop {
  id: string;
  recipientName: string;
  address: string;
  controlledSubstance: boolean;
  returnedAt: string | null;
}

interface QueueData {
  pendingDispensing: QueueStop[];
  awaitingPickup: QueueStop[];
  controlledSubstance: QueueStop[];
  driverArrivals: QueueStop[];
  awaitingReturn: AwaitingReturnStop[];
  todayStats: { dispensed: number; pending: number; controlled: number };
}

function timeSince(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

const initials = (name: string) =>
  name.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase();

function getWindowUrgency(windowEnd?: string): 'overdue' | 'due-soon' | 'normal' {
  if (!windowEnd) return 'normal';
  const end = new Date(windowEnd).getTime();
  const now = Date.now();
  if (end < now) return 'overdue';
  if (end - now < 60 * 60 * 1000) return 'due-soon';
  return 'normal';
}

function StopCard({
  stop,
  onApprove,
  onFlag,
  selected,
  onToggleSelect,
}: {
  stop: QueueStop;
  onApprove: (id: string) => void;
  onFlag: (id: string, routeId: string | undefined, note: string) => void;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
}) {
  const [flagOpen, setFlagOpen] = useState(false);
  const [flagNote, setFlagNote] = useState('');
  const [approving, setApproving] = useState(false);
  const [approved, setApproved] = useState(stop.pharmacistApproved ?? false);

  const approve = async () => {
    setApproving(true);
    onApprove(stop.id);
    setApproved(true);
    setApproving(false);
  };

  const submitFlag = () => {
    if (!flagNote.trim()) return;
    onFlag(stop.id, stop.routeId, flagNote);
    setFlagNote('');
    setFlagOpen(false);
  };

  const urgency = getWindowUrgency(stop.windowEnd);
  // Urgency takes visual priority over controlled substance indicator
  const cardBorder = urgency === 'overdue'
    ? `${stop.controlledSubstance ? 'border-red-400' : 'border-red-300'} bg-red-50/40`
    : urgency === 'due-soon'
    ? `${stop.controlledSubstance ? 'border-amber-300' : 'border-amber-200'} bg-amber-50/20`
    : stop.controlledSubstance
    ? 'border-amber-200 bg-amber-50/10'
    : 'border-gray-100';

  return (
    <div className={`bg-white rounded-xl border p-4 space-y-3 ${cardBorder}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          {onToggleSelect && (
            <input
              type="checkbox"
              checked={selected ?? false}
              onChange={() => onToggleSelect(stop.id)}
              className="h-4 w-4 mt-0.5 rounded border-gray-300 text-emerald-600 cursor-pointer shrink-0"
            />
          )}
          <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center text-xs font-bold text-emerald-700 shrink-0">
            {initials(stop.recipientName)}
          </div>
          <div>
            <p className="font-medium text-gray-900 text-sm">{stop.address}</p>
            <p className="text-xs text-gray-400 mt-0.5">
              {stop.rxNumbers?.length > 0 ? `Rx: ${stop.rxNumbers.join(', ')}` : 'No Rx #'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {stop.controlledSubstance && (
            <span className="flex items-center gap-1 text-xs bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full font-medium">
              <AlertTriangle size={10} /> CS
            </span>
          )}
          {stop.requiresRefrigeration && (
            <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">Cold</span>
          )}
        </div>
      </div>

      {stop.deliveryNotes && !stop.pharmacistApproved && (
        <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-2.5 py-2">{stop.deliveryNotes}</p>
      )}

      {(stop.windowStart || stop.windowEnd) && (
        <div className="flex items-center gap-2">
          <p className="text-xs text-gray-400 flex items-center gap-1">
            <Clock size={11} />
            {stop.windowStart ? new Date(stop.windowStart).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—'}
            {' – '}
            {stop.windowEnd ? new Date(stop.windowEnd).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—'}
          </p>
          {urgency === 'overdue' && (
            <span className="text-[10px] font-bold bg-red-100 text-red-700 border border-red-200 px-1.5 py-0.5 rounded">OVERDUE</span>
          )}
          {urgency === 'due-soon' && (
            <span className="text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded">Due soon</span>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        {approved ? (
          <span className="flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-lg font-medium">
            <CheckCircle2 size={13} /> Approved
          </span>
        ) : (
          <button
            onClick={approve}
            disabled={approving}
            className="flex items-center gap-1.5 text-xs bg-emerald-600 text-white px-3 py-1.5 rounded-lg font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            <CheckCircle2 size={13} /> Approve
          </button>
        )}
        <button
          onClick={() => setFlagOpen(f => !f)}
          className="flex items-center gap-1.5 text-xs border border-gray-200 text-gray-600 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <Flag size={13} /> Flag Issue
        </button>
      </div>

      {flagOpen && (
        <div className="space-y-2">
          <textarea
            value={flagNote}
            onChange={e => setFlagNote(e.target.value)}
            placeholder="Describe the issue…"
            rows={2}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-emerald-200"
          />
          <div className="flex gap-2">
            <button onClick={submitFlag} className="text-xs bg-amber-500 text-white px-3 py-1.5 rounded-lg hover:bg-amber-600 transition-colors">
              Submit Flag
            </button>
            <button onClick={() => setFlagOpen(false)} className="text-xs text-gray-500 px-2 py-1.5 hover:text-gray-700">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({
  title, count, children, warn, accent,
}: {
  title: string; count: number; children: React.ReactNode; warn?: boolean; accent?: 'green';
}) {
  const [open, setOpen] = useState(true);
  const border = warn ? 'border-amber-200 bg-amber-50/40'
    : accent === 'green' ? 'border-emerald-200 bg-emerald-50/30'
    : 'border-gray-100 bg-white';
  const badge = warn ? 'bg-amber-100 text-amber-700'
    : accent === 'green' ? 'bg-emerald-100 text-emerald-700'
    : 'bg-gray-100 text-gray-600';
  return (
    <div className={`rounded-2xl border ${border} overflow-hidden`}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3.5 text-left"
      >
        <div className="flex items-center gap-2.5">
          {warn && <AlertTriangle size={15} className="text-amber-500" />}
          {accent === 'green' && <MapPin size={15} className="text-emerald-500" />}
          <span className="font-semibold text-gray-800 text-sm">{title}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${badge}`}>
            {count}
          </span>
        </div>
        {open ? <ChevronUp size={15} className="text-gray-400" /> : <ChevronDown size={15} className="text-gray-400" />}
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3">
          {count === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">All clear</p>
          ) : children}
        </div>
      )}
    </div>
  );
}

export default function PharmacistQueuePage() {
  const user = getUser();
  const [data, setData] = useState<QueueData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const res = await api.get<QueueData>(`/orgs/${user.orgId}/pharmacist/queue`);
      setData(res);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [user]);

  useEffect(() => {
    load();
    intervalRef.current = setInterval(load, 30_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [load]);

  const approve = async (stopId: string) => {
    if (!user) return;
    try {
      await api.post(`/orgs/${user.orgId}/pharmacist/${stopId}/pharmacist-approve`, {});
    } catch { /* optimistic — already updated UI */ }
  };

  const toggleSelect = (id: string) =>
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const bulkApprove = async () => {
    if (!user || selectedIds.size === 0) return;
    try {
      await api.post(`/orgs/${user.orgId}/pharmacist/bulk-approve`, { stopIds: [...selectedIds] });
      setSelectedIds(new Set());
      load();
    } catch { /* silent */ }
  };

  const flag = async (stopId: string, routeId: string | undefined, note: string) => {
    if (!user || !routeId) return;
    try {
      await api.patch(`/routes/${routeId}/stops/${stopId}`, { deliveryNotes: `[FLAG: ${note}]` });
    } catch { /* silent */ }
  };

  const stats = data?.todayStats;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900" style={{ fontFamily: 'var(--font-sora)' }}>
            Dispensing Queue
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Auto-refreshes every 30 seconds</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-500 disabled:opacity-40 transition-colors"
        >
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Pending', value: stats?.pending ?? 0, color: 'text-gray-900', bg: 'bg-white' },
          { label: 'Controlled', value: stats?.controlled ?? 0, color: 'text-amber-700', bg: 'bg-amber-50' },
          { label: 'Dispensed Today', value: stats?.dispensed ?? 0, color: 'text-emerald-700', bg: 'bg-emerald-50' },
        ].map(({ label, value, color, bg }) => (
          <div key={label} className={`${bg} rounded-2xl border border-gray-100 p-4 text-center`}>
            <p className={`text-3xl font-bold ${color}`}>{value}</p>
            <p className="text-xs text-gray-500 mt-1 font-medium">{label}</p>
          </div>
        ))}
      </div>

      {loading && !data ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-24 bg-white rounded-xl border border-gray-100 animate-pulse" />)}
        </div>
      ) : (
        <div className="space-y-4">
          <Section title="Driver Arrived" count={data?.driverArrivals.length ?? 0} accent="green">
            {data?.driverArrivals.map(s => (
              <div key={s.id} className="bg-white rounded-xl border border-emerald-100 p-3.5 flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-xs font-bold text-emerald-700 shrink-0 mt-0.5">
                  {initials(s.recipientName)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 text-sm truncate">{s.address}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {s.rxNumbers?.length > 0 ? `Rx: ${s.rxNumbers.join(', ')}` : 'No Rx #'}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                    <MapPin size={10} />
                    Arrived
                  </span>
                  {s.arrivedAt && (
                    <p className="text-xs text-gray-400 mt-1">{timeSince(s.arrivedAt)}</p>
                  )}
                </div>
              </div>
            ))}
          </Section>

          <Section title="Needs Dispensing" count={data?.pendingDispensing.length ?? 0}>
            {data?.pendingDispensing.map(s => (
              <StopCard key={s.id} stop={s} onApprove={approve} onFlag={flag}
                selected={selectedIds.has(s.id)} onToggleSelect={toggleSelect} />
            ))}
          </Section>

          <Section title="Awaiting Pickup" count={data?.awaitingPickup.length ?? 0}>
            {data?.awaitingPickup.map(s => (
              <StopCard key={s.id} stop={s} onApprove={approve} onFlag={flag}
                selected={selectedIds.has(s.id)} onToggleSelect={toggleSelect} />
            ))}
          </Section>

          <Section title="Controlled Substances" count={data?.controlledSubstance.length ?? 0} warn>
            {data?.controlledSubstance.map(s => (
              <StopCard key={s.id} stop={s} onApprove={approve} onFlag={flag}
                selected={selectedIds.has(s.id)} onToggleSelect={toggleSelect} />
            ))}
          </Section>

          {(data?.awaitingReturn.length ?? 0) > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-2">
                <span className="w-2 h-2 bg-amber-400 rounded-full" />
                Awaiting Return ({data!.awaitingReturn.length})
              </h2>
              <div className="space-y-2">
                {data!.awaitingReturn.map(stop => (
                  <div key={stop.id} className={`bg-white border rounded-xl px-4 py-3 ${stop.controlledSubstance ? 'border-amber-300' : 'border-gray-100'}`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-800">{stop.recipientName}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{stop.address}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {stop.controlledSubstance && (
                          <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">CS</span>
                        )}
                        <span className="text-xs text-gray-400">Pending return</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-gray-900 text-white px-5 py-3 rounded-2xl shadow-xl z-50">
          <span className="text-sm font-medium">{selectedIds.size} selected</span>
          <button
            onClick={bulkApprove}
            className="flex items-center gap-1.5 text-sm bg-emerald-500 hover:bg-emerald-400 px-4 py-1.5 rounded-lg font-semibold transition-colors"
          >
            <CheckCircle2 size={14} /> Approve All
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="p-1 hover:text-gray-300 transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
