'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { Badge } from '@/components/ui/Badge';
import { Search, X, ArrowRight } from 'lucide-react';

interface StopResult { id: string; recipientName: string; address: string; status: string; }
interface DriverResult { id: string; name: string; email: string; status: string; }
interface LeadResult { id: string; name: string; city: string; state: string; score: number; status: string; }
interface SearchResponse {
  stops: StopResult[]; drivers: DriverResult[]; leads: LeadResult[];
  total: number; query: string; took: number;
}

const SCORE_COLORS = (s: number) =>
  s >= 80 ? 'bg-green-100 text-green-700' : s >= 50 ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-500';

const STATUS_DOTS: Record<string, string> = {
  available: 'bg-green-500', on_route: 'bg-blue-500', offline: 'bg-gray-300',
};

interface Props { open: boolean; onClose: () => void; }

export function CommandPalette({ open, onClose }: Props) {
  const router = useRouter();
  const user = getUser();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchGenRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when opened; reset + invalidate in-flight requests on close
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      searchGenRef.current++; // invalidate any in-flight request from previous open
      setQuery('');
      setResults(null);
    }
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [open]);

  const doSearch = useCallback(async (q: string, gen: number) => {
    if (!user || !q.trim()) { setResults(null); return; }
    setLoading(true);
    try {
      const data = await api.get<SearchResponse>(`/orgs/${user.orgId}/search?q=${encodeURIComponent(q.trim())}&type=all`);
      if (gen !== searchGenRef.current) return; // superseded by newer search or close
      setResults(data);
    } catch {
      if (gen !== searchGenRef.current) return;
      setResults(null);
    }
    finally { if (gen === searchGenRef.current) setLoading(false); }
  }, [user]);

  const handleInput = (v: string) => {
    setQuery(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const gen = ++searchGenRef.current; // invalidate any in-flight request
    if (!v.trim()) { setResults(null); return; }
    debounceRef.current = setTimeout(() => doSearch(v, gen), 300);
  };

  const navigate = (path: string) => { router.push(path); onClose(); };

  if (!open) return null;

  const hasResults = results && results.total > 0;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-start justify-center pt-[15vh] bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-xl mx-4 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
          <Search size={16} className="text-gray-400 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => handleInput(e.target.value)}
            placeholder="Search stops, drivers, leads…"
            className="flex-1 text-sm text-gray-900 placeholder:text-gray-400 outline-none bg-transparent"
          />
          {loading && <span className="w-3.5 h-3.5 border-2 border-gray-200 border-t-gray-400 rounded-full animate-spin shrink-0" />}
          {!loading && query && (
            <button onClick={() => handleInput('')} className="text-gray-300 hover:text-gray-500">
              <X size={14} />
            </button>
          )}
          <kbd className="hidden sm:block text-[10px] text-gray-300 border border-gray-200 rounded px-1.5 py-0.5 font-mono shrink-0">Esc</kbd>
        </div>

        {/* Results */}
        <div className="max-h-[60vh] overflow-y-auto">
          {!query && (
            <div className="px-4 py-8 text-center text-sm text-gray-400">
              Type to search stops, drivers, or pharmacy leads
            </div>
          )}

          {query && !loading && results?.total === 0 && (
            <div className="px-4 py-8 text-center text-sm text-gray-400">
              No results for <strong className="text-gray-600">"{query}"</strong>
            </div>
          )}

          {hasResults && (
            <div className="py-2">
              {/* Stops */}
              {results.stops.length > 0 && (
                <div>
                  <p className="px-4 pt-2 pb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                    Stops
                  </p>
                  {results.stops.map(stop => (
                    <button
                      key={stop.id}
                      onClick={() => navigate(`/dashboard/stops/${stop.id}`)}
                      className="w-full flex items-center justify-between gap-4 px-4 py-2.5 hover:bg-blue-50 transition-colors text-left group"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900 truncate">{stop.recipientName}</p>
                        <p className="text-xs text-gray-400 truncate">{stop.address}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge status={stop.status} />
                        <ArrowRight size={12} className="text-gray-300 group-hover:text-blue-400 transition-colors" />
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* Drivers */}
              {results.drivers.length > 0 && (
                <div>
                  <p className="px-4 pt-3 pb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                    Drivers
                  </p>
                  {results.drivers.map(d => (
                    <button
                      key={d.id}
                      onClick={() => navigate(`/dashboard/drivers/${d.id}`)}
                      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-blue-50 transition-colors text-left group"
                    >
                      <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOTS[d.status] ?? 'bg-gray-300'}`} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900">{d.name}</p>
                        <p className="text-xs text-gray-400 truncate">{d.email}</p>
                      </div>
                      <ArrowRight size={12} className="text-gray-300 group-hover:text-blue-400 transition-colors shrink-0" />
                    </button>
                  ))}
                </div>
              )}

              {/* Leads */}
              {results.leads.length > 0 && (
                <div>
                  <p className="px-4 pt-3 pb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                    Leads
                  </p>
                  {results.leads.map(lead => (
                    <button
                      key={lead.id}
                      onClick={() => navigate(`/dashboard/leads/${lead.id}`)}
                      className="w-full flex items-center justify-between gap-4 px-4 py-2.5 hover:bg-blue-50 transition-colors text-left group"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900 truncate">{lead.name}</p>
                        <p className="text-xs text-gray-400">{lead.city}, {lead.state}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SCORE_COLORS(lead.score)}`}>{lead.score}</span>
                        <ArrowRight size={12} className="text-gray-300 group-hover:text-blue-400 transition-colors" />
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* View all link */}
              <div className="px-4 pt-2 pb-3 border-t border-gray-50 mt-2">
                <button
                  onClick={() => navigate(`/dashboard/search?q=${encodeURIComponent(query)}`)}
                  className="text-xs text-blue-600 hover:underline"
                >
                  View all results for "{query}" →
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
