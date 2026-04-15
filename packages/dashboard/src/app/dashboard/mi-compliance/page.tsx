'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { Scale, Shield, AlertTriangle, CheckCircle, Clock, ChevronRight, Zap, Bell } from 'lucide-react';

interface CategoryStat {
  status: string;
  itemCount: number;
  nonCompliantCount: number;
}

interface DashboardData {
  overallStatus: string;
  score: number;
  categories: Record<string, CategoryStat>;
  unacknowledgedUpdates: number;
  pendingItems: number;
}

const CATEGORY_META: Record<string, { label: string; legalRef: string }> = {
  maps_reporting:     { label: 'MAPS Reporting',     legalRef: 'MCL 333.17735' },
  id_verification:    { label: 'ID Verification',    legalRef: 'R 338.3162' },
  record_retention:   { label: 'Record Retention',   legalRef: 'R 338.3162' },
  pharmacy_licensure: { label: 'Pharmacy Licensure', legalRef: 'MCL 333.17708' },
  data_destruction:   { label: 'Data Destruction',   legalRef: 'MCL 445.79c' },
  breach_readiness:   { label: 'Breach Readiness',   legalRef: 'MCL 445.72' },
};

const STATUS_STYLES: Record<string, { bg: string; text: string; icon: typeof CheckCircle; label: string }> = {
  compliant:     { bg: 'bg-emerald-50', text: 'text-emerald-700', icon: CheckCircle,    label: 'Compliant' },
  warning:       { bg: 'bg-amber-50',   text: 'text-amber-700',   icon: AlertTriangle,  label: 'Warning' },
  non_compliant: { bg: 'bg-red-50',     text: 'text-red-700',     icon: AlertTriangle,  label: 'Non-Compliant' },
  pending:       { bg: 'bg-gray-50',    text: 'text-gray-600',    icon: Clock,          label: 'Pending' },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.pending;
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${s.bg} ${s.text}`}>
      <Icon size={10} /> {s.label}
    </span>
  );
}

function ScoreRing({ score }: { score: number }) {
  const color = score >= 80 ? '#00B8A9' : score >= 50 ? '#F6A623' : '#ef4444';
  const r = 40;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width={100} height={100} className="-rotate-90">
        <circle cx={50} cy={50} r={r} fill="none" stroke="#f0f0f0" strokeWidth={8} />
        <circle cx={50} cy={50} r={r} fill="none" stroke={color} strokeWidth={8}
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.5s ease' }} />
      </svg>
      <div className="absolute text-center">
        <div className="text-xl font-bold text-gray-900" style={{ fontFamily: 'var(--font-sora)' }}>{score}</div>
        <div className="text-xs text-gray-500">/ 100</div>
      </div>
    </div>
  );
}

export default function MiCompliancePage() {
  const [user] = useState(getUser);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [seedMsg, setSeedMsg] = useState('');

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const result = await api.get<DashboardData>(`/orgs/${user.orgId}/mi-compliance/dashboard`);
      setData(result);
    } catch { setData(null); }
    finally { setLoading(false); }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const runInit = async () => {
    if (!user) return;
    setSeeding(true);
    setSeedMsg('');
    try {
      const result = await api.post<{ seeded: boolean; itemCount: number; updateCount: number; message?: string }>(
        `/orgs/${user.orgId}/mi-compliance/init`, {}
      );
      setSeedMsg(result.seeded
        ? `Seeded ${result.itemCount} compliance items and ${result.updateCount} regulatory updates.`
        : result.message ?? 'Already initialized.');
      await load();
    } catch { setSeedMsg('Init failed.'); }
    finally { setSeeding(false); }
  };

  const overallStyle = STATUS_STYLES[data?.overallStatus ?? 'pending'];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Scale size={20} className="text-[#0F4C81]" />
            <h1 className="text-xl font-bold text-gray-900" style={{ fontFamily: 'var(--font-sora)' }}>
              Michigan Compliance Panel
            </h1>
          </div>
          <p className="text-xs text-gray-400 mt-0.5 ml-7">MCL 333.17701 · R 338.3162 · MCL 445.61</p>
        </div>
        <div className="flex items-center gap-2">
          {seedMsg && <span className="text-xs text-gray-500">{seedMsg}</span>}
          <button
            onClick={runInit}
            disabled={seeding}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-[#0F4C81] text-white rounded-lg hover:bg-[#0d3f6e] transition-colors disabled:opacity-60"
          >
            <Zap size={13} />
            {seeding ? 'Running…' : 'Run Init'}
          </button>
          <Link
            href="/dashboard/mi-compliance/regulatory"
            className="relative flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600"
          >
            <Bell size={13} />
            Regulatory Updates
            {(data?.unacknowledgedUpdates ?? 0) > 0 && (
              <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center font-bold">
                {data!.unacknowledgedUpdates}
              </span>
            )}
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1,2,3].map(i => <div key={i} className="h-32 bg-white rounded-xl border border-gray-100 animate-pulse" />)}
        </div>
      ) : !data ? (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center">
          <p className="text-gray-400 text-sm">No compliance data. Click "Run Init" to seed the default Michigan checklist.</p>
        </div>
      ) : (
        <>
          {/* Overall Score */}
          <div className="bg-white rounded-xl border border-gray-100 p-5 flex items-center gap-6">
            <ScoreRing score={data.score} />
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-semibold text-gray-700">Overall Compliance Score</span>
                <StatusBadge status={data.overallStatus} />
              </div>
              <div className="flex gap-4 text-sm text-gray-500">
                <span><span className="font-medium text-amber-600">{data.pendingItems}</span> pending items</span>
                <span><span className="font-medium text-red-500">{data.unacknowledgedUpdates}</span> unacknowledged updates</span>
              </div>
              <p className="text-xs text-gray-400 mt-1">
                Based on {Object.values(data.categories).reduce((s, c) => s + c.itemCount, 0)} tracked compliance items across 6 categories
              </p>
            </div>
            <Link href="/dashboard/mi-compliance/items" className="flex items-center gap-1 text-sm text-[#0F4C81] hover:underline">
              View all items <ChevronRight size={14} />
            </Link>
          </div>

          {/* Category Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Object.entries(CATEGORY_META).map(([key, meta]) => {
              const cat = data.categories[key] ?? { status: 'pending', itemCount: 0, nonCompliantCount: 0 };
              const s = STATUS_STYLES[cat.status] ?? STATUS_STYLES.pending;
              const Icon = s.icon;
              return (
                <Link
                  key={key}
                  href={`/dashboard/mi-compliance/items?category=${key}`}
                  className="bg-white rounded-xl border border-gray-100 p-4 hover:border-[#0F4C81]/30 hover:shadow-sm transition-all group"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-800">{meta.label}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{meta.legalRef}</p>
                    </div>
                    <span className={`p-1.5 rounded-lg ${s.bg}`}>
                      <Icon size={14} className={s.text} />
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <StatusBadge status={cat.status} />
                    <div className="text-xs text-gray-500">
                      {cat.itemCount} items
                      {cat.nonCompliantCount > 0 && (
                        <span className="text-red-500 ml-1">· {cat.nonCompliantCount} non-compliant</span>
                      )}
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-1 text-xs text-[#0F4C81] opacity-0 group-hover:opacity-100 transition-opacity">
                    View details <ChevronRight size={11} />
                  </div>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
