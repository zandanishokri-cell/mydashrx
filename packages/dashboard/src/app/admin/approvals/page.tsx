'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';

type PendingOrg = {
  org: {
    id: string; name: string; createdAt: string;
    riskFlags?: string[] | null; hipaaBaaStatus?: string; billingPlan?: string;
    approvalReminderSentAt?: Record<string, string> | null;
    onHold?: boolean; holdReason?: string | null; holdRequestedAt?: string | null;
    noteCount?: number;
    npiNumber?: string | null; npiVerified?: boolean | null; npiVerifiedAt?: string | null; // P-ADM16
  };
  admin: { id: string; name: string; email: string; createdAt: string } | null;
};

type ApprovalNote = { id: string; adminEmail: string; content: string; createdAt: string };

type AuditEntry = {
  id: string; actorEmail: string; action: string;
  targetName: string; metadata: { reason?: string } | null;
  createdAt: string;
};

const REJECTION_REASONS = [
  { value: 'missing_license_proof',  label: 'Missing pharmacy license documentation' },
  { value: 'invalid_npi',            label: 'NPI number could not be verified' },
  { value: 'high_fraud_risk',        label: 'High fraud risk / suspicious application' },
  { value: 'incomplete_application', label: 'Application information incomplete' },
  { value: 'duplicate_account',      label: 'Duplicate account — pharmacy already exists' },
  { value: 'service_area',           label: 'Outside current service area (Michigan only)' },
  { value: 'other',                  label: 'Other (explain in note)' },
];

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const hrs = Math.floor(diff / 3600000);
  if (hrs < 1) return 'just now';
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function useLiveTimer() {
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => forceUpdate(n => n + 1), 60_000);
    return () => clearInterval(interval);
  }, []);
}

function SlaCountdown({ createdAt }: { createdAt: string }) {
  useLiveTimer();
  const elapsedMs = Date.now() - new Date(createdAt).getTime();
  const fmt = (ms: number) => {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };
  if (elapsedMs < 4 * 3600000) {
    const remaining = 4 * 3600000 - elapsedMs;
    return <span className="text-xs text-green-600">{fmt(remaining)} left</span>;
  }
  if (elapsedMs < 24 * 3600000) {
    return <span className="text-xs text-amber-600">Past SLA by {fmt(elapsedMs - 4 * 3600000)}</span>;
  }
  return <span className="text-xs text-red-600">⚠ Overdue by {fmt(elapsedMs - 24 * 3600000)}</span>;
}

function getAgingClass(createdAt: string): { border: string; badge: string; label: string } {
  const hrs = (Date.now() - new Date(createdAt).getTime()) / 3600000;
  if (hrs > 24) return {
    border: 'border-red-200 bg-red-50/20',
    badge: 'bg-red-50 text-red-700 border-red-100',
    label: '⚠ Overdue',
  };
  if (hrs > 4) return {
    border: 'border-amber-200 bg-amber-50/20',
    badge: 'bg-amber-50 text-amber-700 border-amber-100',
    label: 'Past SLA',
  };
  return {
    border: 'border-gray-100',
    badge: 'bg-amber-50 text-amber-700 border-amber-100',
    label: 'Pending',
  };
}

function DetailDrawer({
  item,
  acting,
  onApprove,
  onReject,
  onClose,
  onHoldToggle,
}: {
  item: PendingOrg;
  acting: Record<string, 'approving' | 'rejecting'>;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onClose: () => void;
  onHoldToggle: (orgId: string, currentHold: boolean) => void;
}) {
  const { org, admin } = item;
  const aging = getAgingClass(org.createdAt);
  const [notes, setNotes] = useState<ApprovalNote[]>([]);
  const [noteInput, setNoteInput] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);
  const [holdInput, setHoldInput] = useState('');
  const [showHoldForm, setShowHoldForm] = useState(false);
  const [holdSaving, setHoldSaving] = useState(false);
  const [notesLoaded, setNotesLoaded] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  useEffect(() => {
    // Load notes when drawer opens
    api.get<ApprovalNote[]>(`/admin/approvals/${org.id}/notes`)
      .then(n => { setNotes(n); setNotesLoaded(true); })
      .catch(() => setNotesLoaded(true));
  }, [org.id]);

  const addNote = async () => {
    if (!noteInput.trim()) return;
    setNoteSaving(true);
    try {
      const note = await api.post<ApprovalNote>(`/admin/approvals/${org.id}/notes`, { content: noteInput.trim() });
      setNotes(prev => [note, ...prev]);
      setNoteInput('');
    } catch { /* silent */ }
    finally { setNoteSaving(false); }
  };

  const deleteNote = async (noteId: string) => {
    try {
      await api.del(`/admin/approvals/${org.id}/notes/${noteId}`);
      setNotes(prev => prev.filter(n => n.id !== noteId));
    } catch { /* silent */ }
  };

  const submitHold = async () => {
    if (!holdInput.trim()) return;
    setHoldSaving(true);
    try {
      await api.post(`/admin/approvals/${org.id}/hold`, { holdReason: holdInput.trim() });
      setShowHoldForm(false);
      setHoldInput('');
      onHoldToggle(org.id, false);
    } catch { /* silent */ }
    finally { setHoldSaving(false); }
  };

  const releaseHold = async () => {
    setHoldSaving(true);
    try {
      await api.del(`/admin/approvals/${org.id}/hold`);
      onHoldToggle(org.id, true);
    } catch { /* silent */ }
    finally { setHoldSaving(false); }
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />
      {/* Drawer */}
      <div className="fixed top-0 right-0 h-full w-[440px] bg-white shadow-2xl z-50 flex flex-col border-l border-gray-100 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="font-semibold text-gray-900 text-base truncate">{org.name}</h2>
            {org.onHold && (
              <span className="shrink-0 px-2 py-0.5 text-xs font-medium rounded-full bg-blue-50 text-blue-700 border border-blue-100">
                On Hold
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="shrink-0 text-gray-400 hover:text-gray-600 transition-colors p-1 rounded-lg hover:bg-gray-100"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Status badges */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`px-2 py-0.5 text-xs font-medium rounded-full border ${aging.badge}`}>
              {aging.label}
            </span>
            <SlaCountdown createdAt={org.createdAt} />
          </div>

          {/* Hold banner */}
          {org.onHold && org.holdReason && (
            <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
              <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-1">Pending Information Request</p>
              <p className="text-sm text-blue-800">{org.holdReason}</p>
              {org.holdRequestedAt && (
                <p className="text-xs text-blue-500 mt-1">Sent {timeAgo(org.holdRequestedAt)}</p>
              )}
            </div>
          )}

          {/* Risk flags */}
          {org.riskFlags && org.riskFlags.length > 0 && (
            <div className="bg-orange-50 border border-orange-100 rounded-xl px-4 py-3">
              <p className="text-xs font-semibold text-orange-700 uppercase tracking-wide mb-1.5">Risk Flags</p>
              <div className="flex flex-wrap gap-1.5">
                {org.riskFlags.map(flag => (
                  <span key={flag} className="px-2 py-0.5 bg-orange-100 text-orange-800 text-xs rounded-full font-medium">
                    {flag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Org details */}
          <div className="space-y-1">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Organization</p>
            <DetailRow label="Name" value={org.name} />
            <DetailRow label="Applied" value={new Date(org.createdAt).toLocaleString()} />
            {org.hipaaBaaStatus && <DetailRow label="HIPAA BAA" value={org.hipaaBaaStatus} />}
            {org.billingPlan && <DetailRow label="Plan" value={org.billingPlan} />}
            {/* P-ADM16: NPI verification badge */}
            {org.npiNumber && (
              <div className="flex items-start justify-between py-1.5 border-b border-gray-50 last:border-0">
                <span className="text-xs text-gray-400 w-24 shrink-0">NPI</span>
                <div className="flex items-center gap-2 text-right">
                  <span className="text-sm text-gray-800">{org.npiNumber}</span>
                  {org.npiVerified ? (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs font-medium rounded bg-green-50 text-green-700 border border-green-200">
                      ✓ Verified
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-1.5 py-0.5 text-xs font-medium rounded bg-gray-100 text-gray-500 border border-gray-200">
                      Unverified
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Admin contact */}
          <div className="space-y-1">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Admin Contact</p>
            {admin ? (
              <>
                <DetailRow label="Name" value={admin.name} />
                <DetailRow label="Email" value={admin.email} />
                <DetailRow label="Registered" value={timeAgo(admin.createdAt)} />
              </>
            ) : (
              <p className="text-sm text-gray-400 italic">No admin user linked</p>
            )}
          </div>

          {/* P-ADM20: Hold-back actions */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Hold Back</p>
            {org.onHold ? (
              <button
                onClick={releaseHold}
                disabled={holdSaving}
                className="w-full px-3 py-2 text-sm font-medium text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-50 disabled:opacity-50 transition-colors"
              >
                {holdSaving ? 'Releasing…' : 'Release Hold — Resume Review'}
              </button>
            ) : showHoldForm ? (
              <div className="space-y-2">
                <textarea
                  value={holdInput}
                  onChange={e => setHoldInput(e.target.value)}
                  placeholder="What information do you need? This will be emailed to the pharmacy admin."
                  rows={3}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-200"
                />
                <div className="flex gap-2">
                  <button
                    onClick={submitHold}
                    disabled={holdSaving || !holdInput.trim()}
                    className="flex-1 px-3 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  >
                    {holdSaving ? 'Sending…' : 'Request Info'}
                  </button>
                  <button
                    onClick={() => { setShowHoldForm(false); setHoldInput(''); }}
                    className="px-3 py-2 text-sm text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowHoldForm(true)}
                className="w-full px-3 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors text-left"
              >
                Request more information from pharmacy
              </button>
            )}
          </div>

          {/* P-ADM19: Internal admin notes */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
              Internal Notes {notesLoaded && notes.length > 0 && <span className="normal-case font-normal">({notes.length})</span>}
            </p>
            <div className="flex gap-2">
              <textarea
                value={noteInput}
                onChange={e => setNoteInput(e.target.value)}
                placeholder="Add internal note (visible to admins only)…"
                rows={2}
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-gray-200"
              />
              <button
                onClick={addNote}
                disabled={noteSaving || !noteInput.trim()}
                className="px-3 py-2 text-sm font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50 transition-colors self-end"
              >
                {noteSaving ? '…' : 'Add'}
              </button>
            </div>
            {notesLoaded && notes.length > 0 && (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {notes.map(n => (
                  <div key={n.id} className="bg-gray-50 rounded-lg px-3 py-2 text-sm group relative">
                    <p className="text-gray-800 pr-6">{n.content}</p>
                    <p className="text-xs text-gray-400 mt-1">{n.adminEmail} · {timeAgo(n.createdAt)}</p>
                    <button
                      onClick={() => deleteNote(n.id)}
                      className="absolute top-2 right-2 text-gray-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Delete note"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
            {notesLoaded && notes.length === 0 && (
              <p className="text-xs text-gray-400 italic">No notes yet</p>
            )}
          </div>
        </div>

        {/* Footer actions */}
        <div className="px-5 py-4 border-t border-gray-100 flex gap-3">
          <button
            onClick={() => onApprove(org.id)}
            disabled={!!acting[org.id]}
            className="flex-1 bg-green-600 text-white text-sm font-semibold rounded-xl py-2.5 hover:bg-green-700 disabled:opacity-50 transition-colors"
          >
            {acting[org.id] === 'approving' ? 'Approving…' : 'Approve'}
          </button>
          <button
            onClick={() => onReject(org.id)}
            disabled={!!acting[org.id]}
            className="flex-1 border border-gray-200 text-gray-700 text-sm font-semibold rounded-xl py-2.5 hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            Reject
          </button>
        </div>
      </div>
    </>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between py-1.5 border-b border-gray-50 last:border-0">
      <span className="text-xs text-gray-400 w-24 shrink-0">{label}</span>
      <span className="text-sm text-gray-800 text-right break-all">{value}</span>
    </div>
  );
}

export default function ApprovalsPage() {
  const router = useRouter();
  const user = getUser();
  const [pending, setPending] = useState<PendingOrg[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [acting, setActing] = useState<Record<string, 'approving' | 'rejecting'>>({});
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectReasonCode, setRejectReasonCode] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchRejectOpen, setBatchRejectOpen] = useState(false);
  const [batchRejectCode, setBatchRejectCode] = useState('');
  const [batchRejectNote, setBatchRejectNote] = useState('');
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [confirmingBatchApprove, setConfirmingBatchApprove] = useState(false);
  const [approveUndoTimer, setApproveUndoTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [undoToast, setUndoToast] = useState<{ orgIds: string[]; count: number } | null>(null);
  // P-ADM16: Slideout detail panel
  const [selectedOrg, setSelectedOrg] = useState<PendingOrg | null>(null);

  // P-ADM20: handle hold toggle — update local state optimistically, reload in background
  const handleHoldToggle = useCallback((orgId: string, wasOnHold: boolean) => {
    setPending(prev => prev.map(item =>
      item.org.id === orgId
        ? { ...item, org: { ...item.org, onHold: !wasOnHold, holdReason: wasOnHold ? null : item.org.holdReason } }
        : item
    ));
    setSelectedOrg(prev =>
      prev?.org.id === orgId
        ? { ...prev, org: { ...prev.org, onHold: !wasOnHold, holdReason: wasOnHold ? null : prev.org.holdReason } }
        : prev
    );
    // Refresh in background after 500ms to sync server state
    setTimeout(() => {
      api.get<PendingOrg[]>('/admin/approvals').then(data => {
        const sorted = [...data].sort((a, b) =>
          new Date(a.org.createdAt).getTime() - new Date(b.org.createdAt).getTime()
        );
        setPending(sorted);
        setSelectedOrg(cur => cur ? sorted.find(r => r.org.id === cur.org.id) ?? null : null);
      }).catch(() => {});
    }, 500);
  }, []);
  // P-ADM29: Approval ops analytics stats
  const [approvalStats, setApprovalStats] = useState<{
    pending: number; approvedLast7d: number; rejectedLast7d: number;
    pendingOver24h: number; avgHoursToApproval: number | null;
  } | null>(null);

  useEffect(() => {
    if (!user || user.role !== 'super_admin') router.replace('/dashboard');
  }, []);

  if (!user || user.role !== 'super_admin') return null;

  const load = () => {
    setLoading(true);
    api.get<PendingOrg[]>('/admin/approvals')
      .then(data => {
        const sorted = [...data].sort((a, b) =>
          new Date(a.org.createdAt).getTime() - new Date(b.org.createdAt).getTime()
        );
        setPending(sorted);
      })
      .catch(() => setError('Failed to load pending approvals'))
      .finally(() => setLoading(false));
    api.get<AuditEntry[]>('/admin/audit-log')
      .then(setAuditLog)
      .catch(() => {});
    // P-ADM29: load approval health stats from existing /admin/stats
    api.get<{ approvalHealth?: { pending: number; approvedLast7d: number; rejectedLast7d: number; pendingOver24h: number; avgHoursToApproval: number | null } }>('/admin/stats')
      .then(s => { if (s.approvalHealth) setApprovalStats(s.approvalHealth); })
      .catch(() => {});
  };

  useEffect(() => { load(); }, []);

  const approve = async (orgId: string) => {
    setActing(a => ({ ...a, [orgId]: 'approving' }));
    try {
      await api.post(`/admin/approvals/${orgId}/approve`, {});
      setPending(p => p.filter(r => r.org.id !== orgId));
      setSelected(s => { s.delete(orgId); return new Set(s); });
      if (selectedOrg?.org.id === orgId) setSelectedOrg(null);
      load();
    } catch { setError('Failed to approve'); }
    finally { setActing(a => { const n = { ...a }; delete n[orgId]; return n; }); }
  };

  const reject = async (orgId: string, reasonCode: string) => {
    setActing(a => ({ ...a, [orgId]: 'rejecting' }));
    try {
      await api.post(`/admin/approvals/${orgId}/reject`, {
        reason: reasonCode || undefined,
        note: rejectReason || undefined,
      });
      setPending(p => p.filter(r => r.org.id !== orgId));
      setRejectTarget(null);
      setRejectReason('');
      setRejectReasonCode('');
      setSelected(s => { s.delete(orgId); return new Set(s); });
      if (selectedOrg?.org.id === orgId) setSelectedOrg(null);
      load();
    } catch { setError('Failed to reject'); }
    finally { setActing(a => { const n = { ...a }; delete n[orgId]; return n; }); }
  };

  // Opens reject modal for org from either the row or the drawer
  const openRejectModal = (orgId: string) => {
    setRejectTarget(orgId);
    setRejectReason('');
    setRejectReasonCode('');
  };

  const batchApprove = async () => {
    if (selected.size === 0) return;
    setConfirmingBatchApprove(false);
    setBatchLoading(true);
    const orgIds = Array.from(selected);
    try {
      await api.post('/admin/approvals/batch', { orgIds, action: 'approve' });
      setPending(p => p.filter(r => !selected.has(r.org.id)));
      const count = selected.size;
      if (selectedOrg && selected.has(selectedOrg.org.id)) setSelectedOrg(null);
      setSelected(new Set());
      setUndoToast({ orgIds, count });
      const timer = setTimeout(() => setUndoToast(null), 10000);
      setApproveUndoTimer(timer);
      load();
    } catch { setError('Batch approve failed'); }
    finally { setBatchLoading(false); }
  };

  const batchReject = async () => {
    if (selected.size === 0 || !batchRejectCode) return;
    setBatchLoading(true);
    try {
      await Promise.all(
        Array.from(selected).map(orgId =>
          api.post(`/admin/approvals/${orgId}/reject`, {
            reason: batchRejectCode || undefined,
            note: batchRejectNote || undefined,
          })
        )
      );
      setPending(p => p.filter(r => !selected.has(r.org.id)));
      if (selectedOrg && selected.has(selectedOrg.org.id)) setSelectedOrg(null);
      setSelected(new Set());
      setBatchRejectOpen(false);
      setBatchRejectCode('');
      setBatchRejectNote('');
      load();
    } catch { setError('Batch reject failed'); }
    finally { setBatchLoading(false); }
  };

  const toggleSelect = (orgId: string) =>
    setSelected(s => { const n = new Set(s); n.has(orgId) ? n.delete(orgId) : n.add(orgId); return n; });

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Pending Approvals</h1>
          <p className="text-sm text-gray-500 mt-0.5">New pharmacy accounts awaiting review</p>
        </div>
      </div>

      {/* P-ADM29: Approval ops analytics card */}
      {approvalStats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <div className="bg-white border border-gray-100 rounded-xl px-4 py-3">
            <p className="text-xs text-gray-400 mb-1">Pending</p>
            <p className="text-2xl font-bold text-gray-900">{approvalStats.pending}</p>
          </div>
          <div className={`border rounded-xl px-4 py-3 ${approvalStats.pendingOver24h > 0 ? 'bg-red-50 border-red-100' : 'bg-white border-gray-100'}`}>
            <p className="text-xs text-gray-400 mb-1">Over 24h</p>
            <p className={`text-2xl font-bold ${approvalStats.pendingOver24h > 0 ? 'text-red-700' : 'text-gray-900'}`}>{approvalStats.pendingOver24h}</p>
          </div>
          <div className="bg-white border border-gray-100 rounded-xl px-4 py-3">
            <p className="text-xs text-gray-400 mb-1">Approved (7d)</p>
            <p className="text-2xl font-bold text-green-700">{approvalStats.approvedLast7d}</p>
          </div>
          <div className="bg-white border border-gray-100 rounded-xl px-4 py-3">
            <p className="text-xs text-gray-400 mb-1">Avg Approval</p>
            <p className="text-2xl font-bold text-gray-900">
              {approvalStats.avgHoursToApproval != null ? `${approvalStats.avgHoursToApproval}h` : '—'}
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-100 text-red-700 text-sm px-4 py-3 rounded-lg mb-4 flex justify-between">
          {error}
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />)}
        </div>
      ) : pending.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <svg className="w-10 h-10 mx-auto mb-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm">No pending approvals</p>
        </div>
      ) : (
        <div className="space-y-3">
          {pending.map(({ org, admin }) => {
            const aging = getAgingClass(org.createdAt);
            const isSelected = selectedOrg?.org.id === org.id;
            return (
              <div
                key={org.id}
                className={`bg-white rounded-xl border p-4 flex items-start gap-4 transition-colors cursor-pointer ${
                  selected.has(org.id) ? 'border-blue-200 bg-blue-50/30'
                  : isSelected ? 'border-[#0F4C81] ring-1 ring-[#0F4C81]/20'
                  : aging.border
                }`}
                onClick={(e) => {
                  // Don't open drawer when clicking checkbox or action buttons
                  if ((e.target as HTMLElement).closest('input,button')) return;
                  setSelectedOrg({ org, admin });
                }}
              >
                <input
                  type="checkbox"
                  checked={selected.has(org.id)}
                  onChange={() => toggleSelect(org.id)}
                  className="mt-1 accent-[#0F4C81]"
                  onClick={e => e.stopPropagation()}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    <p className="font-semibold text-gray-900 truncate">{org.name}</p>
                    <span className={`px-2 py-0.5 text-xs font-medium rounded-full border ${aging.badge}`}>
                      {aging.label}
                    </span>
                    {org.onHold && (
                      <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-blue-50 text-blue-700 border border-blue-100">
                        On Hold
                      </span>
                    )}
                    {org.noteCount != null && org.noteCount > 0 && (
                      <span className="px-1.5 py-0.5 text-xs text-gray-400 bg-gray-100 rounded-full">
                        {org.noteCount} note{org.noteCount !== 1 ? 's' : ''}
                      </span>
                    )}
                    {org.npiVerified && (
                      <span className="px-1.5 py-0.5 text-xs font-medium rounded bg-green-50 text-green-700 border border-green-200">
                        ✓ NPI
                      </span>
                    )}
                    {org.riskFlags && org.riskFlags.length > 0 && (
                      <span className="px-1.5 py-0.5 text-xs font-medium rounded bg-orange-50 text-orange-700 border border-orange-200">
                        ⚠ {org.riskFlags.join(', ')}
                      </span>
                    )}
                  </div>
                  {admin ? (
                    <p className="text-sm text-gray-500">{admin.name} · <span className="text-gray-400">{admin.email}</span></p>
                  ) : (
                    <p className="text-sm text-gray-400 italic">No admin user found</p>
                  )}
                  <div className="mt-1"><SlaCountdown createdAt={org.createdAt} /></div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={(e) => { e.stopPropagation(); approve(org.id); }}
                    disabled={!!acting[org.id]}
                    className="px-3 py-1.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
                  >
                    {acting[org.id] === 'approving' ? 'Approving…' : 'Approve'}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); openRejectModal(org.id); }}
                    disabled={!!acting[org.id]}
                    className="px-3 py-1.5 border border-gray-200 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
                  >
                    Reject
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* P-ADM16: Detail slideout drawer */}
      {selectedOrg && (
        <DetailDrawer
          item={selectedOrg}
          acting={acting}
          onApprove={approve}
          onReject={openRejectModal}
          onClose={() => setSelectedOrg(null)}
          onHoldToggle={handleHoldToggle}
        />
      )}

      {/* Single reject modal */}
      {rejectTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
            <h3 className="font-semibold text-gray-900 mb-1">Reject application</h3>
            <p className="text-sm text-gray-500 mb-4">Select a reason. This will be included in the notification email.</p>
            <select
              value={rejectReasonCode}
              onChange={e => setRejectReasonCode(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-200 mb-3 bg-white"
            >
              <option value="">Select a reason…</option>
              {REJECTION_REASONS.map(r => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
            {(rejectReasonCode === 'other' || rejectReasonCode === '') && (
              <textarea
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                placeholder={rejectReasonCode === 'other' ? 'Please explain…' : 'Additional notes (optional)'}
                rows={3}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-200 mb-4 resize-none"
              />
            )}
            {rejectReasonCode && rejectReasonCode !== 'other' && (
              <textarea
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                placeholder="Additional notes (optional)"
                rows={2}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-200 mb-4 resize-none"
              />
            )}
            <div className="flex gap-3">
              <button
                onClick={() => { setRejectTarget(null); setRejectReasonCode(''); setRejectReason(''); }}
                className="flex-1 border border-gray-200 text-gray-600 rounded-lg py-2 text-sm font-medium hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => reject(rejectTarget, rejectReasonCode)}
                disabled={!!acting[rejectTarget] || !rejectReasonCode}
                className="flex-1 bg-red-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-red-700 disabled:opacity-50"
              >
                {acting[rejectTarget] === 'rejecting' ? 'Rejecting…' : 'Confirm rejection'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Batch reject modal */}
      {batchRejectOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
            <h3 className="font-semibold text-gray-900 mb-1">Reject {selected.size} application{selected.size !== 1 ? 's' : ''}</h3>
            <p className="text-sm text-gray-500 mb-2">Select a reason to apply to all selected applications.</p>
            {selected.size > 0 && (
              <ul className="text-xs text-gray-600 bg-gray-50 rounded-lg p-2 mb-3 max-h-24 overflow-y-auto space-y-0.5">
                {Array.from(selected).slice(0, 10).map(id => {
                  const org = pending.find(r => r.org.id === id)?.org;
                  return org ? <li key={id} className="truncate">• {org.name}</li> : null;
                })}
                {selected.size > 10 && <li className="text-gray-400">…and {selected.size - 10} more</li>}
              </ul>
            )}
            <select
              value={batchRejectCode}
              onChange={e => setBatchRejectCode(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-200 mb-3 bg-white"
            >
              <option value="">Select a reason…</option>
              {REJECTION_REASONS.map(r => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
            {(batchRejectCode === 'other' || batchRejectCode === '') && (
              <textarea
                value={batchRejectNote}
                onChange={e => setBatchRejectNote(e.target.value)}
                placeholder={batchRejectCode === 'other' ? 'Please explain…' : 'Additional notes (optional)'}
                rows={2}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-200 mb-4 resize-none"
              />
            )}
            <div className="flex gap-3">
              <button
                onClick={() => { setBatchRejectOpen(false); setBatchRejectCode(''); setBatchRejectNote(''); }}
                className="flex-1 border border-gray-200 text-gray-600 rounded-lg py-2 text-sm font-medium hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={batchReject}
                disabled={batchLoading || !batchRejectCode}
                className="flex-1 bg-red-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-red-700 disabled:opacity-50"
              >
                {batchLoading ? 'Rejecting…' : `Reject ${selected.size}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Recent Activity (audit log) */}
      {auditLog.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Recent Activity</h2>
          <div className="space-y-2">
            {auditLog.slice(0, 10).map(entry => (
              <div key={entry.id} className="flex items-start gap-3 text-sm text-gray-500 py-2 border-b border-gray-50 last:border-0">
                <span className={`mt-0.5 shrink-0 w-2 h-2 rounded-full ${entry.action.startsWith('approve') ? 'bg-green-400' : 'bg-red-400'}`} />
                <div className="flex-1">
                  <span className="text-gray-700 font-medium">{entry.targetName}</span>
                  {' '}
                  <span className={entry.action.startsWith('approve') ? 'text-green-600' : 'text-red-500'}>
                    {entry.action.startsWith('approve') ? 'approved' : 'rejected'}
                  </span>
                  {' by '}
                  <span className="text-gray-600">{entry.actorEmail}</span>
                  {entry.metadata?.reason && (
                    <span className="text-gray-400"> · {entry.metadata.reason}</span>
                  )}
                </div>
                <span className="text-xs text-gray-400 shrink-0">{timeAgo(entry.createdAt)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* P-ADM13: Undo toast after batch approve */}
      {undoToast && (
        <div className="fixed bottom-20 right-6 z-50 bg-gray-900 text-white text-sm rounded-xl px-4 py-3 shadow-lg flex items-center gap-3">
          <span>Approved {undoToast.count} pharmacies</span>
          <button
            onClick={() => {
              if (approveUndoTimer) clearTimeout(approveUndoTimer);
              setUndoToast(null);
            }}
            className="text-gray-300 hover:text-white text-xs border border-gray-600 rounded px-2 py-0.5"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* P-ADM2: Sticky bulk action bar */}
      {selected.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-between bg-white border-t border-gray-200 shadow-lg px-6 py-3 md:left-56">
          <p className="text-sm font-medium text-gray-700">
            <span className="font-semibold text-[#0F4C81]">{selected.size}</span> application{selected.size !== 1 ? 's' : ''} selected
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setSelected(new Set())}
              className="px-3 py-1.5 border border-gray-200 text-gray-500 text-sm rounded-lg hover:bg-gray-50 transition-colors"
            >
              Deselect all
            </button>
            {confirmingBatchApprove ? (
              <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-1.5">
                <span className="text-sm text-green-800">Approve {selected.size} pharmacies?</span>
                <button onClick={batchApprove} className="px-3 py-1 bg-green-600 text-white text-sm rounded-md font-medium hover:bg-green-700">
                  Confirm
                </button>
                <button onClick={() => setConfirmingBatchApprove(false)} className="text-sm text-green-600 hover:text-green-800">
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => selected.size >= 3 ? setConfirmingBatchApprove(true) : batchApprove()}
                disabled={batchLoading}
                className="px-4 py-1.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
              >
                {batchLoading ? 'Processing…' : `Approve (${selected.size})`}
              </button>
            )}
            <button
              onClick={() => setBatchRejectOpen(true)}
              disabled={batchLoading}
              className="px-4 py-1.5 border border-red-200 text-red-600 text-sm font-medium rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors"
            >
              Reject ({selected.size})
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
