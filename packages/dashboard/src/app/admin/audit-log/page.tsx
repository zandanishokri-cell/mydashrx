'use client';
import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { getAccessToken } from '@/lib/auth';

const EVENT_TABS = [
  { label: 'All', value: '' },
  { label: 'Auth Events', value: 'login_success,login_failed,logout,password_changed,magic_link_requested,magic_link_used' },
  { label: 'Admin Actions', value: 'approve_org,reject_org,role_change,depot_assign,audit_log_exported' },
];

function timeAgo(d: string) {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return new Date(d).toLocaleDateString();
}

function actionColor(action: string) {
  if (action.startsWith('login_fail') || action.startsWith('reject')) return 'text-red-600 bg-red-50';
  if (action.startsWith('login_success') || action.startsWith('approve')) return 'text-green-700 bg-green-50';
  if (action === 'logout') return 'text-gray-600 bg-gray-100';
  if (action.startsWith('password') || action.startsWith('magic')) return 'text-blue-700 bg-blue-50';
  if (action === 'audit_log_exported') return 'text-purple-700 bg-purple-50';
  return 'text-gray-700 bg-gray-100';
}

export default function AuditLogPage() {
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('');
  const [actorEmail, setActorEmail] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (tab) params.set('eventTypes', tab);
      if (actorEmail.trim()) params.set('actorEmail', actorEmail.trim());
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      params.set('limit', '200');
      const data = await api.get<any[]>(`/admin/audit-log?${params.toString()}`);
      setEntries(data);
    } finally {
      setLoading(false);
    }
  }, [tab, actorEmail, from, to]);

  useEffect(() => { load(); }, [load]);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams({ format: 'csv' });
      if (tab) params.set('eventTypes', tab);
      if (actorEmail.trim()) params.set('actorEmail', actorEmail.trim());
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? 'https://mydashrx-backend.onrender.com/api/v1';
      const token = getAccessToken();
      const res = await fetch(`${baseUrl}/admin/audit-log?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `audit-log-${new Date().toISOString().slice(0,10)}.csv`;
      a.click(); URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Audit Log</h1>
          <p className="text-sm text-gray-500 mt-0.5">HIPAA §164.312(b) — All auth and admin actions</p>
        </div>
        <button
          onClick={exportCsv}
          disabled={exporting}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-700 disabled:opacity-50"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          {exporting ? 'Exporting…' : 'Export CSV'}
        </button>
      </div>

      {/* Tab strip */}
      <div className="flex gap-1 mb-4 border-b border-gray-100">
        {EVENT_TABS.map(t => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`px-3 py-2 text-sm font-medium rounded-t-lg transition-colors ${
              tab === t.value ? 'text-[#0F4C81] border-b-2 border-[#0F4C81] -mb-px' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-5 flex-wrap">
        <input
          type="text"
          placeholder="Filter by actor email…"
          value={actorEmail}
          onChange={e => setActorEmail(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && load()}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 w-60"
        />
        <input type="date" value={from} onChange={e => setFrom(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
        <input type="date" value={to} onChange={e => setTo(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
        <button onClick={load} className="px-3 py-1.5 bg-[#0F4C81] text-white text-sm rounded-lg hover:bg-[#0a3d6b]">
          Apply
        </button>
      </div>

      {/* Results */}
      {loading ? (
        <div className="text-center text-gray-400 py-12 text-sm">Loading…</div>
      ) : entries.length === 0 ? (
        <div className="text-center text-gray-400 py-12 text-sm">No entries match the current filters.</div>
      ) : (
        <div className="space-y-1">
          <p className="text-xs text-gray-400 mb-2">{entries.length} entries</p>
          {entries.map(e => (
            <div key={e.id} className="flex items-start gap-3 py-2.5 border-b border-gray-50 last:border-0">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 mt-0.5 ${actionColor(e.action)}`}>
                {e.action.replace(/_/g, ' ')}
              </span>
              <div className="flex-1 min-w-0">
                <span className="text-sm text-gray-700">{e.actorEmail}</span>
                {e.targetName && e.targetName !== e.actorEmail && (
                  <span className="text-sm text-gray-400"> → {e.targetName}</span>
                )}
                {e.metadata && Object.keys(e.metadata).length > 0 && (
                  <p className="text-xs text-gray-400 mt-0.5 truncate">
                    {JSON.stringify(e.metadata).slice(0, 120)}
                  </p>
                )}
              </div>
              <span className="text-xs text-gray-400 shrink-0">{timeAgo(e.createdAt)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
