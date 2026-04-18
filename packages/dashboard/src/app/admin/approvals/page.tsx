'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';

type PendingOrg = {
  org: { id: string; name: string; createdAt: string };
  admin: { id: string; name: string; email: string; createdAt: string } | null;
};

type AuditEntry = {
  id: string; actorEmail: string; action: string;
  targetName: string; metadata: { reason?: string } | null;
  createdAt: string;
};

const REJECTION_REASONS = [
  { value: 'incomplete_info',    label: 'Incomplete application information' },
  { value: 'duplicate',          label: 'Duplicate application' },
  { value: 'license_unverified', label: 'Unable to verify pharmacy license' },
  { value: 'outside_area',       label: 'Outside current service area' },
  { value: 'suspicious',         label: 'Suspicious or fraudulent application' },
  { value: 'other',              label: 'Other (explain below)' },
];

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const hrs = Math.floor(diff / 3600000);
  if (hrs < 1) return 'just now';
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
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

  useEffect(() => {
    if (!user || user.role !== 'super_admin') router.replace('/dashboard');
  }, []);

  if (!user || user.role !== 'super_admin') return null;

  const load = () => {
    setLoading(true);
    api.get<PendingOrg[]>('/admin/approvals')
      .then(data => {
        // Sort oldest first — highest urgency at top
        const sorted = [...data].sort((a, b) =>
          new Date(a.org.createdAt).getTime() - new Date(b.org.createdAt).getTime()
        );
        setPending(sorted);
      })
      .catch(() => setError('Failed to load pending approvals'))
      .finally(() => setLoading(false));
    api.get<AuditEntry[]>('/admin/audit-log')
      .then(setAuditLog)
      .catch(() => {}); // non-blocking — audit log endpoint may not exist yet
  };

  useEffect(() => { load(); }, []);

  const approve = async (orgId: string) => {
    setActing(a => ({ ...a, [orgId]: 'approving' }));
    try {
      await api.post(`/admin/approvals/${orgId}/approve`, {});
      setPending(p => p.filter(r => r.org.id !== orgId));
      setSelected(s => { s.delete(orgId); return new Set(s); });
      load(); // refresh audit log
    } catch { setError('Failed to approve'); }
    finally { setActing(a => { const n = { ...a }; delete n[orgId]; return n; }); }
  };

  const reject = async (orgId: string, reasonCode: string) => {
    setActing(a => ({ ...a, [orgId]: 'rejecting' }));
    try {
      const reasonLabel = REJECTION_REASONS.find(r => r.value === reasonCode)?.label ?? '';
      const fullReason = reasonCode === 'other'
        ? rejectReason
        : `${reasonLabel}${rejectReason ? ': ' + rejectReason : ''}`;
      await api.post(`/admin/approvals/${orgId}/reject`, { reason: fullReason });
      setPending(p => p.filter(r => r.org.id !== orgId));
      setRejectTarget(null);
      setRejectReason('');
      setRejectReasonCode('');
      setSelected(s => { s.delete(orgId); return new Set(s); });
      load(); // refresh audit log
    } catch { setError('Failed to reject'); }
    finally { setActing(a => { const n = { ...a }; delete n[orgId]; return n; }); }
  };

  const batchApprove = async () => {
    if (selected.size === 0) return;
    setBatchLoading(true);
    try {
      await api.post('/admin/approvals/batch', { orgIds: Array.from(selected), action: 'approve' });
      setPending(p => p.filter(r => !selected.has(r.org.id)));
      setSelected(new Set());
      load();
    } catch { setError('Batch approve failed'); }
    finally { setBatchLoading(false); }
  };

  const batchReject = async () => {
    if (selected.size === 0 || !batchRejectCode) return;
    setBatchLoading(true);
    try {
      const reasonLabel = REJECTION_REASONS.find(r => r.value === batchRejectCode)?.label ?? '';
      const fullReason = batchRejectCode === 'other'
        ? batchRejectNote
        : `${reasonLabel}${batchRejectNote ? ': ' + batchRejectNote : ''}`;
      await Promise.all(
        Array.from(selected).map(orgId =>
          api.post(`/admin/approvals/${orgId}/reject`, { reason: fullReason })
        )
      );
      setPending(p => p.filter(r => !selected.has(r.org.id)));
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
            return (
              <div
                key={org.id}
                className={`bg-white rounded-xl border p-4 flex items-start gap-4 transition-colors ${selected.has(org.id) ? 'border-blue-200 bg-blue-50/30' : aging.border}`}
              >
                <input
                  type="checkbox"
                  checked={selected.has(org.id)}
                  onChange={() => toggleSelect(org.id)}
                  className="mt-1 accent-[#0F4C81]"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="font-semibold text-gray-900 truncate">{org.name}</p>
                    <span className={`px-2 py-0.5 text-xs font-medium rounded-full border ${aging.badge}`}>
                      {aging.label}
                    </span>
                  </div>
                  {admin ? (
                    <p className="text-sm text-gray-500">{admin.name} · <span className="text-gray-400">{admin.email}</span></p>
                  ) : (
                    <p className="text-sm text-gray-400 italic">No admin user found</p>
                  )}
                  <p className="text-xs text-gray-400 mt-1">Applied {timeAgo(org.createdAt)}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => approve(org.id)}
                    disabled={!!acting[org.id]}
                    className="px-3 py-1.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
                  >
                    {acting[org.id] === 'approving' ? 'Approving…' : 'Approve'}
                  </button>
                  <button
                    onClick={() => { setRejectTarget(org.id); setRejectReason(''); setRejectReasonCode(''); }}
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
            <p className="text-sm text-gray-500 mb-4">Select a reason to apply to all selected applications.</p>
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
            <button
              onClick={batchApprove}
              disabled={batchLoading}
              className="px-4 py-1.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              {batchLoading ? 'Processing…' : `Approve (${selected.size})`}
            </button>
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
