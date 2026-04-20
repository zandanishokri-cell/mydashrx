'use client';
import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { getUser, getAccessToken } from '@/lib/auth';
import { Download, Search, ChevronLeft, ChevronRight as ChevRight, AlertCircle, FileDown, Phone } from 'lucide-react';
import Link from 'next/link';
import { localDateStr } from '@/lib/dateUtils';

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

// P-PERF11: keyset cursor pagination — no page numbers, no OFFSET
interface AuditResponse {
  events: AuditLog[];
  nextCursor: string | null;
  hasMore: boolean;
}

const defaultFrom = () => localDateStr(new Date(Date.now() - 7 * 86400000));
const defaultTo = () => localDateStr();

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
  // Applied filters — only committed on Search click (prevents API storm on keystroke)
  const [applied, setApplied] = useState({ user: '', action: '', resource: '' });
  // P-PERF11: cursor stack — push on Next, pop on Back
  const [cursors, setCursors] = useState<string[]>([]);
  const currentCursor = cursors[cursors.length - 1] ?? null;
  const pageNum = cursors.length + 1; // display only
  const [loadError, setLoadError] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // P-COMP14: compliance delivery export
  const [compFrom, setCompFrom] = useState(defaultFrom);
  const [compTo, setCompTo] = useState(defaultTo);
  const [compPhone, setCompPhone] = useState('');
  const [compFormat, setCompFormat] = useState<'csv' | 'json'>('csv');
  const [compExporting, setCompExporting] = useState(false);
  const [compExportError, setCompExportError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setLoadError(false);
    try {
      const params = new URLSearchParams();
      if (currentCursor) params.set('cursor', currentCursor);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (applied.user) params.set('user', applied.user);
      if (applied.action) params.set('action', applied.action);
      if (applied.resource) params.set('resource', applied.resource);
      const result = await api.get<AuditResponse>(`/orgs/${user.orgId}/compliance/audit-logs?${params}`);
      setData(result);
    } catch { setLoadError(true); }
    finally { setLoading(false); }
  }, [user, currentCursor, from, to, applied]);

  useEffect(() => { load(); }, [load]);

  const exportCsv = async () => {
    if (!user || exporting) return;
    setExporting(true);
    setExportError(null);
    const params = new URLSearchParams({ export: 'csv' });
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (applied.user) params.set('user', applied.user);
    if (applied.action) params.set('action', applied.action);
    if (applied.resource) params.set('resource', applied.resource);
    const token = getAccessToken();
    const url = `${BASE}/api/v1/orgs/${user.orgId}/compliance/audit-logs?${params}`;
    try {
      const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `audit-log-${localDateStr()}.csv`;
      a.click();
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  const applyFilters = () => {
    setApplied({ user: userFilter, action: actionFilter, resource: resourceFilter });
    setCursors([]); // reset to first page
  };

  const goNext = () => {
    if (data?.nextCursor) setCursors(prev => [...prev, data.nextCursor!]);
  };

  const goBack = () => {
    setCursors(prev => prev.slice(0, -1));
  };

  // P-COMP14: download compliance delivery export
  const exportCompliance = async () => {
    if (!user || compExporting) return;
    setCompExporting(true);
    setCompExportError(null);
    const params = new URLSearchParams({ startDate: compFrom, endDate: compTo, format: compFormat });
    if (compPhone.trim()) params.set('patientPhone', compPhone.trim());
    const token = getAccessToken();
    const url = `${BASE}/api/v1/orgs/${user.orgId}/compliance/export?${params}`;
    try {
      const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `compliance-export-${compFrom}-to-${compTo}.${compFormat}`;
      a.click();
    } catch (err) {
      setCompExportError(err instanceof Error ? err.message : 'Export failed. Please try again.');
    } finally {
      setCompExporting(false);
    }
  };

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

      {/* P-COMP14: Compliance Delivery Export Card */}
      <div className="bg-white rounded-xl border border-blue-100 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <FileDown size={18} className="text-[#0F4C81]" />
          <div>
            <h2 className="font-semibold text-gray-900 text-sm">Compliance Delivery Export</h2>
            <p className="text-xs text-gray-400">Full delivery records with signature, consent, and HIPAA ack data — for DEA/state board audits.</p>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label htmlFor="comp-export-from" className="block text-xs font-medium text-gray-500 mb-1">From</label>
            <input id="comp-export-from" type="date" value={compFrom} onChange={e => setCompFrom(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
          </div>
          <div>
            <label htmlFor="comp-export-to" className="block text-xs font-medium text-gray-500 mb-1">To</label>
            <input id="comp-export-to" type="date" value={compTo} onChange={e => setCompTo(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
          </div>
          <div>
            <label htmlFor="comp-export-phone" className="block text-xs font-medium text-gray-500 mb-1 flex items-center gap-1">
              <Phone size={11} /> Patient Phone (optional)
            </label>
            <input id="comp-export-phone" value={compPhone} onChange={e => setCompPhone(e.target.value)}
              placeholder="+15551234567"
              className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
          </div>
          <div>
            <label htmlFor="comp-export-format" className="block text-xs font-medium text-gray-500 mb-1">Format</label>
            <select id="comp-export-format" value={compFormat} onChange={e => setCompFormat(e.target.value as 'csv' | 'json')}
              aria-label="Export format"
              className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200">
              <option value="csv">CSV</option>
              <option value="json">JSON</option>
            </select>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={exportCompliance}
            disabled={compExporting}
            className="flex items-center gap-1.5 px-4 py-2 bg-[#0F4C81] text-white text-sm font-medium rounded-lg hover:bg-blue-900 disabled:opacity-50 transition-colors"
          >
            <Download size={14} /> {compExporting ? 'Exporting…' : 'Download Compliance Export'}
          </button>
          {compExportError && <p className="text-xs text-red-500">{compExportError}</p>}
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-100 p-4">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <div>
            <label htmlFor="audit-from" className="block text-xs font-medium text-gray-500 mb-1">From</label>
            <input id="audit-from" type="date" value={from} onChange={e => setFrom(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
          </div>
          <div>
            <label htmlFor="audit-to" className="block text-xs font-medium text-gray-500 mb-1">To</label>
            <input id="audit-to" type="date" value={to} onChange={e => setTo(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
          </div>
          <div>
            <label htmlFor="audit-user" className="block text-xs font-medium text-gray-500 mb-1">User</label>
            <input id="audit-user" value={userFilter} onChange={e => setUserFilter(e.target.value)}
              placeholder="user@email.com"
              className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
          </div>
          <div>
            <label htmlFor="audit-action" className="block text-xs font-medium text-gray-500 mb-1">Action</label>
            <input id="audit-action" value={actionFilter} onChange={e => setActionFilter(e.target.value)}
              placeholder="e.g. view_stop"
              className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
          </div>
          <div>
            <label htmlFor="audit-resource" className="block text-xs font-medium text-gray-500 mb-1">Resource</label>
            <input id="audit-resource" value={resourceFilter} onChange={e => setResourceFilter(e.target.value)}
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
        ) : loadError ? (
          <div className="p-12 text-center">
            <AlertCircle size={32} className="text-red-400 mx-auto mb-3" />
            <p className="text-gray-700 font-semibold text-sm mb-1">Failed to load audit logs</p>
            <p className="text-gray-400 text-sm mb-4">Check your connection and try again.</p>
            <button onClick={load} className="text-sm bg-[#0F4C81] text-white px-4 py-2 rounded-lg hover:bg-blue-900">Retry</button>
          </div>
        ) : !data || data.events.length === 0 ? (
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
                  {data.events.map(row => (
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

            {/* P-PERF11: cursor-based pagination — push/pop cursor stack for Back */}
            {(cursors.length > 0 || data.hasMore) && (
              <nav aria-label="Audit log pagination" className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
                <span className="text-xs text-gray-500" aria-hidden="true">
                  Page {pageNum}{data.hasMore ? '+' : ''}
                </span>
                <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
                  {`Page ${pageNum}`}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    disabled={cursors.length === 0}
                    onClick={goBack}
                    aria-label="Previous page"
                    className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30 transition-colors"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <button
                    disabled={!data.hasMore}
                    onClick={goNext}
                    aria-label="Next page"
                    className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30 transition-colors"
                  >
                    <ChevRight size={14} />
                  </button>
                </div>
              </nav>
            )}
          </>
        )}
      </div>
    </div>
  );
}
