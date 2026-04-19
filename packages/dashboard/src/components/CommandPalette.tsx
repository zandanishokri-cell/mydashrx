'use client';
import { useState, useRef, useEffect, useCallback, useId } from 'react';
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

interface Props { open: boolean; onClose: () => void; triggerRef?: React.RefObject<HTMLElement>; }

export function CommandPalette({ open, onClose, triggerRef }: Props) {
  const router = useRouter();
  const user = getUser();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchGenRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  // Flatten all result items for keyboard nav + aria-activedescendant
  const allItems = results ? [
    ...results.stops.map(s => ({ id: `cp-stop-${s.id}`, path: `/dashboard/stops/${s.id}` })),
    ...results.drivers.map(d => ({ id: `cp-driver-${d.id}`, path: `/dashboard/drivers/${d.id}` })),
    ...results.leads.map(l => ({ id: `cp-lead-${l.id}`, path: `/dashboard/leads/${l.id}` })),
  ] : [];

  // Focus input when opened; reset + invalidate in-flight requests on close
  useEffect(() => {
    if (open) {
      setActiveIdx(-1);
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      searchGenRef.current++;
      setQuery('');
      setResults(null);
      setActiveIdx(-1);
      // Return focus to trigger element
      triggerRef?.current?.focus();
    }
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // P-A11Y27: Focus trap — Tab/Shift+Tab cycles within panel; Escape closes
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx(i => Math.min(i + 1, allItems.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx(i => Math.max(i - 1, -1));
      } else if (e.key === 'Enter' && activeIdx >= 0 && allItems[activeIdx]) {
        navigate(allItems[activeIdx].path);
      } else if (e.key === 'Tab') {
        // Trap focus within panel
        const panel = panelRef.current;
        if (!panel) return;
        const focusable = Array.from(panel.querySelectorAll<HTMLElement>(
          'input, button, [href], [tabindex]:not([tabindex="-1"])'
        )).filter(el => !el.hasAttribute('disabled'));
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) { e.preventDefault(); last.focus(); }
        } else {
          if (document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, activeIdx, allItems]); // eslint-disable-line react-hooks/exhaustive-deps

  const doSearch = useCallback(async (q: string, gen: number) => {
    if (!user || !q.trim()) { setResults(null); return; }
    setLoading(true);
    try {
      const data = await api.get<SearchResponse>(`/orgs/${user.orgId}/search?q=${encodeURIComponent(q.trim())}&type=all`);
      if (gen !== searchGenRef.current) return;
      setResults(data);
    } catch {
      if (gen !== searchGenRef.current) return;
      setResults(null);
    }
    finally { if (gen === searchGenRef.current) setLoading(false); }
  }, [user]);

  const handleInput = (v: string) => {
    setQuery(v);
    setActiveIdx(-1);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const gen = ++searchGenRef.current;
    if (!v.trim()) { setResults(null); return; }
    debounceRef.current = setTimeout(() => doSearch(v, gen), 300);
  };

  const navigate = (path: string) => { router.push(path); onClose(); };

  const hasResults = results && results.total > 0;
  const resultCount = results?.total ?? 0;
  const activeItemId = activeIdx >= 0 && allItems[activeIdx] ? allItems[activeIdx].id : undefined;

  // Always-mounted, never hidden — screen reader lives outside conditional render
  const srStatus = (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {open && query && !loading && (resultCount > 0
        ? `${resultCount} result${resultCount !== 1 ? 's' : ''} for ${query}`
        : results ? `No results for ${query}` : ''
      )}
    </div>
  );

  if (!open) return <>{srStatus}</>;

  return (
    <>
      {srStatus}
      {/* P-A11Y27: backdrop — aria-hidden so SR skips it */}
      <div
        className="fixed inset-0 z-[9999] flex items-start justify-center pt-[15vh] bg-black/40 backdrop-blur-sm"
        aria-hidden="true"
        onClick={onClose}
      />
      {/* P-A11Y27: dialog panel — role=dialog + aria-modal traps SR reading order */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="fixed inset-0 z-[9999] flex items-start justify-center pt-[15vh] pointer-events-none"
      >
        <div
          className="bg-white rounded-2xl shadow-2xl w-full max-w-xl mx-4 overflow-hidden pointer-events-auto"
          onClick={e => e.stopPropagation()}
        >
          {/* Search input */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
            <Search size={16} className="text-gray-400 shrink-0" aria-hidden="true" />
            {/* P-A11Y27: combobox role + expanded state + controls link to listbox */}
            <input
              ref={inputRef}
              role="combobox"
              aria-label="Search stops, drivers, and leads"
              aria-expanded={hasResults ? true : false}
              aria-controls={listboxId}
              aria-activedescendant={activeItemId}
              aria-autocomplete="list"
              value={query}
              onChange={e => handleInput(e.target.value)}
              placeholder="Search stops, drivers, leads…"
              className="flex-1 text-sm text-gray-900 placeholder:text-gray-400 outline-none bg-transparent"
            />
            {loading && <span aria-hidden="true" className="w-3.5 h-3.5 border-2 border-gray-200 border-t-gray-400 rounded-full animate-spin shrink-0" />}
            {!loading && query && (
              <button onClick={() => handleInput('')} className="text-gray-300 hover:text-gray-500" aria-label="Clear search">
                <X size={14} aria-hidden="true" />
              </button>
            )}
            <kbd className="hidden sm:block text-[10px] text-gray-300 border border-gray-200 rounded px-1.5 py-0.5 font-mono shrink-0" aria-label="Press Escape to close">Esc</kbd>
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

            {/* P-A11Y27: listbox wraps all options */}
            <div id={listboxId} role="listbox" aria-label="Search results">
              {hasResults && (
                <div className="py-2">
                  {/* Stops */}
                  {results.stops.length > 0 && (
                    <div role="group" aria-label="Stops">
                      <p className="px-4 pt-2 pb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider" aria-hidden="true">
                        Stops
                      </p>
                      {results.stops.map((stop, i) => {
                        const itemId = `cp-stop-${stop.id}`;
                        const isActive = allItems.findIndex(x => x.id === itemId) === activeIdx;
                        return (
                          <button
                            key={stop.id}
                            id={itemId}
                            role="option"
                            aria-selected={isActive}
                            onClick={() => navigate(`/dashboard/stops/${stop.id}`)}
                            className={`w-full flex items-center justify-between gap-4 px-4 py-2.5 transition-colors text-left group ${isActive ? 'bg-blue-100' : 'hover:bg-blue-50'}`}
                          >
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-gray-900 truncate">{stop.recipientName}</p>
                              <p className="text-xs text-gray-400 truncate">{stop.address}</p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <Badge status={stop.status} />
                              <ArrowRight size={12} className="text-gray-300 group-hover:text-blue-400 transition-colors" aria-hidden="true" />
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Drivers */}
                  {results.drivers.length > 0 && (
                    <div role="group" aria-label="Drivers">
                      <p className="px-4 pt-3 pb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider" aria-hidden="true">
                        Drivers
                      </p>
                      {results.drivers.map(d => {
                        const itemId = `cp-driver-${d.id}`;
                        const isActive = allItems.findIndex(x => x.id === itemId) === activeIdx;
                        return (
                          <button
                            key={d.id}
                            id={itemId}
                            role="option"
                            aria-selected={isActive}
                            onClick={() => navigate(`/dashboard/drivers/${d.id}`)}
                            className={`w-full flex items-center gap-3 px-4 py-2.5 transition-colors text-left group ${isActive ? 'bg-blue-100' : 'hover:bg-blue-50'}`}
                          >
                            <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOTS[d.status] ?? 'bg-gray-300'}`} aria-hidden="true" />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-gray-900">{d.name}</p>
                              <p className="text-xs text-gray-400 truncate">{d.email}</p>
                            </div>
                            <ArrowRight size={12} className="text-gray-300 group-hover:text-blue-400 transition-colors shrink-0" aria-hidden="true" />
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Leads */}
                  {results.leads.length > 0 && (
                    <div role="group" aria-label="Leads">
                      <p className="px-4 pt-3 pb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider" aria-hidden="true">
                        Leads
                      </p>
                      {results.leads.map(lead => {
                        const itemId = `cp-lead-${lead.id}`;
                        const isActive = allItems.findIndex(x => x.id === itemId) === activeIdx;
                        return (
                          <button
                            key={lead.id}
                            id={itemId}
                            role="option"
                            aria-selected={isActive}
                            onClick={() => navigate(`/dashboard/leads/${lead.id}`)}
                            className={`w-full flex items-center justify-between gap-4 px-4 py-2.5 transition-colors text-left group ${isActive ? 'bg-blue-100' : 'hover:bg-blue-50'}`}
                          >
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-gray-900 truncate">{lead.name}</p>
                              <p className="text-xs text-gray-400">{lead.city}, {lead.state}</p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SCORE_COLORS(lead.score)}`}>{lead.score}</span>
                              <ArrowRight size={12} className="text-gray-300 group-hover:text-blue-400 transition-colors" aria-hidden="true" />
                            </div>
                          </button>
                        );
                      })}
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
      </div>
    </>
  );
}
