'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { Badge } from '@/components/ui/Badge';
import { DepotFilter } from '@/components/ui/DepotFilter';
import { DateRangePicker, type DateRange } from '@/components/ui/DateRangePicker';
import { CsvImportModal } from '@/components/CsvImportModal';
import { NewStopModal } from '@/components/NewStopModal';
import { Plus, Search, X, RefreshCw, Download, Upload, ChevronUp, ChevronDown, ChevronsUpDown, Filter, ArrowRightLeft, Truck, AlertCircle } from 'lucide-react';
import Link from 'next/link';

interface RouteOption {
  id: string;
  status: string;
  planDate: string | null;
  driverName: string | null;
  depotName: string | null;
  stopCount: number;
}

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
  windowStart?: string; windowEnd?: string;
}

type Urgency = 'overdue' | 'due-soon' | 'normal';
function getUrgency(stop: Stop): Urgency {
  if (stop.status === 'completed' || stop.status === 'failed') return 'normal';
  if (!stop.windowEnd) return 'normal';
  const end = new Date(stop.windowEnd).getTime();
  const now = Date.now();
  if (end < now) return 'overdue';
  if (end - now < 60 * 60 * 1000) return 'due-soon';
  return 'normal';
}
const URGENCY_ROW: Record<Urgency, string> = {
  overdue: 'bg-red-50/60 hover:bg-red-100/40',
  'due-soon': 'bg-amber-50/60 hover:bg-amber-100/40',
  normal: 'hover:bg-blue-50/30',
};
const URGENCY_BADGE: Record<Urgency, string | null> = {
  overdue: 'text-red-600 bg-red-100 border-red-200',
  'due-soon': 'text-amber-700 bg-amber-50 border-amber-200',
  normal: null,
};

const STATUS_TABS = [
  { key: 'all', label: 'All stops' },
  { key: 'pending', label: 'Unassigned' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'completed', label: 'Completed' },
  { key: 'failed', label: 'Failed' },
  { key: 'rescheduled', label: 'Rescheduled' },
];

// Date range presets
const TODAY_RANGE = (): DateRange => {
  const t = new Date().toISOString().split('T')[0];
  return { from: t, to: t };
};

const defaultRange = (): DateRange => {
  const to = new Date().toISOString().split('T')[0];
  const from = new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0];
  return { from, to };
};

export default function StopsPage() {
  const router = useRouter();
  const [user] = useState(getUser);
  const [stops, setStops] = useState<Stop[]>([]);
  const [todayOnly, setTodayOnly] = useState(true);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusTab, setStatusTab] = useState('all');
  const [depotId, setDepotId] = useState('');
  const [depotName, setDepotName] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [dateRange, setDateRange] = useState<DateRange>(() => TODAY_RANGE());
  const [page, setPage] = useState(1);
  const [importOpen, setImportOpen] = useState(false);
  const [newStopOpen, setNewStopOpen] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [sortKey, setSortKey] = useState<'urgency' | 'status' | 'date' | 'driver' | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkError, setBulkError] = useState('');
  const [reassignOpen, setReassignOpen] = useState(false);
  const [routeOptions, setRouteOptions] = useState<RouteOption[]>([]);
  const [routesLoading, setRoutesLoading] = useState(false);
  const [selectedRouteId, setSelectedRouteId] = useState('');
  const [reassignLoading, setReassignLoading] = useState(false);
  const [reassignError, setReassignError] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSort = (key: typeof sortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  const URGENCY_ORDER: Record<string, number> = { overdue: 0, 'due-soon': 1, normal: 2 };
  const STATUS_ORDER: Record<string, number> = { pending: 0, en_route: 1, arrived: 2, completed: 3, failed: 4 };

  const sortedStops = sortKey ? [...stops].sort((a, b) => {
    let cmp = 0;
    if (sortKey === 'urgency') cmp = (URGENCY_ORDER[getUrgency(a)] ?? 99) - (URGENCY_ORDER[getUrgency(b)] ?? 99);
    else if (sortKey === 'status') cmp = (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99);
    else if (sortKey === 'date') cmp = (a.planDate ?? '').localeCompare(b.planDate ?? '');
    else if (sortKey === 'driver') cmp = (a.driverName ?? '').localeCompare(b.driverName ?? '');
    return sortDir === 'asc' ? cmp : -cmp;
  }) : stops;

  const load = useCallback(async (resetPage = false) => {
    if (!user) return;
    setLoading(true);
    const p = resetPage ? 1 : page;
    if (resetPage) setPage(1);
    try {
      const params = new URLSearchParams({ page: String(p), limit: '50' });
      if (search) params.set('q', search);
      if (depotId) params.set('depotId', depotId);
      if (statusTab !== 'all') params.set('status', statusTab);
      if (dateRange.from) params.set('from', dateRange.from);
      if (dateRange.to) params.set('to', dateRange.to);
      const data = await api.get<{ stops: Stop[]; total: number }>(`/orgs/${user.orgId}/stops?${params}`);
      setStops(data.stops);
      setTotal(data.total);
      setLoadError(false);
    } catch { setStops([]); setLoadError(true); }
    finally { setLoading(false); }
  }, [user, search, depotId, statusTab, dateRange, page]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(true); }, [statusTab, depotId, dateRange, search]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearchInput = (v: string) => {
    setSearchInput(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearch(v), 400);
  };

  const exportCsv = async () => {
    if (!user || exporting) return;
    setExporting(true); setExportError('');
    try {
      const params = new URLSearchParams({ page: '1', limit: '10000' });
      if (search) params.set('q', search);
      if (depotId) params.set('depotId', depotId);
      if (statusTab !== 'all') params.set('status', statusTab);
      if (dateRange.from) params.set('from', dateRange.from);
      if (dateRange.to) params.set('to', dateRange.to);
      const data = await api.get<{ stops: Stop[] }>(`/orgs/${user.orgId}/stops?${params}`);
      const allStops = data.stops ?? [];
      const headers = ['Recipient', 'Phone', 'Address', 'Status', 'Depot', 'Driver', 'Date', 'Window Start', 'Window End', 'Rx#', 'Controlled', 'Refrigeration', 'Completed At'];
      const rows = allStops.map(s => [
        s.recipientName, s.recipientPhone ?? '', s.address, s.status,
        s.depotName ?? '', s.driverName ?? '', s.planDate ?? '',
        s.windowStart ? new Date(s.windowStart).toLocaleString() : '',
        s.windowEnd ? new Date(s.windowEnd).toLocaleString() : '',
        (s.rxNumbers ?? []).join(';'),
        s.controlledSubstance ? 'Yes' : 'No',
        s.requiresRefrigeration ? 'Yes' : 'No',
        s.completedAt ? new Date(s.completedAt).toLocaleString() : '',
      ]);
      const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      a.download = `stops-${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
    } catch (err: any) { setExportError(err?.message ?? 'Export failed. Please try again.'); }
    finally { setExporting(false); }
  };

  const bulkAction = async (action: 'complete' | 'failed') => {
    if (!user || bulkLoading || selectedIds.size === 0) return;
    setBulkLoading(true);
    setBulkError('');
    try {
      const res = await api.post<{ updated: number; skipped: number }>(
        `/orgs/${user.orgId}/stops/bulk-action`,
        { stopIds: [...selectedIds], action },
      );
      setSelectedIds(new Set());
      await load(true);
      if (res.skipped > 0) setBulkError(`${res.updated} updated, ${res.skipped} skipped (already terminal)`);
    } catch {
      setBulkError('Bulk action failed');
    } finally {
      setBulkLoading(false);
    }
  };

  const openReassignModal = async () => {
    if (!user) return;
    setReassignOpen(true);
    setRoutesLoading(true);
    setSelectedRouteId('');
    setRouteOptions([]);
    setReassignError('');
    try {
      const res = await api.get<{ routes: RouteOption[] }>(`/orgs/${user.orgId}/routes`);
      setRouteOptions(res.routes);
    } catch {
      setReassignError('Failed to load routes');
    } finally {
      setRoutesLoading(false);
    }
  };

  const bulkReassign = async () => {
    if (!user || !selectedRouteId || reassignLoading || selectedIds.size === 0) return;
    setReassignLoading(true);
    setReassignError('');
    try {
      const res = await api.post<{ updated: number; skipped: number }>(
        `/orgs/${user.orgId}/stops/bulk-reassign`,
        { stopIds: [...selectedIds], targetRouteId: selectedRouteId },
      );
      setSelectedIds(new Set());
      setReassignOpen(false);
      await load(true);
      if (res.skipped > 0) setBulkError(`${res.updated} reassigned, ${res.skipped} skipped (terminal)`);
    } catch {
      setReassignError('Reassign failed — please try again');
    } finally {
      setReassignLoading(false);
    }
  };

  const allSelected = sortedStops.length > 0 && sortedStops.every(s => selectedIds.has(s.id));
  const someSelected = sortedStops.some(s => selectedIds.has(s.id));

  const toggleAll = (checked: boolean) => {
    const next = new Set(selectedIds);
    sortedStops.forEach(s => checked ? next.add(s.id) : next.delete(s.id));
    setSelectedIds(next);
  };

  const toggleOne = (id: string, checked: boolean) => {
    const next = new Set(selectedIds);
    checked ? next.add(id) : next.delete(id);
    setSelectedIds(next);
  };

  const totalPages = Math.ceil(total / 50);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-100 bg-white shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-bold text-gray-900" style={{ fontFamily: 'var(--font-sora)' }}>Stops</h1>
          <div className="flex items-center gap-2">
            <button onClick={exportCsv} disabled={exporting} className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors">
              <Download size={14} className={exporting ? 'animate-pulse' : ''} />
              {exporting ? 'Exporting…' : 'Export CSV'}
            </button>
            {exportError && (
              <span className="flex items-center gap-1 text-xs text-red-500"><AlertCircle size={12} />{exportError}</span>
            )}
            <button onClick={() => setImportOpen(true)} className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
              <Upload size={14} /> Import CSV
            </button>
            <button onClick={() => setNewStopOpen(true)} className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-[#0F4C81] text-white rounded-lg hover:bg-[#0a3860] transition-colors">
              <Plus size={14} /> New Stop
            </button>
          </div>
        </div>

        {/* Filters row */}
        <div className="flex items-center gap-2 flex-wrap">
          <DepotFilter value={depotId} onChange={(id, name) => { setDepotId(id); setDepotName(name ?? ''); }} />

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

          {/* Today / All time toggle */}
          <div className="flex items-center bg-gray-100 rounded-lg p-0.5 gap-0.5">
            {[{ label: 'Today', val: true }, { label: 'All time', val: false }].map(({ label, val }) => (
              <button
                key={label}
                onClick={() => {
                  setTodayOnly(val);
                  setDateRange(val ? TODAY_RANGE() : defaultRange());
                }}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  todayOnly === val ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <DateRangePicker
            value={dateRange}
            onChange={r => { setDateRange(r); setTodayOnly(false); }}
            presets={['today', 'week', 'month', '30d', '90d', 'custom']}
          />

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

        {/* Active filter chips */}
        {(depotId || statusTab !== 'all' || search || !todayOnly) && (
          <div className="flex items-center gap-1.5 flex-wrap pt-2">
            <span className="text-xs text-gray-400 flex items-center gap-1"><Filter size={11} /> Filters:</span>
            {depotId && (
              <span className="flex items-center gap-1 text-xs bg-blue-50 text-blue-700 border border-blue-100 px-2 py-0.5 rounded-full">
                {depotName || 'Depot'}
                <button onClick={() => { setDepotId(''); setDepotName(''); }} className="hover:text-blue-900"><X size={10} /></button>
              </span>
            )}
            {statusTab !== 'all' && (
              <span className="flex items-center gap-1 text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded-full">
                {STATUS_TABS.find(t => t.key === statusTab)?.label ?? statusTab}
                <button onClick={() => setStatusTab('all')} className="hover:text-gray-900"><X size={10} /></button>
              </span>
            )}
            {!todayOnly && (
              <span className="flex items-center gap-1 text-xs bg-indigo-50 text-indigo-700 border border-indigo-100 px-2 py-0.5 rounded-full">
                {dateRange.from === dateRange.to ? dateRange.from : `${dateRange.from} – ${dateRange.to}`}
                <button onClick={() => { setTodayOnly(true); setDateRange(TODAY_RANGE()); }} className="hover:text-indigo-900"><X size={10} /></button>
              </span>
            )}
            {search && (
              <span className="flex items-center gap-1 text-xs bg-amber-50 text-amber-700 border border-amber-100 px-2 py-0.5 rounded-full">
                &ldquo;{search}&rdquo;
                <button onClick={() => { setSearch(''); setSearchInput(''); }} className="hover:text-amber-900"><X size={10} /></button>
              </span>
            )}
            <button
              onClick={() => { setDepotId(''); setDepotName(''); setStatusTab('all'); setTodayOnly(true); setDateRange(TODAY_RANGE()); setSearch(''); setSearchInput(''); }}
              className="text-xs text-gray-400 hover:text-gray-600 ml-1"
            >
              Clear all
            </button>
            {!loading && <span className="text-xs text-gray-400 ml-auto">{total} stop{total !== 1 ? 's' : ''}</span>}
          </div>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="space-y-px">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-14 bg-white border-b border-gray-50 animate-pulse" />
            ))}
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-center justify-center h-64 text-red-400">
            <p className="text-sm">Failed to load stops</p>
            <button onClick={() => load(true)} className="text-xs text-[#0F4C81] mt-2 hover:underline">Retry</button>
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
                  <th className="pl-4 pr-2 py-2.5">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={el => { if (el) el.indeterminate = someSelected && !allSelected; }}
                      onChange={e => toggleAll(e.target.checked)}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                    />
                  </th>
                  {/* Address / Urgency sort */}
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    <button onClick={() => handleSort('urgency')} className="flex items-center gap-1 hover:text-gray-700">
                      Address
                      {sortKey === 'urgency' ? (sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />) : <ChevronsUpDown size={11} className="opacity-40" />}
                    </button>
                  </th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden md:table-cell">Recipient</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden lg:table-cell">Depot</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden lg:table-cell">
                    <button onClick={() => handleSort('driver')} className="flex items-center gap-1 hover:text-gray-700">
                      Driver
                      {sortKey === 'driver' ? (sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />) : <ChevronsUpDown size={11} className="opacity-40" />}
                    </button>
                  </th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden md:table-cell">
                    <button onClick={() => handleSort('date')} className="flex items-center gap-1 hover:text-gray-700">
                      Date
                      {sortKey === 'date' ? (sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />) : <ChevronsUpDown size={11} className="opacity-40" />}
                    </button>
                  </th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    <button onClick={() => handleSort('status')} className="flex items-center gap-1 hover:text-gray-700">
                      Status
                      {sortKey === 'status' ? (sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />) : <ChevronsUpDown size={11} className="opacity-40" />}
                    </button>
                  </th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden sm:table-cell">Rx</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 bg-white">
                {sortedStops.map(stop => {
                  const urgency = getUrgency(stop);
                  const badgeCls = URGENCY_BADGE[urgency];
                  return (
                  <tr
                    key={stop.id}
                    onClick={() => router.push(`/dashboard/stops/${stop.id}`)}
                    className={`cursor-pointer transition-colors ${URGENCY_ROW[urgency]} ${selectedIds.has(stop.id) ? 'bg-blue-50/70' : ''}`}
                  >
                    <td className="pl-4 pr-2 py-3" onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(stop.id)}
                        onChange={e => toggleOne(stop.id, e.target.checked)}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {/* Route assignment dot */}
                        <span
                          title={stop.routeId ? 'Assigned to route' : 'Unassigned'}
                          className={`w-2 h-2 rounded-full shrink-0 ${stop.routeId ? 'bg-blue-400' : 'bg-gray-300'}`}
                        />
                        {stop.requiresRefrigeration && <span className="text-xs bg-blue-50 text-blue-600 px-1.5 rounded shrink-0">❄</span>}
                        {stop.controlledSubstance && <span className="text-xs bg-orange-50 text-orange-600 px-1.5 rounded shrink-0">⚠</span>}
                        <span className="font-medium text-gray-900 truncate max-w-[160px]">{stop.address}</span>
                        {badgeCls && stop.windowEnd && (
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border shrink-0 ${badgeCls}`}>
                            {urgency === 'overdue' ? 'OVERDUE' : `Due ${new Date(stop.windowEnd).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`}
                          </span>
                        )}
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
                  );
                })}
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

      {importOpen && user && (
        <CsvImportModal
          orgId={user.orgId}
          onClose={() => setImportOpen(false)}
          onSuccess={() => { setImportOpen(false); load(true); }}
        />
      )}

      {newStopOpen && user && (
        <NewStopModal
          orgId={user.orgId}
          onClose={() => setNewStopOpen(false)}
          onSuccess={() => { setNewStopOpen(false); load(true); }}
        />
      )}

      {reassignOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={() => { setReassignOpen(false); setReassignLoading(false); setSelectedRouteId(''); }}
        >
          <div
            className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[80vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">Reassign {selectedIds.size} stop{selectedIds.size !== 1 ? 's' : ''}</h2>
                <p className="text-xs text-gray-400 mt-0.5">Select a route to move the selected stops to</p>
              </div>
              <button onClick={() => { setReassignOpen(false); setReassignLoading(false); setSelectedRouteId(''); }} className="text-gray-400 hover:text-gray-600 p-1">
                <X size={16} />
              </button>
            </div>

            {/* Route list */}
            <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
              {routesLoading ? (
                <div className="space-y-2">
                  {[1,2,3].map(i => <div key={i} className="h-14 bg-gray-50 rounded-lg animate-pulse" />)}
                </div>
              ) : routeOptions.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-gray-400">
                  <Truck size={24} className="mb-2 opacity-30" />
                  <p className="text-sm">No active routes available</p>
                </div>
              ) : routeOptions.map(r => (
                <button
                  key={r.id}
                  onClick={() => setSelectedRouteId(r.id)}
                  className={`w-full text-left p-3 rounded-lg border transition-colors ${
                    selectedRouteId === r.id
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-100 hover:border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">
                        {r.planDate ?? 'No date'} — {r.driverName ?? 'Unassigned'}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5 truncate">
                        {r.depotName ?? 'No depot'} · {r.stopCount} stop{r.stopCount !== 1 ? 's' : ''} assigned
                      </p>
                    </div>
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0 ${
                      r.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {r.status}
                    </span>
                  </div>
                </button>
              ))}
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between gap-3">
              {reassignError ? (
                <span className="text-xs text-red-500">{reassignError}</span>
              ) : (
                <span className="text-xs text-gray-400">
                  {selectedRouteId ? 'Route selected' : 'No route selected'}
                </span>
              )}
              <div className="flex items-center gap-2 ml-auto">
                <button
                  onClick={() => { setReassignOpen(false); setReassignLoading(false); setSelectedRouteId(''); }}
                  className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={bulkReassign}
                  disabled={!selectedRouteId || reassignLoading}
                  className="px-4 py-2 text-sm bg-[#0F4C81] text-white rounded-lg hover:bg-[#0a3860] disabled:opacity-40 transition-colors"
                >
                  {reassignLoading ? 'Reassigning…' : 'Reassign stops'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-gray-900 text-white px-5 py-3 rounded-xl shadow-2xl border border-gray-700">
          <span className="text-sm font-semibold">{selectedIds.size} selected</span>
          <div className="w-px h-4 bg-gray-700" />
          <button
            onClick={() => bulkAction('complete')}
            disabled={bulkLoading}
            className="text-sm text-emerald-400 hover:text-emerald-300 font-medium disabled:opacity-50 transition-colors"
          >
            ✓ Mark Delivered
          </button>
          <button
            onClick={() => bulkAction('failed')}
            disabled={bulkLoading}
            className="text-sm text-red-400 hover:text-red-300 font-medium disabled:opacity-50 transition-colors"
          >
            ✗ Mark Failed
          </button>
          <div className="w-px h-4 bg-gray-700" />
          <button
            onClick={openReassignModal}
            disabled={bulkLoading}
            className="flex items-center gap-1.5 text-sm text-blue-300 hover:text-blue-200 font-medium disabled:opacity-50 transition-colors"
          >
            <ArrowRightLeft size={13} /> Reassign
          </button>
          {bulkError && <span className="text-xs text-amber-300 max-w-[200px] truncate">{bulkError}</span>}
          {bulkLoading && <span className="text-xs text-gray-400 animate-pulse">Updating…</span>}
          <div className="w-px h-4 bg-gray-700" />
          <button
            onClick={() => { setSelectedIds(new Set()); setBulkError(''); }}
            className="text-xs text-gray-400 hover:text-gray-200 transition-colors"
          >
            Clear
          </button>
        </div>
      )}
    </div>
  );
}
