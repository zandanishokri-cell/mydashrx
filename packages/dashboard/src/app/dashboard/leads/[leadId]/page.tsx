'use client';
import { useEffect, useState, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams, useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import {
  ArrowLeft, Phone, Mail, ExternalLink, Star, Calendar,
  Tag, Save, Send, X, Clock, Sparkles, Trash2
} from 'lucide-react';

interface Lead {
  id: string; orgId: string; name: string; address: string; city: string;
  state: string; zip: string | null; phone: string | null; email: string | null;
  website: string | null; ownerName: string | null; businessType: string | null;
  googlePlaceId: string | null; rating: number | null; reviewCount: number | null;
  score: number; status: string; notes: string | null; nextFollowUp: string | null;
  lastContactedAt: string | null; tags: string[]; createdAt: string; updatedAt: string;
}

interface OutreachEntry {
  id: string; channel: string; subject: string | null; body: string | null;
  sentAt: string; status: string; sentByName: string | null;
}

const STATUSES = ['new', 'contacted', 'interested', 'negotiating', 'closed', 'lost'];
const STATUS_COLORS: Record<string, string> = {
  new: 'bg-blue-100 text-blue-700',
  contacted: 'bg-purple-100 text-purple-700',
  interested: 'bg-amber-100 text-amber-700',
  negotiating: 'bg-orange-100 text-orange-700',
  closed: 'bg-emerald-100 text-emerald-700',
  lost: 'bg-gray-100 text-gray-500',
};

function ScoreBadge({ score }: { score: number }) {
  const cls = score >= 70 ? 'bg-emerald-100 text-emerald-700'
    : score >= 40 ? 'bg-amber-100 text-amber-700'
    : 'bg-gray-100 text-gray-600';
  return <span className={`text-sm font-bold px-2.5 py-1 rounded-full ${cls}`}>{score}/100</span>;
}

function LeadDetailContent({ leadId }: { leadId: string }) {
  const [user] = useState(getUser);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [lead, setLead] = useState<Lead | null>(null);
  const [outreach, setOutreach] = useState<OutreachEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [showEmailModal, setShowEmailModal] = useState(searchParams.get('tab') === 'outreach');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [sendingEmail, setSendingEmail] = useState(false);
  const [generatingDraft, setGeneratingDraft] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const data = await api.get<{ lead: Lead; outreach: OutreachEntry[] }>(`/orgs/${user.orgId}/leads/${leadId}`);
      setLead(data.lead);
      setOutreach(data.outreach);
      setNotes(data.lead.notes ?? '');
      setStatus(data.lead.status);
      setTags(data.lead.tags ?? []);
      setFollowUp(data.lead.nextFollowUp ? data.lead.nextFollowUp.split('T')[0] : '');
      setLoadError(false);
    } catch (err: any) {
      // Only redirect on a true 404; show retry card for network/server errors
      if (err?.message?.includes('404') || err?.status === 404 || err?.statusCode === 404) {
        router.push('/dashboard/leads');
      } else {
        setLoadError(true);
      }
    }
    finally { setLoading(false); }
  }, [user, leadId, router]);

  useEffect(() => { load(); }, [load]);

  const save = async (updates: Record<string, unknown>) => {
    if (!user || !lead) return;
    setSaving(true);
    try {
      const updated = await api.patch<Lead>(`/orgs/${user.orgId}/leads/${lead.id}`, updates);
      setLead(updated);
      showToast('Saved');
    } catch (err) {
      showToast('Save failed');
      throw err; // re-throw so callers can rollback optimistic UI
    } finally { setSaving(false); }
  };

  const handleStatusChange = (s: string) => {
    if (s === status) return;
    const prev = status;
    setStatus(s);
    save({ status: s }).catch(() => setStatus(prev)); // rollback on failure
  };

  const handleNotesSave = () => save({ notes });

  const handleFollowUpSave = () => save({ nextFollowUp: followUp || null });

  const addTag = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && tagInput.trim()) {
      e.preventDefault();
      const prev = tags;
      const newTags = [...new Set([...tags, tagInput.trim()])];
      setTags(newTags);
      setTagInput('');
      save({ tags: newTags }).catch(() => setTags(prev));
    }
  };

  const removeTag = (t: string) => {
    const prev = tags;
    const newTags = tags.filter(tag => tag !== t);
    setTags(newTags);
    save({ tags: newTags }).catch(() => setTags(prev));
  };

  const generateDraft = async () => {
    if (!lead || generatingDraft) return;
    setGeneratingDraft(true);
    try {
      const draft = await api.post<{ subject: string; body: string }>(
        `/orgs/${user!.orgId}/leads/${lead.id}/draft-outreach`,
        {},
      );
      setEmailSubject(draft.subject);
      setEmailBody(draft.body);
    } catch {
      showToast('Failed to generate draft. Please try again.');
    } finally {
      setGeneratingDraft(false);
    }
  };

  const sendEmail = async () => {
    if (!user || !lead || !emailSubject || !emailBody) return;
    setSendingEmail(true);
    try {
      await api.post(`/orgs/${user.orgId}/leads/${lead.id}/outreach`, {
        subject: emailSubject, body: emailBody,
      });
      setShowEmailModal(false);
      setEmailSubject('');
      setEmailBody('');
      showToast('Email sent');
      await load();
    } catch (err: any) {
      showToast(err.message ?? 'Failed to send email');
    } finally {
      setSendingEmail(false);
    }
  };

  const deleteLead = async () => {
    if (!user || !lead) return;
    setDeleting(true);
    try {
      await api.del(`/orgs/${user.orgId}/leads/${lead.id}`);
      router.push('/dashboard/leads');
    } catch {
      showToast('Failed to delete lead');
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-8 w-48 bg-gray-100 rounded-lg animate-pulse" />
        <div className="h-64 bg-white rounded-xl border border-gray-100 animate-pulse" />
      </div>
    );
  }

  if (loadError) return (
    <div className="p-6 text-center">
      <p className="text-gray-700 font-medium mb-1">Failed to load lead profile</p>
      <p className="text-gray-400 text-sm mb-4">Check your connection and try again.</p>
      <button onClick={load} className="text-sm bg-[#0F4C81] text-white px-4 py-2 rounded-lg hover:bg-[#0a3d6b]">Retry</button>
    </div>
  );

  if (!lead) return null;

  return (
    <div className="p-6 max-w-5xl space-y-6">
      {/* Toast — persistent role=status container (WCAG 4.1.3 AA) */}
      <div role="status" aria-live="polite" aria-atomic="true" className="fixed top-4 right-4 z-50 pointer-events-none">
        {toast && (
          <div className="bg-gray-900 text-white px-4 py-3 rounded-xl shadow-lg text-sm font-medium pointer-events-auto">
            {toast}
          </div>
        )}
      </div>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/leads" className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50">
            <ArrowLeft size={15} className="text-gray-600" />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-gray-900" style={{ fontFamily: 'var(--font-sora)' }}>{lead.name}</h1>
            <p className="text-sm text-gray-500 mt-0.5">{lead.address}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ScoreBadge score={lead.score} />
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="p-2 rounded-lg border border-red-200 text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors"
            title="Delete lead"
          >
            <Trash2 size={14} />
          </button>
          <button
            onClick={() => setShowEmailModal(true)}
            className="bg-[#0F4C81] hover:bg-[#0a3d6b] text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2"
          >
            <Send size={13} /> Send Email
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column — lead info */}
        <div className="lg:col-span-2 space-y-5">
          {/* Info card */}
          <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm space-y-4">
            <h2 className="text-sm font-semibold text-gray-700">Lead Information</h2>

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs text-gray-500 mb-0.5">Phone</p>
                {lead.phone
                  ? <a href={`tel:${lead.phone}`} className="flex items-center gap-1.5 text-gray-900 hover:text-[#0F4C81]">
                      <Phone size={12} /> {lead.phone}
                    </a>
                  : <span className="text-gray-400">—</span>}
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-0.5">Email</p>
                {lead.email
                  ? <a href={`mailto:${lead.email}`} className="flex items-center gap-1.5 text-gray-900 hover:text-[#0F4C81] truncate">
                      <Mail size={12} /> {lead.email}
                    </a>
                  : <span className="text-gray-400">—</span>}
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-0.5">Website</p>
                {lead.website
                  ? <a href={lead.website} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-[#0F4C81] hover:underline truncate">
                      <ExternalLink size={12} /> {(() => { try { return new URL(lead.website!).hostname; } catch { return lead.website!; } })()}
                    </a>
                  : <span className="text-gray-400">—</span>}
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-0.5">Owner</p>
                <span className="text-gray-900">{lead.ownerName ?? '—'}</span>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-0.5">Business Type</p>
                <span className="text-gray-900 capitalize">{lead.businessType ?? '—'}</span>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-0.5">Google Rating</p>
                {lead.rating
                  ? <span className="flex items-center gap-1 text-amber-500 text-sm">
                      <Star size={12} fill="currentColor" /> {lead.rating} ({lead.reviewCount} reviews)
                    </span>
                  : <span className="text-gray-400">—</span>}
              </div>
            </div>

            {/* Status */}
            <div>
              <p className="text-xs text-gray-500 mb-1.5">Status</p>
              <div className="flex flex-wrap gap-1.5">
                {STATUSES.map(s => (
                  <button key={s} onClick={() => handleStatusChange(s)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors border ${
                      status === s
                        ? `${STATUS_COLORS[s]} border-transparent`
                        : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Notes</h2>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={5}
              placeholder="Add notes about this lead…"
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-[#0F4C81]/20"
            />
            <button onClick={handleNotesSave} disabled={saving}
              className="mt-2 flex items-center gap-1.5 bg-[#0F4C81] hover:bg-[#0a3d6b] text-white px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-60">
              <Save size={13} /> {saving ? 'Saving…' : 'Save Notes'}
            </button>
          </div>

          {/* Outreach history */}
          <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-700">Outreach History</h2>
              <button onClick={() => setShowEmailModal(true)}
                className="text-xs text-[#0F4C81] hover:underline flex items-center gap-1">
                <Send size={11} /> Send email
              </button>
            </div>

            {outreach.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">No outreach yet. Send the first email to get started.</p>
            ) : (
              <div className="space-y-3">
                {outreach.map(entry => (
                  <div key={entry.id} className="flex gap-3">
                    <div className="w-8 h-8 bg-blue-50 rounded-full flex items-center justify-center shrink-0 mt-0.5">
                      <Mail size={14} className="text-[#0F4C81]" />
                    </div>
                    <div className="flex-1 bg-gray-50 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-semibold text-gray-700 capitalize">
                          {entry.channel} · {entry.status}
                        </span>
                        <span className="text-xs text-gray-400 flex items-center gap-1">
                          <Clock size={10} /> {new Date(entry.sentAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      {entry.subject && <p className="text-sm font-medium text-gray-900">{entry.subject}</p>}
                      <p className="text-xs text-gray-500 mt-0.5">Sent by {entry.sentByName ?? 'Unknown'}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right column — sidebar */}
        <div className="space-y-5">
          {/* Next follow-up */}
          <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <Calendar size={14} /> Next Follow-up
            </h2>
            <input type="date" value={followUp} onChange={e => setFollowUp(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0F4C81]/20"
            />
            <button onClick={handleFollowUpSave} disabled={saving}
              className="mt-2 w-full bg-[#0F4C81] hover:bg-[#0a3d6b] text-white py-1.5 rounded-lg text-sm font-medium disabled:opacity-60">
              Set Date
            </button>
            {lead.lastContactedAt && (
              <p className="text-xs text-gray-400 mt-2 text-center">
                Last contact: {new Date(lead.lastContactedAt).toLocaleDateString()}
              </p>
            )}
          </div>

          {/* Tags */}
          <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <Tag size={14} /> Tags
            </h2>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {tags.map(t => (
                <span key={t} className="flex items-center gap-1 bg-blue-50 text-blue-700 text-xs px-2 py-1 rounded-full">
                  {t}
                  <button onClick={() => removeTag(t)} className="hover:text-blue-900"><X size={10} /></button>
                </span>
              ))}
            </div>
            <input
              value={tagInput}
              onChange={e => setTagInput(e.target.value)}
              onKeyDown={addTag}
              placeholder="Add tag, press Enter…"
              className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0F4C81]/20"
            />
          </div>

          {/* Meta */}
          <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm text-xs text-gray-500 space-y-1">
            <p>Added: {new Date(lead.createdAt).toLocaleDateString()}</p>
            <p>Updated: {new Date(lead.updatedAt).toLocaleDateString()}</p>
            {lead.googlePlaceId && <p className="truncate">Place ID: {lead.googlePlaceId}</p>}
          </div>
        </div>
      </div>

      {/* Email modal */}
      {showEmailModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900" style={{ fontFamily: 'var(--font-sora)' }}>
                Send Email to {lead.name}
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={generateDraft}
                  disabled={generatingDraft}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-violet-50 text-violet-700 hover:bg-violet-100 disabled:opacity-50 transition-colors"
                >
                  {generatingDraft ? (
                    <>
                      <span className="animate-spin inline-block w-3 h-3 border border-violet-500 border-t-transparent rounded-full" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Sparkles size={12} />
                      Generate Draft
                    </>
                  )}
                </button>
                <button onClick={() => setShowEmailModal(false)} className="p-1 text-gray-400 hover:text-gray-600">
                  <X size={18} />
                </button>
              </div>
            </div>
            <div className="p-5 space-y-4">
              {!lead.email && (
                <div className="bg-amber-50 border border-amber-200 text-amber-700 rounded-lg p-3 text-sm">
                  No email on file. Add an email address to send outreach.
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">To</label>
                <input readOnly value={lead.email ?? '(no email on file)'}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 text-gray-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Subject</label>
                <input
                  value={emailSubject} onChange={e => setEmailSubject(e.target.value)}
                  placeholder="Partnership opportunity with MyDashRx"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0F4C81]/20"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Body</label>
                <textarea
                  value={emailBody} onChange={e => setEmailBody(e.target.value)}
                  rows={7}
                  placeholder="Hi [Name], I wanted to reach out about our pharmacy delivery platform…"
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-[#0F4C81]/20"
                />
              </div>
            </div>
            <div className="flex gap-2 p-5 border-t border-gray-100">
              <button onClick={() => setShowEmailModal(false)}
                className="flex-1 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">
                Cancel
              </button>
              <button
                onClick={sendEmail}
                disabled={sendingEmail || !lead.email || !emailSubject || !emailBody}
                className="flex-1 bg-[#0F4C81] hover:bg-[#0a3d6b] text-white py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60"
              >
                <Send size={13} /> {sendingEmail ? 'Sending…' : 'Send Email'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation dialog */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                <Trash2 size={18} className="text-red-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 text-sm">Delete Lead</h3>
                <p className="text-xs text-gray-500 mt-0.5">This action cannot be undone.</p>
              </div>
            </div>
            <p className="text-sm text-gray-700 mb-6">
              Are you sure you want to delete <span className="font-medium">{lead.name}</span>? All outreach history and notes will be permanently removed.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
                className="flex-1 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={deleteLead}
                disabled={deleting}
                className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium flex items-center justify-center gap-1.5 disabled:opacity-60"
              >
                <Trash2 size={13} /> {deleting ? 'Deleting…' : 'Delete Lead'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function LeadDetailPage() {
  const { leadId } = useParams<{ leadId: string }>();
  return (
    <Suspense fallback={
      <div className="p-6 space-y-4">
        <div className="h-8 w-48 bg-gray-100 rounded-lg animate-pulse" />
        <div className="h-64 bg-white rounded-xl border border-gray-100 animate-pulse" />
      </div>
    }>
      <LeadDetailContent leadId={leadId} />
    </Suspense>
  );
}
