'use client';
import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { Download, Search, ChevronLeft, ChevronRight as ChevRight } from 'lucide-react';
import Link from 'next/link';

interface AuditLog {
  id: string;
  userId: string | null;
  userEmail: string | null;
  action: string;
  resource: string;
  resourceId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

interface AuditResponse {
  rows: AuditLog[];
  total: number;
  page: number;
  pageSize: number;
}

const defaultFrom = () => new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
const defaultTo = () => new Date().toISOString().split('T')[0];

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export default function AuditPage() {
  const [user] = useState(getUser);
  const [data, setData] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [userFilter, setUserFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [resourceFilter, setResourceFilter] = useState('');
  const [page, setPage] = useState(1);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (userFilter) params.set('user', userFilter);
      if (actionFilter) params.set('action', actionFilter);
      if (resourceFilter) params.set('resource', resourceFilter);
      const result = await api.get<AuditResponse>(`/orgs/${user.orgId}/compliance/audit-logs?${params}`);
      setData(result);
    } catch { setData(null); }
    finally { setLoading(false); }
  }, [user, page, from, to, userFilter, actionFilter, resourceFilter]);

  useEffect(() => { load(); }, [load]);

  const exportCsv = async () => {
    if (!user || exporting) return;
    setExporting(true);
    setExportError(null);
    const params = new URLSearchParams({ export: 'csv' });
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (userFilter) params.set('user', userFilter);
    if (actionFilter) params.set('action', actionFilter);
    if (resourceFilter) params.set('resource', resourceFilter);
    const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
    const url = `${BASE}/api/v1/orgs/${user.orgId}/compliance/audit-logs?${params}`;
    try {
      const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `audit-log-${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  const applyFilters = () => { setPage(1); load(); };

  const totalPages = data ? Math.ceil(data.total / data.pageSize) : 0;

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/compliance" className="text-gray-400 hover:text-gray-600">
            <ChevronLeft size={18} />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-gray-900" style={{ fontFamily: 'var(--font-sora)' }}>
              Audit Log Viewer
            </h1>
            <p className="text-xs text-gray-500">System access and change events</p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button
            onClick={exportCsv}
            disabled={exporting}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600 transition-colors disabled:opacity-50"
          >
            <Download size={14} /> {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
          {exportError && <p className="text-xs text-red-500">{exportError}</p>}
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-100 p-4">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">From</label>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">To</label>
            <input type="date" value={to} onChange={e => setTo(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">User</label>
            <input value={userFilter} onChange={e => setUserFilter(e.target.value)}
              placeholder="user@email.com"
              className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Action</label>
            <input value={actionFilter} onChange={e => setActionFilter(e.target.value)}
              placeholder="e.g. view_stop"
              className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Resource</label>
            <input value={resourceFilter} onChange={e => setResourceFilter(e.target.value)}
              placeholder="e.g. stop"
              className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
          </div>
          <div className="flex items-end">
            <button
              onClick={applyFilters}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 bg-[#0F4C81] text-white text-sm font-medium rounded-lg hover:bg-blue-900 transition-colors"
            >
              <Search size={13} /> Search
            </button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm animate-pulse">Loading…</div>
        ) : !data || data.rows.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-gray-400 text-sm mb-2">No audit events found</p>
            <p className="text-gray-400 text-xs">Events are recorded automatically as users interact with the system.</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    {['Timestamp', 'User', 'Action', 'Resource', 'Resource ID', 'IP Address'].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {data.rows.map(row => (
                    <tr key={row.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5 text-gray-500 text-xs whitespace-nowrap">
                        {new Date(row.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5 text-gray-700 text-xs">
                        {row.userEmail ?? <span className="text-gray-400">system</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="text-xs font-mono bg-gray-100 text-gray-700 px-2 py-0.5 rounded">
                          {row.action}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-gray-600 text-xs capitalize">{row.resource}</td>
                      <td className="px-4 py-2.5 text-gray-400 text-xs font-mono">
                        {row.resourceId ? row.resourceId.slice(0, 8) + '…' : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-gray-400 text-xs">{row.ipAddress ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
                <span className="text-xs text-gray-500">
                  {data.total.toLocaleString()} total events · page {data.page} of {totalPages}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    disabled={page === 1}
                    onClick={() => setPage(p => p - 1)}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30 transition-colors"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <button
                    disabled={page >= totalPages}
                    onClick={() => setPage(p => p + 1)}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30 transition-colors"
                  >
                    <ChevRight size={14} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
