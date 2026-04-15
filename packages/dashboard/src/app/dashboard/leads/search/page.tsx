'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { Search, Star, ArrowLeft, CheckSquare, Square, Download } from 'lucide-react';

interface PlaceResult {
  googlePlaceId: string; name: string; address: string; city: string;
  state: string; zip: string; phone: string | null; website: string | null;
  rating: number | null; reviewCount: number | null; score: number; alreadyImported: boolean;
}

interface SearchResponse { results: PlaceResult[]; imported: number; skipped: number }

function ScoreBadge({ score }: { score: number }) {
  const cls = score >= 70 ? 'bg-emerald-100 text-emerald-700'
    : score >= 40 ? 'bg-amber-100 text-amber-700'
    : 'bg-gray-100 text-gray-600';
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cls}`}>{score}</span>;
}

function Stars({ rating }: { rating: number | null }) {
  if (!rating) return <span className="text-gray-400 text-xs">—</span>;
  return (
    <span className="flex items-center gap-0.5 text-xs text-amber-500">
      <Star size={11} fill="currentColor" /> {rating.toFixed(1)}
    </span>
  );
}

export default function LeadSearchPage() {
  const [user] = useState(getUser);
  const router = useRouter();
  const [city, setCity] = useState('');
  const [state, setState] = useState('MI');
  const [radius, setRadius] = useState('10');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [searched, setSearched] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !city.trim()) return;
    setLoading(true);
    setError(null);
    setResults([]);
    setSelected(new Set());
    try {
      const data = await api.post<SearchResponse>(`/orgs/${user.orgId}/leads/search-places`, {
        city: city.trim(), state, radius: Number(radius),
      });
      setResults(data.results);
      setSearched(true);
    } catch (err: any) {
      setError(err.message ?? 'Search failed');
    } finally {
      setLoading(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    const importable = results.filter(r => !r.alreadyImported).map(r => r.googlePlaceId);
    setSelected(new Set(importable));
  };

  const handleImport = async () => {
    if (!user || selected.size === 0) return;
    setImporting(true);
    const toImport = results.filter(r => selected.has(r.googlePlaceId) && !r.alreadyImported);
    let count = 0;
    for (const place of toImport) {
      try {
        await api.post(`/orgs/${user.orgId}/leads`, {
          name: place.name,
          address: place.address,
          city: place.city,
          state: place.state,
          zip: place.zip,
          phone: place.phone,
          website: place.website,
          googlePlaceId: place.googlePlaceId,
          rating: place.rating,
          reviewCount: place.reviewCount,
          score: place.score,
          sourceData: place,
        });
        count++;
      } catch { /* skip individual failures */ }
    }
    setImporting(false);
    // Mark imported
    setResults(prev => prev.map(r => selected.has(r.googlePlaceId) ? { ...r, alreadyImported: true } : r));
    setSelected(new Set());
    showToast(`Imported ${count} lead${count !== 1 ? 's' : ''} successfully`);
  };

  const importable = results.filter(r => !r.alreadyImported);

  return (
    <div className="p-6 space-y-6">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-emerald-600 text-white px-4 py-3 rounded-xl shadow-lg text-sm font-medium">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/dashboard/leads" className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50">
          <ArrowLeft size={15} className="text-gray-600" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-gray-900" style={{ fontFamily: 'var(--font-sora)' }}>Search Pharmacies</h1>
          <p className="text-sm text-gray-500 mt-0.5">Discover pharmacy leads via Google Places</p>
        </div>
      </div>

      {/* Search form */}
      <form onSubmit={handleSearch} className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-48">
            <label className="block text-xs font-medium text-gray-700 mb-1.5">City</label>
            <input
              required value={city} onChange={e => setCity(e.target.value)}
              placeholder="e.g. Detroit"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0F4C81]/20"
            />
          </div>
          <div className="w-24">
            <label className="block text-xs font-medium text-gray-700 mb-1.5">State</label>
            <input
              value={state} onChange={e => setState(e.target.value.toUpperCase().slice(0, 2))}
              maxLength={2} placeholder="MI"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0F4C81]/20 uppercase"
            />
          </div>
          <div className="w-36">
            <label className="block text-xs font-medium text-gray-700 mb-1.5">Radius</label>
            <select
              value={radius} onChange={e => setRadius(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0F4C81]/20 bg-white"
            >
              <option value="5">5 miles</option>
              <option value="10">10 miles</option>
              <option value="25">25 miles</option>
              <option value="50">50 miles</option>
            </select>
          </div>
          <button type="submit" disabled={loading}
            className="bg-[#0F4C81] hover:bg-[#0a3d6b] text-white px-5 py-2 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-60">
            <Search size={14} /> {loading ? 'Searching…' : 'Search'}
          </button>
        </div>
      </form>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm">{error}</div>
      )}

      {/* Results */}
      {searched && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
            <div className="flex items-center gap-3">
              <p className="text-sm font-semibold text-gray-900">
                {results.length} results — {importable.length} new
              </p>
              {importable.length > 0 && (
                <button onClick={selectAll} className="text-xs text-[#0F4C81] hover:underline">
                  Select all new
                </button>
              )}
            </div>
            {selected.size > 0 && (
              <button onClick={handleImport} disabled={importing}
                className="bg-[#0F4C81] hover:bg-[#0a3d6b] text-white px-4 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5 disabled:opacity-60">
                <Download size={13} /> {importing ? 'Importing…' : `Import ${selected.size} selected`}
              </button>
            )}
          </div>

          {results.length === 0 ? (
            <p className="text-center text-gray-400 text-sm py-10">No results found. Try a different city or radius.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/50">
                    <th className="px-4 py-3 w-8" />
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">Pharmacy</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">Address</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">Rating</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">Reviews</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">Score</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {results.map(place => {
                    const isSelected = selected.has(place.googlePlaceId);
                    return (
                      <tr key={place.googlePlaceId}
                        className={`hover:bg-gray-50 transition-colors ${isSelected ? 'bg-blue-50/30' : ''}`}>
                        <td className="px-4 py-3">
                          {place.alreadyImported ? (
                            <span className="text-gray-300"><CheckSquare size={16} /></span>
                          ) : (
                            <button onClick={() => toggleSelect(place.googlePlaceId)} className="text-gray-400 hover:text-[#0F4C81]">
                              {isSelected ? <CheckSquare size={16} className="text-[#0F4C81]" /> : <Square size={16} />}
                            </button>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-900">{place.name}</p>
                          {place.phone && <p className="text-xs text-gray-500 mt-0.5">{place.phone}</p>}
                        </td>
                        <td className="px-4 py-3 text-gray-600 text-xs max-w-48 truncate">{place.address}</td>
                        <td className="px-4 py-3"><Stars rating={place.rating} /></td>
                        <td className="px-4 py-3 text-xs text-gray-600">{place.reviewCount ?? '—'}</td>
                        <td className="px-4 py-3"><ScoreBadge score={place.score} /></td>
                        <td className="px-4 py-3">
                          {place.alreadyImported ? (
                            <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium">Added</span>
                          ) : (
                            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">New</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
