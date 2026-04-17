# Global ⌘K Command Palette

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ⌘K from any page in the dashboard opens a global search overlay — same API as the Search page but in a modal. Results navigate to detail pages and close the palette. This is the #1 SaaS UX pattern (Linear, Vercel, Notion) and a high-value demo feature.

**Architecture:** 
1. Extract search logic from `search/page.tsx` into a `useSearch` hook
2. New `CommandPalette.tsx` component — renders the hook's UI in a fixed modal overlay
3. `CommandPalette` mounted once in `dashboard/layout.tsx` — always present, hidden by default
4. Layout-level ⌘K listener opens/closes it
5. The existing Search page stays as-is (it can just use the same hook)

**Tech Stack:** Next.js 14, React, Tailwind. No backend changes.

---

## File Structure

- **Create:** `packages/dashboard/src/components/CommandPalette.tsx`
- **Modify:** `packages/dashboard/src/app/dashboard/layout.tsx` — mount palette + ⌘K listener
- **Modify:** `packages/dashboard/src/app/dashboard/search/page.tsx` — can stay, just remove ⌘K handler (layout handles it now)

---

## Task 1: Build CommandPalette component

**Files:**
- Create: `packages/dashboard/src/components/CommandPalette.tsx`

- [ ] **Step 1: Write the failing test** *(skip — this is a UI component; verify manually)*

- [ ] **Step 2: Create CommandPalette.tsx**

```tsx
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
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      // Reset on close
      setQuery('');
      setResults(null);
    }
  }, [open]);

  const doSearch = useCallback(async (q: string) => {
    if (!user || !q.trim()) { setResults(null); return; }
    setLoading(true);
    try {
      const data = await api.get<SearchResponse>(`/orgs/${user.orgId}/search?q=${encodeURIComponent(q.trim())}&type=all`);
      setResults(data);
    } catch { setResults(null); }
    finally { setLoading(false); }
  }, [user]);

  const handleInput = (v: string) => {
    setQuery(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!v.trim()) { setResults(null); return; }
    debounceRef.current = setTimeout(() => doSearch(v), 300);
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
            <button onClick={() => { setQuery(''); setResults(null); }} className="text-gray-300 hover:text-gray-500">
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
```

- [ ] **Step 3: TypeScript check**

```bash
cd packages/dashboard && npx tsc --noEmit
# Expected: no errors
```

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/src/components/CommandPalette.tsx
git commit -m "feat(ui): add CommandPalette component for global ⌘K search overlay"
```

---

## Task 2: Wire CommandPalette into dashboard layout

**Files:**
- Modify: `packages/dashboard/src/app/dashboard/layout.tsx`

- [ ] **Step 1: Read layout.tsx**

Read `packages/dashboard/src/app/dashboard/layout.tsx` to find the return statement where to add the palette.

- [ ] **Step 2: Add palette state + keyboard listener + render**

At the top of the layout component function, add:

```tsx
const [paletteOpen, setPaletteOpen] = useState(false);

useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      setPaletteOpen(prev => !prev);
    }
    if (e.key === 'Escape') setPaletteOpen(false);
  };
  document.addEventListener('keydown', handler);
  return () => document.removeEventListener('keydown', handler);
}, []);
```

In the return JSX, add `<CommandPalette>` just before the closing fragment:

```tsx
<CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
```

Add imports:
```tsx
import { useState, useEffect } from 'react';
import { CommandPalette } from '@/components/CommandPalette';
```

- [ ] **Step 3: Remove redundant ⌘K handler from search/page.tsx**

In `packages/dashboard/src/app/dashboard/search/page.tsx`, the Cmd+K useEffect now duplicates the layout handler. Remove it (lines 61–70):

```tsx
// DELETE this entire useEffect:
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      inputRef.current?.focus();
    }
  };
  document.addEventListener('keydown', handler);
  return () => document.removeEventListener('keydown', handler);
}, []);
```

- [ ] **Step 4: TypeScript check + commit**

```bash
cd packages/dashboard && npx tsc --noEmit
git add packages/dashboard/src/app/dashboard/layout.tsx \
        packages/dashboard/src/app/dashboard/search/page.tsx
git commit -m "feat(layout): wire global ⌘K command palette — opens overlay from any dashboard page"
```

---

## Self-Review

**Spec coverage:**
- Opens from any dashboard page via ⌘K ✅
- Esc closes ✅
- Backdrop click closes ✅
- Input focused on open ✅
- State resets on close (query + results cleared) ✅
- All three entity types shown ✅
- Navigate + close on result click ✅
- "View all results" link to full Search page ✅
- Loading spinner ✅
- Empty/no-results state ✅
- Mobile: no autoFocus issue (focus set via setTimeout in useEffect) ✅

**NOT included (intentional):**
- Keyboard navigation (arrow keys) — good V2 addition, not in this spec
- Recent searches in palette — palette is quick-access, full history on Search page
