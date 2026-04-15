'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import {
  AlertTriangle, CheckCircle2, Clock, Package, RefreshCw, Flag,
  ChevronDown, ChevronUp, X,
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
  createdAt: string;
  routeId?: string;
  routeStatus?: string;
  pharmacistApproved?: boolean;
}

interface QueueData {
  pendingDispensing: QueueStop[];
  awaitingPickup: QueueStop[];
  controlledSubstance: QueueStop[];
  todayStats: { dispensed: number; pending: number; controlled: number };
}

const initials = (name: string) =>
  name.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase();

function StopCard({
  stop,
  onApprove,
  onFlag,
}: {
  stop: QueueStop;
  onApprove: (id: string) => void;
  onFlag: (id: string, routeId: string | undefined, note: string) => void;
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

  return (
    <div className={`bg-white rounded-xl border p-4 space-y-3 ${stop.controlledSubstance ? 'border-amber-200' : 'border-gray-100'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
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
        <p className="text-xs text-gray-400 flex items-center gap-1">
          <Clock size={11} />
          Window: {stop.windowStart ? new Date(stop.windowStart).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—'}
          {' – '}
          {stop.windowEnd ? new Date(stop.windowEnd).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—'}
        </p>
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
  title, count, children, warn,
}: {
  title: string; count: number; children: React.ReactNode; warn?: boolean;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className={`rounded-2xl border ${warn ? 'border-amber-200 bg-amber-50/40' : 'border-gray-100 bg-white'} overflow-hidden`}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3.5 text-left"
      >
        <div className="flex items-center gap-2.5">
          {warn && <AlertTriangle size={15} className="text-amber-500" />}
          <span className="font-semibold text-gray-800 text-sm">{title}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${warn ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>
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
          <Section title="Needs Dispensing" count={data?.pendingDispensing.length ?? 0}>
            {data?.pendingDispensing.map(s => (
              <StopCard key={s.id} stop={s} onApprove={approve} onFlag={flag} />
            ))}
          </Section>

          <Section title="Awaiting Pickup" count={data?.awaitingPickup.length ?? 0}>
            {data?.awaitingPickup.map(s => (
              <StopCard key={s.id} stop={s} onApprove={approve} onFlag={flag} />
            ))}
          </Section>

          <Section title="Controlled Substances" count={data?.controlledSubstance.length ?? 0} warn>
            {data?.controlledSubstance.map(s => (
              <StopCard key={s.id} stop={s} onApprove={approve} onFlag={flag} />
            ))}
          </Section>
        </div>
      )}
    </div>
  );
}
