'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { Badge } from '@/components/ui/Badge';
import { DepotFilter } from '@/components/ui/DepotFilter';
import { StopDetailModal } from '@/components/StopDetailModal';
import { Plus, Search, X, RefreshCw, Download } from 'lucide-react';
import Link from 'next/link';

interface Stop {
  id: string; recipientName: string; recipientPhone: string; address: string;
  status: string; rxNumbers: string[]; packageCount: number;
  requiresRefrigeration: boolean; controlledSubstance: boolean;
  requiresSignature: boolean; requiresPhoto: boolean; codAmount?: number;
  sequenceNumber: number | null; arrivedAt?: string; completedAt?: string;
  failureReason?: string; failureNote?: string; trackingToken?: string;
  deliveryNotes?: string; createdAt: string; routeId: string;
  planDate?: string; planStatus?: string; depotId?: string; depotName?: string;
  driverId?: string; driverName?: string; planId?: string;
}

const STATUS_TABS = [
  { key: 'all', label: 'All stops' },
  { key: 'pending', label: 'Unassigned' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'completed', label: 'Completed' },
  { key: 'failed', label: 'Failed' },
];

const DATE_PRESETS = [
  { label: 'Today', days: 0 },
  { label: 'This week', days: 7 },
  { label: 'This month', days: 30 },
  { label: 'Last 3 months', days: 90 },
  { label: 'All time', days: 0, all: true },
];

export default function StopsPage() {
  const user = getUser();
  const [stops, setStops] = useState<Stop[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedStop, setSelectedStop] = useState<Stop | null>(null);
  const [statusTab, setStatusTab] = useState('all');
  const [depotId, setDepotId] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [datePreset, setDatePreset] = useState('Last 3 months');
  const [page, setPage] = useState(1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const getDateRange = () => {
    const preset = DATE_PRESETS.find(p => p.label === datePreset);
    if (!preset || preset.all) return {};
    if (preset.days === 0) {
      const today = new Date().toISOString().split('T')[0];
      return { from: today, to: today };
    }
    const from = new Date(Date.now() - preset.days * 86400000).toISOString().split('T')[0];
    return { from };
  };

  const load = useCallback(async (resetPage = false) => {
    if (!user) return;
    setLoading(true);
    const p = resetPage ? 1 : page;
    if (resetPage) setPage(1);
    try {
      const range = getDateRange();
      const params = new URLSearchParams({ page: String(p), limit: '50' });
      if (search) params.set('q', search);
      if (depotId) params.set('depotId', depotId);
      if (statusTab !== 'all') params.set('status', statusTab);
      if (range.from) params.set('from', range.from);
      const data = await api.get<{ stops: Stop[]; total: number }>(`/orgs/${user.orgId}/stops?${params}`);
      setStops(data.stops);
      setTotal(data.total);
    } catch { setStops([]); }
    finally { setLoading(false); }
  }, [user, search, depotId, statusTab, datePreset, page]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(true); }, [statusTab, depotId, datePreset, search]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearchInput = (v: string) => {
    setSearchInput(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearch(v), 400);
  };

  const exportCsv = () => {
    const headers = ['Recipient', 'Address', 'Status', 'Depot', 'Driver', 'Date', 'Rx#'];
    const rows = stops.map(s => [
      s.recipientName, s.address, s.status, s.depotName ?? '', s.driverName ?? '',
      s.planDate ?? '', (s.rxNumbers ?? []).join(';'),
    ]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `stops-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  const totalPages = Math.ceil(total / 50);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-100 bg-white shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-bold text-gray-900" style={{ fontFamily: 'var(--font-sora)' }}>Stops</h1>
          <div className="flex items-center gap-2">
            <button onClick={exportCsv} className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
              <Download size={14} /> Export
            </button>
            <Link href="/dashboard/plans/new" className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-[#0F4C81] text-white rounded-lg hover:bg-[#0a3860] transition-colors">
              <Plus size={14} /> Add or import stops
            </Link>
          </div>
        </div>

        {/* Filters row */}
        <div className="flex items-center gap-2 flex-wrap">
          <DepotFilter value={depotId} onChange={v => { setDepotId(v); }} />

          {/* Status tabs */}
          <div className="flex items-center bg-gray-100 rounded-lg p-0.5 gap-0.5">
            {STATUS_TABS.map(tab => (
              <button
                key={tab.key}
                onClick={() => setStatusTab(tab.key)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  statusTab === tab.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Date preset */}
          <select
            value={datePreset}
            onChange={e => setDatePreset(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white text-gray-700"
          >
            {DATE_PRESETS.map(p => <option key={p.label}>{p.label}</option>)}
          </select>

          {/* Search */}
          <div className="relative ml-auto">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={searchInput}
              onChange={e => handleSearchInput(e.target.value)}
              placeholder="Search name, address, phone, Rx…"
              className="pl-8 pr-8 py-1.5 text-sm border border-gray-200 rounded-lg w-64 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
            {searchInput && (
              <button onClick={() => { setSearchInput(''); setSearch(''); }} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X size={12} />
              </button>
            )}
          </div>

          <button onClick={() => load(true)} disabled={loading} className="p-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-500 disabled:opacity-40">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="space-y-px">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-14 bg-white border-b border-gray-50 animate-pulse" />
            ))}
          </div>
        ) : stops.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400">
            <Search size={32} className="mb-3 opacity-30" />
            <p className="text-sm">No stops found</p>
            {(search || depotId || statusTab !== 'all') && (
              <button onClick={() => { setSearch(''); setSearchInput(''); setDepotId(''); setStatusTab('all'); }} className="text-xs text-[#0F4C81] mt-2 hover:underline">
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100 sticky top-0">
                <tr>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Address</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden md:table-cell">Recipient</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden lg:table-cell">Depot</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden lg:table-cell">Driver</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden md:table-cell">Date</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden sm:table-cell">Rx</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 bg-white">
                {stops.map(stop => (
                  <tr
                    key={stop.id}
                    onClick={() => setSelectedStop(stop)}
                    className="hover:bg-blue-50/30 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {stop.requiresRefrigeration && <span className="text-xs bg-blue-50 text-blue-600 px-1.5 rounded shrink-0">❄</span>}
                        {stop.controlledSubstance && <span className="text-xs bg-orange-50 text-orange-600 px-1.5 rounded shrink-0">⚠</span>}
                        <span className="font-medium text-gray-900 truncate max-w-[200px]">{stop.address}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className="text-gray-700 truncate block max-w-[140px]">{stop.recipientName}</span>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-gray-500 truncate max-w-[160px]">{stop.depotName ?? '—'}</td>
                    <td className="px-4 py-3 hidden lg:table-cell text-gray-500">{stop.driverName ?? '—'}</td>
                    <td className="px-4 py-3 hidden md:table-cell text-gray-400 text-xs">{stop.planDate ?? '—'}</td>
                    <td className="px-4 py-3"><Badge status={stop.status} /></td>
                    <td className="px-4 py-3 hidden sm:table-cell text-gray-400 text-xs">
                      {stop.rxNumbers?.length > 0 ? `×${stop.rxNumbers.length}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-white">
                <span className="text-xs text-gray-500">{total} stops total</span>
                <div className="flex items-center gap-1">
                  <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="px-2 py-1 text-xs border border-gray-200 rounded disabled:opacity-40 hover:bg-gray-50">←</button>
                  <span className="px-3 py-1 text-xs text-gray-600">{page} / {totalPages}</span>
                  <button disabled={page === totalPages} onClick={() => setPage(p => p + 1)} className="px-2 py-1 text-xs border border-gray-200 rounded disabled:opacity-40 hover:bg-gray-50">→</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {selectedStop && (
        <StopDetailModal
          stop={selectedStop}
          onClose={() => setSelectedStop(null)}
          onUpdated={() => { setSelectedStop(null); load(); }}
        />
      )}
    </div>
  );
}
