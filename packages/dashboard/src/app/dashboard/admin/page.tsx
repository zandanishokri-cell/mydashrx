'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { Crown, Building2, Users, Truck, TrendingUp, DollarSign, Plus, X } from 'lucide-react';

interface OrgRow {
  id: string; name: string; timezone: string; billingPlan: string;
  hipaaBaaStatus: string; userCount: number; stopCount30d: number; createdAt: string;
}
interface Stats {
  totalOrgs: number; activeOrgs: number; totalDrivers: number;
  totalStops30d: number; totalStopsAllTime: number; revenueEstimate: number;
  topOrgs: { orgId: string; orgName: string; stops30d: number }[];
}

const planColors: Record<string, string> = {
  starter: 'bg-gray-100 text-gray-600',
  growth: 'bg-blue-100 text-blue-700',
  pro: 'bg-indigo-100 text-indigo-700',
  enterprise: 'bg-purple-100 text-purple-700',
};
const baaColors: Record<string, string> = {
  signed: 'bg-green-100 text-green-700',
  pending: 'bg-yellow-100 text-yellow-700',
  not_required: 'bg-gray-100 text-gray-500',
  expired: 'bg-red-100 text-red-600',
};

function StatCard({ icon: Icon, label, value, sub }: { icon: any; label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-purple-100 px-5 py-4 flex items-center gap-4">
      <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center shrink-0">
        <Icon size={18} className="text-purple-600" />
      </div>
      <div>
        <p className="text-xs text-gray-400">{label}</p>
        <p className="text-xl font-bold text-gray-900">{value}</p>
        {sub && <p className="text-xs text-gray-400">{sub}</p>}
      </div>
    </div>
  );
}

export default function AdminPage() {
  const router = useRouter();
  const user = getUser();
  const [stats, setStats] = useState<Stats | null>(null);
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', timezone: 'America/New_York', adminName: '', adminEmail: '', adminPassword: '' });
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState('');

  useEffect(() => {
    if (!user || user.role !== 'super_admin') { router.replace('/dashboard'); return; }
    load();
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const [s, o] = await Promise.all([
        api.get<Stats>('/admin/stats'),
        api.get<OrgRow[]>('/admin/orgs'),
      ]);
      setStats(s); setOrgs(o);
    } finally { setLoading(false); }
  };

  const changePlan = async (orgId: string, plan: string) => {
    await api.patch(`/admin/orgs/${orgId}/plan`, { plan });
    setOrgs(prev => prev.map(o => o.id === orgId ? { ...o, billingPlan: plan } : o));
  };

  const changeBaa = async (orgId: string, status: string) => {
    await api.patch(`/admin/orgs/${orgId}/baa`, { status });
    setOrgs(prev => prev.map(o => o.id === orgId ? { ...o, hipaaBaaStatus: status } : o));
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true); setCreateErr('');
    try {
      await api.post('/admin/orgs', createForm);
      setShowCreate(false);
      setCreateForm({ name: '', timezone: 'America/New_York', adminName: '', adminEmail: '', adminPassword: '' });
      load();
    } catch (err: any) {
      setCreateErr(err.message ?? 'Failed to create org');
    } finally { setCreating(false); }
  };

  if (!user || user.role !== 'super_admin') return null;

  return (
    <div className="flex flex-col h-full bg-purple-50/30">
      {/* Header */}
      <div className="px-6 py-5 border-b border-purple-100 bg-white/80 backdrop-blur-sm shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <Crown size={20} className="text-purple-600" />
            <h1 className="text-xl font-bold text-gray-900" style={{ fontFamily: 'var(--font-sora)' }}>Platform Admin</h1>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 transition-colors"
          >
            <Plus size={15} /> Create Org
          </button>
        </div>
        {/* Stats row */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <StatCard icon={Building2} label="Total Orgs" value={stats.totalOrgs} sub={`${stats.activeOrgs} active`} />
            <StatCard icon={Building2} label="Active Orgs (30d)" value={stats.activeOrgs} />
            <StatCard icon={Users} label="Total Drivers" value={stats.totalDrivers} />
            <StatCard icon={Truck} label="Stops (30d)" value={stats.totalStops30d.toLocaleString()} />
            <StatCard icon={DollarSign} label="Est. Revenue/mo" value={`$${stats.revenueEstimate.toLocaleString()}`} />
          </div>
        )}
      </div>

      {/* Orgs table */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {loading ? (
          <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-14 bg-white rounded-xl border border-purple-100 animate-pulse" />)}</div>
        ) : (
          <div className="bg-white rounded-xl border border-purple-100 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-purple-50/60 border-b border-purple-100">
                  {['Organization', 'Plan', 'BAA Status', 'Users', 'Stops / 30d', 'Created', 'Actions'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {orgs.map(org => (
                  <tr key={org.id} className="hover:bg-purple-50/30 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-900">{org.name}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${planColors[org.billingPlan] ?? 'bg-gray-100 text-gray-600'}`}>
                        {org.billingPlan}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${baaColors[org.hipaaBaaStatus] ?? 'bg-gray-100 text-gray-500'}`}>
                        {org.hipaaBaaStatus.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{org.userCount}</td>
                    <td className="px-4 py-3 text-gray-600">{org.stopCount30d}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">
                      {new Date(org.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <select
                          value={org.billingPlan}
                          onChange={e => changePlan(org.id, e.target.value)}
                          className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-purple-200 bg-white"
                        >
                          {['starter','growth','pro','enterprise'].map(p => (
                            <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                          ))}
                        </select>
                        <select
                          value={org.hipaaBaaStatus}
                          onChange={e => changeBaa(org.id, e.target.value)}
                          className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-purple-200 bg-white"
                        >
                          {['pending','signed','not_required','expired'].map(s => (
                            <option key={s} value={s}>{s.replace('_', ' ')}</option>
                          ))}
                        </select>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {orgs.length === 0 && (
              <div className="text-center py-12 text-gray-400 text-sm">No organizations found</div>
            )}
          </div>
        )}
      </div>

      {/* Create Org Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm bg-black/20">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 border border-purple-100">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">Create Organization</h2>
              <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleCreate} className="px-6 py-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Org Name</label>
                <input required value={createForm.name} onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-200" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Timezone</label>
                <select value={createForm.timezone} onChange={e => setCreateForm(f => ({ ...f, timezone: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-200 bg-white">
                  <option value="America/New_York">Eastern (America/New_York)</option>
                  <option value="America/Chicago">Central (America/Chicago)</option>
                  <option value="America/Denver">Mountain (America/Denver)</option>
                  <option value="America/Los_Angeles">Pacific (America/Los_Angeles)</option>
                </select>
              </div>
              <div className="border-t border-gray-100 pt-3">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Admin User</p>
                <div className="space-y-2">
                  <input required placeholder="Full name" value={createForm.adminName}
                    onChange={e => setCreateForm(f => ({ ...f, adminName: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-200" />
                  <input required type="email" placeholder="Email" value={createForm.adminEmail}
                    onChange={e => setCreateForm(f => ({ ...f, adminEmail: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-200" />
                  <input required type="password" placeholder="Temporary password" value={createForm.adminPassword}
                    onChange={e => setCreateForm(f => ({ ...f, adminPassword: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-200" />
                </div>
              </div>
              {createErr && <p className="text-xs text-red-500">{createErr}</p>}
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setShowCreate(false)}
                  className="flex-1 border border-gray-200 rounded-lg py-2 text-sm text-gray-600 hover:bg-gray-50 transition-colors">
                  Cancel
                </button>
                <button type="submit" disabled={creating}
                  className="flex-1 bg-purple-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-purple-700 transition-colors disabled:opacity-60">
                  {creating ? 'Creating…' : 'Create Org'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
