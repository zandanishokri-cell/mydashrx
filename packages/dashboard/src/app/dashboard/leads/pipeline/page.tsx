'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { ArrowLeft, X, Phone, Mail, ExternalLink, ChevronRight, AlertCircle } from 'lucide-react';

interface Lead {
  id: string; name: string; city: string; state: string; address: string;
  phone: string | null; email: string | null; website: string | null;
  score: number; status: string; lastContactedAt: string | null;
  nextFollowUp: string | null; notes: string | null; rating: number | null;
  reviewCount: number | null; ownerName: string | null; businessType: string | null;
}

type Pipeline = Record<string, Lead[]>;

interface OutreachEntry {
  id: string; channel: string; subject: string | null; sentAt: string; status: string; sentByName: string | null;
}

const STAGES = ['new', 'contacted', 'interested', 'negotiating', 'closed', 'lost'] as const;

const STAGE_COLORS: Record<string, string> = {
  new: 'bg-blue-50 border-blue-200',
  contacted: 'bg-purple-50 border-purple-200',
  interested: 'bg-amber-50 border-amber-200',
  negotiating: 'bg-orange-50 border-orange-200',
  closed: 'bg-emerald-50 border-emerald-200',
  lost: 'bg-gray-50 border-gray-200',
};

const STAGE_HEADER: Record<string, string> = {
  new: 'text-blue-700',
  contacted: 'text-purple-700',
  interested: 'text-amber-700',
  negotiating: 'text-orange-700',
  closed: 'text-emerald-700',
  lost: 'text-gray-500',
};

function ScoreBadge({ score }: { score: number }) {
  const cls = score >= 70 ? 'bg-emerald-100 text-emerald-700'
    : score >= 40 ? 'bg-amber-100 text-amber-700'
    : 'bg-gray-100 text-gray-600';
  return <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${cls}`}>{score}</span>;
}

const STAGE_ORDER = STAGES.reduce((acc, s, i) => ({ ...acc, [s]: i }), {} as Record<string, number>);

export default function PipelinePage() {
  const [user] = useState(getUser);
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [outreach, setOutreach] = useState<OutreachEntry[]>([]);
  const [loadingOutreach, setLoadingOutreach] = useState(false);
  const [movingTo, setMovingTo] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [outreachError, setOutreachError] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true); setLoadError(false);
    try {
      const data = await api.get<Pipeline>(`/orgs/${user.orgId}/leads/pipeline`);
      setPipeline(data);
    } catch { setPipeline(null); setLoadError(true); }
    finally { setLoading(false); }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const openLead = async (lead: Lead) => {
    setSelectedLead(lead);
    setLoadingOutreach(true); setOutreachError(false);
    try {
      const data = await api.get<{ lead: Lead; outreach: OutreachEntry[] }>(`/orgs/${user!.orgId}/leads/${lead.id}`);
      setOutreach(data.outreach);
    } catch { setOutreach([]); setOutreachError(true); }
    finally { setLoadingOutreach(false); }
  };

  const moveToNext = async (lead: Lead) => {
    const currentIdx = STAGE_ORDER[lead.status] ?? 0;
    const nextStage = STAGES[currentIdx + 1];
    if (!nextStage || nextStage === 'lost') return;
    setMovingTo(lead.id);
    try {
      await api.patch(`/orgs/${user!.orgId}/leads/${lead.id}`, { status: nextStage });
      await load();
      if (selectedLead?.id === lead.id) {
        setSelectedLead(prev => prev ? { ...prev, status: nextStage } : null);
      }
    } finally { setMovingTo(null); }
  };

  return (
    <div className="p-6 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link href="/dashboard/leads" className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50">
          <ArrowLeft size={15} className="text-gray-600" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-gray-900" style={{ fontFamily: 'var(--font-sora)' }}>Pipeline</h1>
          <p className="text-sm text-gray-500 mt-0.5">Kanban view of your lead pipeline</p>
        </div>
      </div>

      {loadError && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 mb-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          <span className="flex items-center gap-2"><AlertCircle size={14} />Failed to load pipeline. Please try again.</span>
          <button onClick={load} className="text-red-600 font-medium hover:underline text-xs">Retry</button>
        </div>
      )}

      {loading ? (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {STAGES.map(s => (
            <div key={s} className="w-60 shrink-0 bg-white rounded-xl border border-gray-100 h-64 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4 flex-1">
          {STAGES.map(stage => {
            const leads = pipeline?.[stage] ?? [];
            return (
              <div key={stage} className={`w-64 shrink-0 rounded-xl border p-3 flex flex-col gap-2 ${STAGE_COLORS[stage]}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-xs font-bold uppercase tracking-wide ${STAGE_HEADER[stage]}`}>{stage}</span>
                  <span className="text-xs text-gray-500 bg-white/70 px-1.5 py-0.5 rounded-full">{leads.length}</span>
                </div>
                <div className="space-y-2 flex-1 overflow-y-auto max-h-[calc(100vh-240px)]">
                  {leads.map(lead => (
                    <button key={lead.id} onClick={() => openLead(lead)} className="w-full text-left">
                      <div className="bg-white rounded-lg border border-gray-100 p-3 shadow-sm hover:shadow-md transition-shadow">
                        <div className="flex items-start justify-between mb-1.5">
                          <span className="text-sm font-semibold text-gray-900 leading-tight line-clamp-2"
                            style={{ fontFamily: 'var(--font-sora)' }}>{lead.name}</span>
                          <ScoreBadge score={lead.score} />
                        </div>
                        <p className="text-xs text-gray-500">{lead.city}, {lead.state}</p>
                        {lead.nextFollowUp && (
                          <p className="text-xs text-amber-600 mt-1">
                            Follow-up: {new Date(lead.nextFollowUp).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                    </button>
                  ))}
                  {leads.length === 0 && (
                    <p className="text-xs text-gray-400 text-center py-4">No leads</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Side panel */}
      {selectedLead && (
        <div className="fixed inset-y-0 right-0 w-96 bg-white border-l border-gray-200 shadow-xl z-50 flex flex-col overflow-hidden">
          <div className="flex items-start justify-between p-5 border-b border-gray-100">
            <div className="flex-1 min-w-0">
              <h2 className="font-bold text-gray-900 text-base leading-tight" style={{ fontFamily: 'var(--font-sora)' }}>
                {selectedLead.name}
              </h2>
              <p className="text-sm text-gray-500 mt-0.5">{selectedLead.city}, {selectedLead.state}</p>
              <div className="flex items-center gap-2 mt-2">
                <ScoreBadge score={selectedLead.score} />
                <span className="text-xs capitalize text-gray-600 bg-gray-100 px-2 py-0.5 rounded-full">
                  {selectedLead.status}
                </span>
              </div>
            </div>
            <button onClick={() => setSelectedLead(null)} className="p-1 text-gray-400 hover:text-gray-600">
              <X size={18} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {/* Contact info */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Contact</p>
              {selectedLead.phone && (
                <a href={`tel:${selectedLead.phone}`} className="flex items-center gap-2 text-sm text-gray-700 hover:text-[#0F4C81]">
                  <Phone size={13} /> {selectedLead.phone}
                </a>
              )}
              {selectedLead.email && (
                <p className="flex items-center gap-2 text-sm text-gray-700">
                  <Mail size={13} /> {selectedLead.email}
                </p>
              )}
              {selectedLead.website && (
                <a href={selectedLead.website} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-[#0F4C81] hover:underline">
                  <ExternalLink size={13} /> Website
                </a>
              )}
              <p className="flex items-center gap-2 text-sm text-gray-600 text-xs">{selectedLead.address}</p>
            </div>

            {/* Details */}
            {(selectedLead.ownerName || selectedLead.businessType) && (
              <div className="space-y-1">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Details</p>
                {selectedLead.ownerName && <p className="text-sm text-gray-700">Owner: {selectedLead.ownerName}</p>}
                {selectedLead.businessType && <p className="text-sm text-gray-700 capitalize">Type: {selectedLead.businessType}</p>}
              </div>
            )}

            {/* Notes */}
            {selectedLead.notes && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Notes</p>
                <p className="text-sm text-gray-700 whitespace-pre-line">{selectedLead.notes}</p>
              </div>
            )}

            {/* Follow-up */}
            {selectedLead.nextFollowUp && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Next Follow-up</p>
                <p className="text-sm text-amber-600 font-medium">
                  {new Date(selectedLead.nextFollowUp).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                </p>
              </div>
            )}

            {/* Outreach history */}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Outreach History</p>
              {outreachError && (
                <p className="text-xs text-red-500 flex items-center gap-1 mb-2"><AlertCircle size={12} />Failed to load outreach history</p>
              )}
              {loadingOutreach ? (
                <div className="space-y-2">
                  {[1,2].map(i => <div key={i} className="h-12 bg-gray-50 rounded-lg animate-pulse" />)}
                </div>
              ) : outreach.length === 0 && !outreachError ? (
                <p className="text-sm text-gray-400">No outreach yet</p>
              ) : (
                <div className="space-y-2">
                  {outreach.map(entry => (
                    <div key={entry.id} className="bg-gray-50 rounded-lg p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-gray-700 capitalize">{entry.channel}</span>
                        <span className="text-xs text-gray-400">{new Date(entry.sentAt).toLocaleDateString()}</span>
                      </div>
                      {entry.subject && <p className="text-xs text-gray-600 mt-1 truncate">{entry.subject}</p>}
                      <p className="text-xs text-gray-400 mt-0.5">
                        by {entry.sentByName ?? 'Unknown'} · {entry.status}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="p-4 border-t border-gray-100 space-y-2">
            {!['closed', 'lost'].includes(selectedLead.status) && (
              <button
                onClick={() => moveToNext(selectedLead)}
                disabled={movingTo === selectedLead.id}
                className="w-full bg-[#0F4C81] hover:bg-[#0a3d6b] text-white py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60"
              >
                Move to next stage <ChevronRight size={15} />
              </button>
            )}
            <Link href={`/dashboard/leads/${selectedLead.id}`}
              className="block w-full text-center border border-gray-200 py-2.5 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">
              Open full profile
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
