'use client';
import { useState, useRef } from 'react';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { Badge } from '@/components/ui/Badge';
import { DepotFilter } from '@/components/ui/DepotFilter';
import { StopDetailModal } from '@/components/StopDetailModal';
import { Search, CalendarDays } from 'lucide-react';

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

const DATE_PRESETS = [
  { label: 'Today', days: 0 },
  { label: 'This week', days: 7 },
  { label: 'This month', days: 30 },
  { label: 'Last 3 months', days: 90 },
  { label: 'All time', all: true },
];

export default function SearchPage() {
  const user = getUser();
  const [query, setQuery] = useState('');
  const [depotId, setDepotId] = useState('');
  const [datePreset, setDatePreset] = useState('Last 3 months');
  const [showDateMenu, setShowDateMenu] = useState(false);
  const [results, setResults] = useState<Stop[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedStop, setSelectedStop] = useState<Stop | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const getDateRange = () => {
    const preset = DATE_PRESETS.find(p => p.label === datePreset);
    if (!preset || preset.all) return {};
    if (preset.days === 0) {
      const today = new Date().toISOString().split('T')[0];
      return { from: today, to: today };
    }
    const from = new Date(Date.now() - (preset.days ?? 90) * 86400000).toISOString().split('T')[0];
    return { from };
  };

  const doSearch = async (q: string) => {
    if (!user) return;
    if (!q.trim() && !depotId) { setResults(null); return; }
    setLoading(true);
    try {
      const range = getDateRange();
      const params = new URLSearchParams({ limit: '100' });
      if (q.trim()) params.set('q', q.trim());
      if (depotId) params.set('depotId', depotId);
      if (range.from) params.set('from', range.from);
      const data = await api.get<{ stops: Stop[] }>(`/orgs/${user.orgId}/stops?${params}`);
      setResults(data.stops);
    } catch { setResults([]); }
    finally { setLoading(false); }
  };

  const handleInput = (v: string) => {
    setQuery(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(v), 400);
  };

  const handleDepotChange = (id: string) => {
    setDepotId(id);
    doSearch(query);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-gray-100 bg-white shrink-0">
        <h1 className="text-xl font-bold text-gray-900 mb-3" style={{ fontFamily: 'var(--font-sora)' }}>Search</h1>
        <div className="flex items-center gap-2">
          <DepotFilter value={depotId} onChange={handleDepotChange} />
          <div className="relative">
            <button
              onClick={() => setShowDateMenu(v => !v)}
              className="flex items-center gap-1.5 border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 bg-white hover:bg-gray-50"
            >
              <CalendarDays size={14} /> {datePreset}
            </button>
            {showDateMenu && (
              <div className="absolute top-full left-0 mt-1 bg-white border border-gray-100 rounded-xl shadow-lg z-20 w-44 py-1">
                {DATE_PRESETS.map(p => (
                  <button
                    key={p.label}
                    onClick={() => { setDatePreset(p.label); setShowDateMenu(false); doSearch(query); }}
                    className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-50 ${datePreset === p.label ? 'text-[#0F4C81] font-medium' : 'text-gray-700'}`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 py-4">
        {/* Search input */}
        <div className="relative mb-4">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            autoFocus
            value={query}
            onChange={e => handleInput(e.target.value)}
            placeholder="Search for stops..."
            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-100 bg-white"
          />
        </div>

        {/* Results */}
        {loading && (
          <div className="space-y-2">
            {[1, 2, 3].map(i => <div key={i} className="h-16 bg-white rounded-xl border border-gray-100 animate-pulse" />)}
          </div>
        )}

        {!loading && results === null && (
          <div className="flex flex-col items-center justify-center py-24 text-gray-400">
            <Search size={40} className="mb-3 opacity-20" />
            <p className="text-sm">Find stops by searching for addresses,</p>
            <p className="text-sm">recipients, phone numbers and more.</p>
          </div>
        )}

        {!loading && results !== null && results.length === 0 && (
          <div className="text-center py-16 text-gray-400 text-sm">No results found</div>
        )}

        {!loading && results && results.length > 0 && (
          <div>
            <p className="text-xs text-gray-400 mb-3">Results ({results.length})</p>
            <div className="space-y-px">
              {results.map(stop => (
                <div
                  key={stop.id}
                  onClick={() => setSelectedStop(stop)}
                  className="bg-white border border-gray-100 rounded-xl px-4 py-3 hover:border-blue-200 hover:shadow-sm cursor-pointer transition-all flex items-center justify-between gap-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      {stop.requiresRefrigeration && <span className="text-xs bg-blue-50 text-blue-600 px-1.5 rounded">❄</span>}
                      {stop.controlledSubstance && <span className="text-xs bg-orange-50 text-orange-600 px-1.5 rounded">⚠</span>}
                      <span className="font-medium text-gray-900 text-sm truncate">{stop.address}</span>
                    </div>
                    <p className="text-xs text-gray-400 truncate">{stop.depotName ?? ''}{stop.driverName ? ` · ${stop.driverName}` : ''}{stop.planDate ? ` · ${stop.planDate}` : ''}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {stop.rxNumbers?.length > 0 && <span className="text-xs text-gray-400">Rx ×{stop.rxNumbers.length}</span>}
                    <Badge status={stop.status} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {selectedStop && (
        <StopDetailModal
          stop={selectedStop}
          onClose={() => setSelectedStop(null)}
          onUpdated={() => { setSelectedStop(null); doSearch(query); }}
        />
      )}
    </div>
  );
}
