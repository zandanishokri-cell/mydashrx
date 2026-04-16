'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { Badge } from '@/components/ui/Badge';
import { Search, Clock, X } from 'lucide-react';

interface StopResult {
  id: string; recipientName: string; address: string; status: string;
  routeId: string; driverName?: string; planDate?: string; createdAt: string;
}
interface DriverResult {
  id: string; name: string; email: string; phone: string;
  status: string; vehicleType: string;
}
interface LeadResult {
  id: string; name: string; city: string; state: string;
  score: number; status: string; ownerName?: string; phone?: string;
}
interface SearchResponse {
  stops: StopResult[]; drivers: DriverResult[]; leads: LeadResult[];
  total: number; query: string; took: number;
}

const RECENT_KEY = 'search_recent';
const loadRecent = (): string[] => {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'); } catch { return []; }
};
const saveRecent = (q: string) => {
  const prev = loadRecent().filter(x => x !== q);
  localStorage.setItem(RECENT_KEY, JSON.stringify([q, ...prev].slice(0, 5)));
};

const SCORE_COLORS = (s: number) =>
  s >= 80 ? 'bg-green-100 text-green-700' :
  s >= 50 ? 'bg-yellow-100 text-yellow-700' :
  'bg-gray-100 text-gray-500';

const STATUS_DOTS: Record<string, string> = {
  available: 'bg-green-500', on_route: 'bg-blue-500', offline: 'bg-gray-300',
};

type TabType = 'all' | 'stops' | 'drivers' | 'leads';

export default function SearchPage() {
  const router = useRouter();
  const user = getUser();
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<TabType>('all');
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setRecent(loadRecent()); }, []);

  const doSearch = useCallback(async (q: string) => {
    if (!user || !q.trim()) { setResults(null); return; }
    setLoading(true); setError(false);
    try {
      // Always fetch all types so tab counts stay accurate without re-fetching
      const params = new URLSearchParams({ q: q.trim(), type: 'all' });
      const data = await api.get<SearchResponse>(`/orgs/${user.orgId}/search?${params}`);
      setResults(data);
      saveRecent(q.trim());
      setRecent(loadRecent());
    } catch { setResults(null); setError(true); }
    finally { setLoading(false); }
  }, [user]);

  const handleInput = (v: string) => {
    setQuery(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!v.trim()) { setResults(null); setError(false); return; }
    debounceRef.current = setTimeout(() => doSearch(v), 350);
  };

  // Tab change: filter client-side — no re-fetch, no stale counts
  const handleTabChange = (t: TabType) => { setTab(t); };

  const useRecent = (q: string) => { setQuery(q); doSearch(q); };
  const clearRecent = () => { localStorage.removeItem(RECENT_KEY); setRecent([]); };

  const stopsShown = tab === 'all' || tab === 'stops' ? results?.stops ?? [] : [];
  const driversShown = tab === 'all' || tab === 'drivers' ? results?.drivers ?? [] : [];
  const leadsShown = tab === 'all' || tab === 'leads' ? results?.leads ?? [] : [];

  const tabs: { key: TabType; label: string; count?: number }[] = [
    { key: 'all', label: 'All', count: results?.total },
    { key: 'stops', label: 'Stops', count: results?.stops.length },
    { key: 'drivers', label: 'Drivers', count: results?.drivers.length },
    { key: 'leads', label: 'Leads', count: results?.leads.length },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-100 bg-white shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-bold text-gray-900" style={{ fontFamily: 'var(--font-sora)' }}>Search</h1>
          <span className="hidden md:flex items-center gap-1 text-xs text-gray-400 border border-gray-200 rounded px-2 py-1">
            <kbd className="font-mono">⌘K</kbd> to focus
          </span>
        </div>

        {/* Search input */}
        <div className="relative mb-3">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => handleInput(e.target.value)}
            placeholder="Search stops, drivers, leads..."
            className="w-full pl-10 pr-10 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-100 bg-white"
          />
          {query && (
            <button onClick={() => { setQuery(''); setResults(null); setError(false); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X size={14} />
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => handleTabChange(t.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                tab === t.key ? 'bg-blue-50 text-blue-700' : 'text-gray-500 hover:bg-gray-50'
              }`}
            >
              {t.label}
              {t.count !== undefined && results && (
                <span className={`text-xs px-1.5 rounded-full ${tab === t.key ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                  {t.count}
                </span>
              )}
            </button>
          ))}
          {results && <span className="ml-auto text-xs text-gray-400 self-center">{results.took}ms</span>}
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 py-4 space-y-5">
        {/* Recent searches */}
        {!query && recent.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Recent</p>
              <button onClick={clearRecent} className="text-xs text-gray-400 hover:text-gray-600">Clear</button>
            </div>
            <div className="flex flex-wrap gap-2">
              {recent.map(r => (
                <button key={r} onClick={() => useRecent(r)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs text-gray-600 hover:border-blue-200 hover:text-blue-600 transition-colors">
                  <Clock size={11} className="text-gray-400" /> {r}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-14 bg-white rounded-xl border border-gray-100 animate-pulse" />)}</div>
        )}

        {/* Empty state */}
        {!loading && !query && recent.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <Search size={40} className="mb-3 opacity-20" />
            <p className="text-sm">Search stops, drivers, and pharmacy leads</p>
            <p className="text-xs mt-1 opacity-60">Use <kbd className="font-mono">⌘K</kbd> from anywhere in the dashboard</p>
          </div>
        )}

        {/* Search error */}
        {!loading && error && (
          <div className="text-center py-12 text-sm text-red-500">
            <p>Search failed — check your connection and try again.</p>
          </div>
        )}

        {/* No results */}
        {!loading && !error && results && results.total === 0 && (
          <div className="text-center py-16 text-gray-400 text-sm">
            <p>No results for <strong className="text-gray-600">"{results.query}"</strong></p>
            <p className="text-xs mt-1">Try searching by address, name, Rx#, or phone number</p>
          </div>
        )}

        {/* Stops */}
        {!loading && stopsShown.length > 0 && (
          <section>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Stops ({stopsShown.length})</p>
            <div className="space-y-px">
              {stopsShown.map(stop => (
                <div key={stop.id} onClick={() => router.push(`/dashboard/stops/${stop.id}`)}
                  className="bg-white border border-gray-100 rounded-xl px-4 py-3 hover:border-blue-200 hover:shadow-sm cursor-pointer transition-all flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-gray-900 text-sm truncate">{stop.recipientName}</p>
                    <p className="text-xs text-gray-400 truncate">{stop.address}{stop.driverName ? ` · ${stop.driverName}` : ''}{stop.planDate ? ` · ${stop.planDate}` : ''}</p>
                  </div>
                  <div className="shrink-0">
                    <Badge status={stop.status} />
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Drivers */}
        {!loading && driversShown.length > 0 && (
          <section>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Drivers ({driversShown.length})</p>
            <div className="space-y-px">
              {driversShown.map(d => (
                <div key={d.id} onClick={() => router.push(`/dashboard/drivers/${d.id}`)}
                  className="bg-white border border-gray-100 rounded-xl px-4 py-3 hover:border-blue-200 hover:shadow-sm cursor-pointer transition-all flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOTS[d.status] ?? 'bg-gray-300'}`} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-gray-900 text-sm">{d.name}</p>
                    <p className="text-xs text-gray-400">{d.email} · {d.phone} · {d.vehicleType}</p>
                  </div>
                  <span className="text-xs text-gray-400 capitalize shrink-0">{d.status.replace('_', ' ')}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Leads */}
        {!loading && leadsShown.length > 0 && (
          <section>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Leads ({leadsShown.length})</p>
            <div className="space-y-px">
              {leadsShown.map(lead => (
                <div key={lead.id} onClick={() => router.push(`/dashboard/leads/${lead.id}`)}
                  className="bg-white border border-gray-100 rounded-xl px-4 py-3 hover:border-blue-200 hover:shadow-sm cursor-pointer transition-all flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-gray-900 text-sm">{lead.name}</p>
                    <p className="text-xs text-gray-400">{lead.city}, {lead.state}{lead.ownerName ? ` · ${lead.ownerName}` : ''}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SCORE_COLORS(lead.score)}`}>
                      {lead.score}
                    </span>
                    <span className="text-xs text-gray-400 capitalize">{lead.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

    </div>
  );
}
