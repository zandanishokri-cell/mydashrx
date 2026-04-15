'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { Search, Plus, Phone, Mail, ExternalLink, ChevronLeft, ChevronRight, UserSearch } from 'lucide-react';

interface Lead {
  id: string; name: string; city: string; state: string; address: string;
  phone: string | null; email: string | null; website: string | null;
  score: number; status: string; lastContactedAt: string | null;
  nextFollowUp: string | null; rating: number | null; reviewCount: number | null;
}

interface LeadsResponse {
  leads: Lead[]; total: number; page: number; limit: number; pages: number;
}

interface Stats { total: number; byStatus: Record<string, number>; conversionRate: number }

const STATUS_COLORS: Record<string, string> = {
  new: 'bg-blue-100 text-blue-700',
  contacted: 'bg-purple-100 text-purple-700',
  interested: 'bg-amber-100 text-amber-700',
  negotiating: 'bg-orange-100 text-orange-700',
  closed: 'bg-emerald-100 text-emerald-700',
  lost: 'bg-gray-100 text-gray-500',
};

const STATUSES = ['all', 'new', 'contacted', 'interested', 'negotiating', 'closed', 'lost'];

function ScoreBadge({ score }: { score: number }) {
  const cls = score >= 70 ? 'bg-emerald-100 text-emerald-700'
    : score >= 40 ? 'bg-amber-100 text-amber-700'
    : 'bg-gray-100 text-gray-600';
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cls}`}>{score}</span>;
}

export default function LeadsPage() {
  const [user] = useState(getUser);
  const router = useRouter();
  const [data, setData] = useState<LeadsResponse | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '25' });
      if (status !== 'all') params.set('status', status);
      if (search) params.set('search', search);
      const [leadsData, statsData] = await Promise.all([
        api.get<LeadsResponse>(`/orgs/${user.orgId}/leads?${params}`),
        api.get<Stats>(`/orgs/${user.orgId}/leads/stats`),
      ]);
      setData(leadsData);
      setStats(statsData);
    } catch { setData(null); }
    finally { setLoading(false); }
  }, [user, status, search, page]);

  useEffect(() => { load(); }, [load]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput);
    setPage(1);
  };

  const handleStatusChange = (s: string) => { setStatus(s); setPage(1); };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900" style={{ fontFamily: 'var(--font-sora)' }}>Lead Finder</h1>
          <p className="text-sm text-gray-500 mt-0.5">Find and manage pharmacy prospects</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/dashboard/leads/pipeline"
            className="px-4 py-2 rounded-lg text-sm font-medium border border-gray-200 text-gray-700 hover:bg-gray-50">
            Pipeline View
          </Link>
          <Link href="/dashboard/leads/search"
            className="bg-[#0F4C81] hover:bg-[#0a3d6b] text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2">
            <Search size={14} /> Search Pharmacies
          </Link>
        </div>
      </div>

      {/* Stats row */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm col-span-2 sm:col-span-1">
            <p className="text-xs text-gray-500">Total Leads</p>
            <p className="text-2xl font-bold text-gray-900 mt-1" style={{ fontFamily: 'var(--font-sora)' }}>{stats.total}</p>
          </div>
          {(['new','contacted','interested','negotiating','closed','lost'] as const).map(s => (
            <div key={s} className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
              <p className="text-xs text-gray-500 capitalize">{s}</p>
              <p className="text-xl font-bold text-gray-900 mt-1" style={{ fontFamily: 'var(--font-sora)' }}>
                {stats.byStatus[s] ?? 0}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Status tabs */}
        <div className="flex bg-white border border-gray-200 rounded-lg p-0.5 gap-0.5">
          {STATUSES.map(s => (
            <button key={s} onClick={() => handleStatusChange(s)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium capitalize transition-colors ${
                status === s ? 'bg-[#0F4C81] text-white' : 'text-gray-600 hover:bg-gray-50'
              }`}>
              {s}
            </button>
          ))}
        </div>
        {/* Search */}
        <form onSubmit={handleSearch} className="flex items-center gap-2 flex-1 max-w-xs">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder="Search by name or city…"
              className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0F4C81]/20"
            />
          </div>
          <button type="submit" className="bg-[#0F4C81] hover:bg-[#0a3d6b] text-white px-3 py-2 rounded-lg text-sm font-medium">
            Go
          </button>
        </form>
      </div>

      {/* Lead cards */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-40 bg-white rounded-xl border border-gray-100 animate-pulse" />
          ))}
        </div>
      ) : !data?.leads.length ? (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
          <UserSearch size={48} className="text-gray-300 mx-auto mb-3" />
          <p className="text-gray-800 font-semibold text-sm mb-1">No leads yet</p>
          <p className="text-gray-400 text-sm">Leads will appear here as patients are added.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {data.leads.map(lead => (
            <div key={lead.id} className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-gray-900 truncate text-sm" style={{ fontFamily: 'var(--font-sora)' }}>
                    {lead.name}
                  </h3>
                  <p className="text-xs text-gray-500 mt-0.5">{lead.city}, {lead.state}</p>
                </div>
                <div className="flex items-center gap-1.5 ml-2 shrink-0">
                  <ScoreBadge score={lead.score} />
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[lead.status] ?? 'bg-gray-100 text-gray-600'}`}>
                    {lead.status}
                  </span>
                </div>
              </div>

              <div className="space-y-1 mb-3">
                {lead.phone && (
                  <a href={`tel:${lead.phone}`} className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-[#0F4C81]">
                    <Phone size={11} /> {lead.phone}
                  </a>
                )}
                {lead.email && (
                  <p className="flex items-center gap-1.5 text-xs text-gray-600 truncate">
                    <Mail size={11} /> {lead.email}
                  </p>
                )}
                {lead.lastContactedAt && (
                  <p className="text-xs text-gray-400">
                    Last contact: {new Date(lead.lastContactedAt).toLocaleDateString()}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2 pt-2 border-t border-gray-50">
                <Link href={`/dashboard/leads/${lead.id}`}
                  className="flex-1 text-center text-xs font-medium text-[#0F4C81] hover:bg-blue-50 py-1.5 rounded-md transition-colors">
                  View
                </Link>
                <button
                  onClick={() => router.push(`/dashboard/leads/${lead.id}?tab=outreach`)}
                  className="flex-1 text-center text-xs font-medium text-gray-600 hover:bg-gray-50 py-1.5 rounded-md transition-colors">
                  Send Email
                </button>
                {lead.website && (
                  <a href={lead.website} target="_blank" rel="noopener noreferrer"
                    className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-md transition-colors">
                    <ExternalLink size={13} />
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {data && data.pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-500">
            Showing {((data.page - 1) * data.limit) + 1}–{Math.min(data.page * data.limit, data.total)} of {data.total}
          </p>
          <div className="flex items-center gap-1">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
              className="p-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">
              <ChevronLeft size={14} />
            </button>
            <span className="text-xs text-gray-600 px-2">{page} / {data.pages}</span>
            <button disabled={page >= data.pages} onClick={() => setPage(p => p + 1)}
              className="p-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
