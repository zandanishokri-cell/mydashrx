'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { ArrowLeft, CheckCircle, ExternalLink, AlertCircle } from 'lucide-react';

interface RegulatoryUpdate {
  id: string;
  title: string;
  summary: string;
  source: string;
  impactLevel: string;
  effectiveDate: string | null;
  url: string | null;
  acknowledged: boolean;
  acknowledgedAt: string | null;
  createdAt: string;
}

const IMPACT_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  critical: { bg: 'bg-red-100',    text: 'text-red-700',    label: 'Critical' },
  high:     { bg: 'bg-orange-100', text: 'text-orange-700', label: 'High' },
  medium:   { bg: 'bg-amber-100',  text: 'text-amber-700',  label: 'Medium' },
  low:      { bg: 'bg-blue-100',   text: 'text-blue-700',   label: 'Low' },
};

const SOURCE_STYLES: Record<string, { bg: string; text: string }> = {
  'LARA':              { bg: 'bg-[#0F4C81]/10', text: 'text-[#0F4C81]' },
  'Board of Pharmacy': { bg: 'bg-[#00B8A9]/10', text: 'text-[#00B8A9]' },
  'MDHHS':             { bg: 'bg-purple-100',   text: 'text-purple-700' },
  'AG':                { bg: 'bg-rose-100',     text: 'text-rose-700' },
  'Legislature':       { bg: 'bg-gray-100',     text: 'text-gray-700' },
};

function ImpactBadge({ level }: { level: string }) {
  const s = IMPACT_STYLES[level] ?? IMPACT_STYLES.medium;
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.bg} ${s.text}`}>{s.label}</span>;
}

function SourceBadge({ source }: { source: string }) {
  const s = SOURCE_STYLES[source] ?? SOURCE_STYLES['Legislature'];
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.bg} ${s.text}`}>{source}</span>;
}

export default function RegulatoryUpdatesPage() {
  const [user] = useState(getUser);
  const [updates, setUpdates] = useState<RegulatoryUpdate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [unackOnly, setUnackOnly] = useState(false);
  const [acknowledging, setAcknowledging] = useState('');
  const [ackError, setAckError] = useState('');

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true); setLoadError(false);
    try {
      const url = unackOnly
        ? `/orgs/${user.orgId}/mi-compliance/regulatory?unacknowledged=true`
        : `/orgs/${user.orgId}/mi-compliance/regulatory`;
      const result = await api.get<RegulatoryUpdate[]>(url);
      setUpdates(result);
    } catch { setUpdates([]); setLoadError(true); }
    finally { setLoading(false); }
  }, [user, unackOnly]);

  useEffect(() => { load(); }, [load]);

  const acknowledge = async (id: string) => {
    if (!user) return;
    setAcknowledging(id);
    setAckError('');
    try {
      const updated = await api.patch<RegulatoryUpdate>(`/orgs/${user.orgId}/mi-compliance/regulatory/${id}`, {});
      setUpdates(prev => prev.map(u => u.id === id ? updated : u));
    } catch (err: any) {
      setAckError(err?.message ?? 'Failed to acknowledge. Please try again.');
    } finally { setAcknowledging(''); }
  };

  const unackCount = updates.filter(u => !u.acknowledged).length;

  return (
    <div className="p-6 space-y-6">
      {loadError && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          <span className="flex items-center gap-2"><AlertCircle size={14} />Failed to load regulatory updates. Please try again.</span>
          <button onClick={load} className="text-red-600 font-medium hover:underline text-xs">Retry</button>
        </div>
      )}
      {ackError && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          <span className="flex items-center gap-2"><AlertCircle size={14} />{ackError}</span>
          <button onClick={() => setAckError('')} className="text-red-400 hover:text-red-600">✕</button>
        </div>
      )}
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/mi-compliance" className="text-gray-400 hover:text-gray-600">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-gray-900" style={{ fontFamily: 'var(--font-sora)' }}>
              Regulatory Updates
            </h1>
            <p className="text-xs text-gray-400 mt-0.5">Michigan pharmacy law changes and pending legislation</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {unackCount > 0 && (
            <span className="text-xs text-amber-600 font-medium">{unackCount} unacknowledged</span>
          )}
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={unackOnly}
              onChange={e => setUnackOnly(e.target.checked)}
              className="rounded border-gray-300"
            />
            Unacknowledged only
          </label>
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[1,2,3].map(i => <div key={i} className="h-36 bg-white rounded-xl border border-gray-100 animate-pulse" />)}
        </div>
      ) : updates.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center">
          <p className="text-gray-400 text-sm">
            {unackOnly ? 'All updates acknowledged.' : 'No regulatory updates. Run Init from the dashboard to seed default updates.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {updates.map(update => (
            <div
              key={update.id}
              className={`bg-white rounded-xl border p-5 transition-all ${
                update.acknowledged ? 'border-gray-100' : 'border-amber-200'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <SourceBadge source={update.source} />
                    <ImpactBadge level={update.impactLevel} />
                    {update.effectiveDate ? (
                      <span className="text-xs text-gray-500">
                        Effective: {new Date(update.effectiveDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400 italic">Pending — no effective date</span>
                    )}
                  </div>
                  <h3 className="text-sm font-semibold text-gray-900 mb-1.5">{update.title}</h3>
                  <p className="text-sm text-gray-600 leading-relaxed">{update.summary}</p>
                  {update.url && (
                    <a
                      href={update.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-[#0F4C81] hover:underline mt-2"
                    >
                      <ExternalLink size={11} /> View source
                    </a>
                  )}
                </div>
                <div className="shrink-0 flex flex-col items-end gap-2">
                  {update.acknowledged ? (
                    <div className="flex items-center gap-1 text-xs text-emerald-600">
                      <CheckCircle size={13} />
                      Acknowledged
                      {update.acknowledgedAt && (
                        <span className="text-gray-400 ml-1">
                          {new Date(update.acknowledgedAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  ) : (
                    <button
                      onClick={() => acknowledge(update.id)}
                      disabled={acknowledging === update.id}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[#0F4C81] text-white rounded-lg hover:bg-[#0d3f6e] transition-colors disabled:opacity-50"
                    >
                      <CheckCircle size={12} />
                      {acknowledging === update.id ? 'Saving…' : 'Acknowledge'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
