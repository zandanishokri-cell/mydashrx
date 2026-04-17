'use client';
import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

type PendingOrg = {
  org: { id: string; name: string; createdAt: string };
  admin: { id: string; name: string; email: string; createdAt: string } | null;
};

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const hrs = Math.floor(diff / 3600000);
  if (hrs < 1) return 'just now';
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function ApprovalsPage() {
  const [pending, setPending] = useState<PendingOrg[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [acting, setActing] = useState<Record<string, 'approving' | 'rejecting'>>({});
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchLoading, setBatchLoading] = useState(false);

  const load = () => {
    setLoading(true);
    api.get<PendingOrg[]>('/admin/approvals')
      .then(setPending)
      .catch(() => setError('Failed to load pending approvals'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const approve = async (orgId: string) => {
    setActing(a => ({ ...a, [orgId]: 'approving' }));
    try {
      await api.post(`/admin/approvals/${orgId}/approve`, {});
      setPending(p => p.filter(r => r.org.id !== orgId));
      setSelected(s => { s.delete(orgId); return new Set(s); });
    } catch { setError('Failed to approve'); }
    finally { setActing(a => { const n = { ...a }; delete n[orgId]; return n; }); }
  };

  const reject = async (orgId: string) => {
    setActing(a => ({ ...a, [orgId]: 'rejecting' }));
    try {
      await api.post(`/admin/approvals/${orgId}/reject`, { reason: rejectReason });
      setPending(p => p.filter(r => r.org.id !== orgId));
      setRejectTarget(null);
      setRejectReason('');
      setSelected(s => { s.delete(orgId); return new Set(s); });
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
    } catch { setError('Batch approve failed'); }
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
        {selected.size > 0 && (
          <button
            onClick={batchApprove}
            disabled={batchLoading}
            className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
          >
            {batchLoading ? 'Approving…' : `Approve selected (${selected.size})`}
          </button>
        )}
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
          {pending.map(({ org, admin }) => (
            <div
              key={org.id}
              className={`bg-white rounded-xl border p-4 flex items-start gap-4 transition-colors ${selected.has(org.id) ? 'border-blue-200 bg-blue-50/30' : 'border-gray-100'}`}
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
                  <span className="px-2 py-0.5 bg-amber-50 text-amber-700 text-xs font-medium rounded-full border border-amber-100">Pending</span>
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
                  onClick={() => { setRejectTarget(org.id); setRejectReason(''); }}
                  disabled={!!acting[org.id]}
                  className="px-3 py-1.5 border border-gray-200 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Reject modal */}
      {rejectTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
            <h3 className="font-semibold text-gray-900 mb-1">Reject application</h3>
            <p className="text-sm text-gray-500 mb-4">Optionally provide a reason. This will be included in the notification email.</p>
            <textarea
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              placeholder="Reason for rejection (optional)"
              rows={3}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-200 mb-4 resize-none"
            />
            <div className="flex gap-3">
              <button
                onClick={() => setRejectTarget(null)}
                className="flex-1 border border-gray-200 text-gray-600 rounded-lg py-2 text-sm font-medium hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => reject(rejectTarget)}
                disabled={!!acting[rejectTarget]}
                className="flex-1 bg-red-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-red-700 disabled:opacity-50"
              >
                {acting[rejectTarget] === 'rejecting' ? 'Rejecting…' : 'Confirm rejection'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
