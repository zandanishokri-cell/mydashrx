'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api, setImpersonateOrgId } from '@/lib/api';
import { getUser, getAccessToken } from '@/lib/auth';
import { Crown, Building2, Users, Truck, DollarSign, Plus, X, UserCheck, Mail, Activity, Download, AlertTriangle } from 'lucide-react';

interface OrgRow {
  id: string; name: string; billingPlan: string; pendingApproval: boolean;
  approvedAt: string | null; createdAt: string; onboardingStep: number | null;
  slaBreachedAt: string | null; escalationLevel: number; baaAcceptedAt: string | null;
  npiNumber: string | null; riskScore: number | null; trustTier: string | null;
  assignedReviewerId: string | null; firstDispatchedAt: string | null; lastDispatchedAt: string | null;
}
interface OrgListResponse { orgs: OrgRow[]; nextCursor: string | null; hasMore: boolean; }
interface ActivationFunnel {
  signedUp: number; approved: number; hasDepot: number;
  hasDriver: number; hasPlan: number; hasDispatched: number;
}
interface Stats {
  totalOrgs: number; activeOrgs: number; totalDrivers: number;
  totalStops30d: number; totalStopsAllTime: number; revenueEstimate: number;
  topOrgs: { orgId: string; orgName: string; stops30d: number }[];
  activationFunnel?: ActivationFunnel;
}
// P-ML21: magic link funnel metrics
interface MagicLinkFunnel {
  funnel: { sent: number; clicked: number; confirmed: number; sentToClickedRate: number | null; clickedToConfirmedRate: number | null; sentToConfirmedRate: number | null };
  latency: { p50SendClickMs: number | null; p95SendClickMs: number | null; p50SendConfirmMs: number | null; p95SendConfirmMs: number | null };
  byProvider: { provider: string; sent: number; clicked: number; confirmed: number; confirmRate: number | null }[];
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
  const [funnel, setFunnel] = useState<MagicLinkFunnel | null>(null);
  // P-DEL24: latest postmaster spam rate entries from adminAuditLogs
  const [spamRates, setSpamRates] = useState<Array<{ domain: string; rate: string; severity: string; date: string }>>([]);
  // P-DEL27: latest TLS-RPT report entry from adminAuditLogs
  const [tlsHealth, setTlsHealth] = useState<{ failures: number; success: number; action: string; date: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [orgsNextCursor, setOrgsNextCursor] = useState<string | null>(null);
  const [orgsHasMore, setOrgsHasMore] = useState(false);
  const [orgsLoadingMore, setOrgsLoadingMore] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', timezone: 'America/New_York', adminName: '', adminEmail: '', adminPassword: '' });
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState('');
  // P-RBAC38: permission drift report
  const [drift, setDrift] = useState<{ count: number; drifts: Array<{ orgId: string; orgName: string; role: string; addedPerms: string[]; removedPerms: string[] }> } | null>(null);
  // P-RBAC39: CSV export state
  const [permExporting, setPermExporting] = useState(false);

  useEffect(() => {
    if (!user || user.role !== 'super_admin') { router.replace('/dashboard'); return; }
    load();
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const [s, o, f, rbacAudit, tlsAudit, driftData] = await Promise.all([
        api.get<Stats>('/admin/stats'),
        api.get<OrgListResponse>('/admin/orgs'),
        api.get<MagicLinkFunnel>('/admin/magic-link/funnel').catch(() => null),
        api.get<{ events: Array<{ action: string; metadata: Record<string, string>; createdAt: string }> }>(
          '/admin/audit-log?eventTypes=postmaster_spam_rate_alert,postmaster_spam_rate_ok&limit=20'
        ).catch(() => null),
        // P-DEL27: TLS-RPT health — latest report entry
        api.get<{ events: Array<{ action: string; metadata: Record<string, unknown>; createdAt: string }> }>(
          '/admin/audit-log?eventTypes=tls_rpt_failure,tls_rpt_clean&limit=1'
        ).catch(() => null),
        // P-RBAC38: live permission drift report
        api.get<{ count: number; drifts: Array<{ orgId: string; orgName: string; role: string; addedPerms: string[]; removedPerms: string[] }> }>(
          '/admin/rbac-audit/drift'
        ).catch(() => null),
      ]);
      setStats(s); setOrgs(o.orgs); setOrgsNextCursor(o.nextCursor); setOrgsHasMore(o.hasMore); setFunnel(f);
      if (driftData) setDrift(driftData);
      // P-DEL27: parse latest TLS-RPT report for health indicator
      if (tlsAudit?.events?.length) {
        const e = tlsAudit.events[0];
        const m = e.metadata as Record<string, unknown>;
        setTlsHealth({
          failures: Number(m.totalFailures ?? 0),
          success: Number(m.totalSuccessful ?? 0),
          action: e.action,
          date: new Date(e.createdAt).toLocaleDateString(),
        });
      }
      // Build latest entry per domain from audit log
      if (rbacAudit?.events) {
        const byDomain = new Map<string, { domain: string; rate: string; severity: string; date: string }>();
        for (const e of rbacAudit.events) {
          const m = e.metadata as Record<string, string>;
          if (m?.domain && !byDomain.has(m.domain)) {
            byDomain.set(m.domain, { domain: m.domain, rate: m.rate ?? '—', severity: m.severity ?? 'ok', date: m.date ?? '' });
          }
        }
        setSpamRates([...byDomain.values()]);
      }
    } finally { setLoading(false); }
  };

  // P-RBAC31: start impersonation — stores orgId in sessionStorage and api module header
  const impersonate = async (orgId: string, orgName: string) => {
    const data = await api.post<{ orgId: string; orgName: string }>(`/admin/impersonate/${orgId}`, {});
    const impState = { orgId: data.orgId, orgName: data.orgName };
    sessionStorage.setItem('mdrx_impersonate', JSON.stringify(impState));
    setImpersonateOrgId(data.orgId);
    // Navigate to that org's dashboard
    router.push('/dashboard');
  };

  const changePlan = async (orgId: string, plan: string) => {
    await api.patch(`/admin/orgs/${orgId}/plan`, { plan });
    setOrgs(prev => prev.map(o => o.id === orgId ? { ...o, billingPlan: plan } : o));
  };

  const changeBaa = async (orgId: string, status: string) => {
    await api.patch(`/admin/orgs/${orgId}/baa`, { status });
    // Reflect BAA signed status locally via baaAcceptedAt field
    setOrgs(prev => prev.map(o => o.id === orgId ? { ...o, baaAcceptedAt: status === 'signed' ? new Date().toISOString() : null } : o));
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

  // P-PERF16: load next page of orgs via keyset cursor
  const loadMoreOrgs = async () => {
    if (!orgsNextCursor || orgsLoadingMore) return;
    setOrgsLoadingMore(true);
    try {
      const more = await api.get<OrgListResponse>(`/admin/orgs?cursor=${orgsNextCursor}`);
      setOrgs(prev => [...prev, ...more.orgs]);
      setOrgsNextCursor(more.nextCursor);
      setOrgsHasMore(more.hasMore);
    } finally { setOrgsLoadingMore(false); }
  };

  // P-RBAC39: download permission history CSV — HIPAA §164.312(b) audit artifact
  const exportPermHistory = async () => {
    if (permExporting) return;
    setPermExporting(true);
    try {
      const backendUrl = process.env.NEXT_PUBLIC_API_URL ?? 'https://mydashrx-backend.onrender.com/api/v1';
      const token = getAccessToken() ?? '';
      const res = await fetch(`${backendUrl}/admin/rbac-audit/permissions/export`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `permission-history-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
    } catch { /* silent — user will see no download */ }
    finally { setPermExporting(false); }
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
          <div className="flex items-center gap-2">
            {/* P-RBAC39: permission history CSV export — HIPAA §164.312(b) evidence artifact */}
            <button
              onClick={exportPermHistory}
              disabled={permExporting}
              title="Export permission change history (HIPAA §164.312(b))"
              className="flex items-center gap-1.5 px-3 py-2 bg-white border border-purple-200 text-purple-700 rounded-lg text-sm font-medium hover:bg-purple-50 transition-colors disabled:opacity-50"
            >
              <Download size={14} /> {permExporting ? 'Exporting…' : 'Perm History'}
            </button>
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 transition-colors"
            >
              <Plus size={15} /> Create Org
            </button>
          </div>
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

      {/* P-ML21: Delivery Health card */}
      {funnel && (
        <div className="px-6 py-3 border-b border-purple-100 bg-white/60 shrink-0">
          <div className="flex items-center gap-2 mb-3">
            <Mail size={14} className="text-purple-500" />
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Magic Link Delivery Health (30d)</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-purple-50 rounded-lg px-4 py-3">
              <p className="text-xs text-gray-400 mb-1">Confirmation Rate</p>
              <p className="text-lg font-bold text-gray-900">
                {funnel.funnel.sentToConfirmedRate != null ? `${funnel.funnel.sentToConfirmedRate}%` : '—'}
              </p>
              <p className="text-xs text-gray-400">{funnel.funnel.sent} sent · {funnel.funnel.confirmed} confirmed</p>
            </div>
            <div className="bg-purple-50 rounded-lg px-4 py-3">
              <p className="text-xs text-gray-400 mb-1">p50 Click Latency</p>
              <p className="text-lg font-bold text-gray-900">
                {funnel.latency.p50SendClickMs != null ? `${(funnel.latency.p50SendClickMs / 1000).toFixed(1)}s` : '—'}
              </p>
              <p className="text-xs text-gray-400">p95: {funnel.latency.p95SendClickMs != null ? `${(funnel.latency.p95SendClickMs / 1000).toFixed(0)}s` : '—'}</p>
            </div>
            <div className="bg-purple-50 rounded-lg px-4 py-3">
              <p className="text-xs text-gray-400 mb-1">Sent → Clicked</p>
              <p className="text-lg font-bold text-gray-900">
                {funnel.funnel.sentToClickedRate != null ? `${funnel.funnel.sentToClickedRate}%` : '—'}
              </p>
              <p className="text-xs text-gray-400">{funnel.funnel.clicked} clicked</p>
            </div>
            <div className="bg-purple-50 rounded-lg px-4 py-3">
              <p className="text-xs text-gray-400 mb-2">By Provider</p>
              {funnel.byProvider.slice(0, 3).map(p => (
                <div key={p.provider} className="flex items-center justify-between text-xs mb-1">
                  <span className="text-gray-600 capitalize">{p.provider}</span>
                  <span className={`font-medium ${(p.confirmRate ?? 0) >= 70 ? 'text-green-600' : (p.confirmRate ?? 0) >= 40 ? 'text-amber-600' : 'text-red-500'}`}>
                    {p.confirmRate != null ? `${p.confirmRate}%` : '—'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* P-ONB44: Activation funnel step drop-off */}
      {stats?.activationFunnel && (() => {
        const f = stats.activationFunnel!;
        const base = f.signedUp || 1;
        const steps = [
          { label: 'Signed Up', count: f.signedUp },
          { label: 'Approved', count: f.approved },
          { label: 'Depot Added', count: f.hasDepot },
          { label: 'Driver Added', count: f.hasDriver },
          { label: 'Plan Created', count: f.hasPlan },
          { label: 'First Dispatch', count: f.hasDispatched },
        ];
        return (
          <div className="px-6 py-3 border-b border-purple-100 bg-white/60 shrink-0">
            <div className="flex items-center gap-2 mb-3">
              <Activity size={14} className="text-purple-500" />
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Activation Funnel</span>
            </div>
            <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
              {steps.map(({ label, count }) => {
                const pct = Math.round((count / base) * 100);
                return (
                  <div key={label} className="bg-purple-50 rounded-lg px-3 py-3">
                    <p className="text-xs text-gray-400 mb-1 truncate">{label}</p>
                    <p className="text-lg font-bold text-gray-900">{count}</p>
                    <div className="w-full bg-purple-100 rounded-full h-1.5 mt-2">
                      <div className="bg-purple-500 h-1.5 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="text-xs text-purple-600 mt-1 font-medium">{pct}%</p>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* P-DEL24: Email Spam Rate card */}
      {spamRates.length > 0 && (
        <div className="px-6 py-3 border-b border-purple-100 bg-white/60 shrink-0">
          <div className="flex items-center gap-2 mb-3">
            <Mail size={14} className="text-purple-500" />
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Email Spam Rate (Google Postmaster)</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {spamRates.map(sr => {
              const rateNum = parseFloat(sr.rate);
              const color = sr.severity === 'critical' ? 'text-red-600' : sr.severity === 'warn' ? 'text-amber-600' : 'text-green-600';
              const bg = sr.severity === 'critical' ? 'bg-red-50' : sr.severity === 'warn' ? 'bg-amber-50' : 'bg-purple-50';
              return (
                <div key={sr.domain} className={`${bg} rounded-lg px-4 py-3`}>
                  <p className="text-xs text-gray-400 mb-1 truncate">{sr.domain}</p>
                  <p className={`text-lg font-bold ${color}`}>
                    {isNaN(rateNum) ? '—' : `${rateNum}%`}
                  </p>
                  <p className="text-xs text-gray-400">
                    {sr.severity === 'critical' ? '⚠ CRITICAL — action required' : sr.severity === 'warn' ? '⚠ Warning — monitor closely' : 'OK'} · {sr.date}
                  </p>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-gray-400 mt-2">Thresholds: warn ≥0.08% · critical ≥0.15% · Gmail hard block 0.30%</p>
        </div>
      )}

      {/* P-DEL27: TLS Delivery Health card — RFC 8460 TLS-RPT report summary */}
      {tlsHealth && (
        <div className="px-6 py-3 border-b border-purple-100 bg-white/60 shrink-0">
          <div className="flex items-center gap-2 mb-3">
            <Mail size={14} className="text-purple-500" />
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">TLS Delivery Health (TLS-RPT)</span>
          </div>
          <div className="flex items-center gap-4">
            <div className={`rounded-lg px-4 py-3 ${tlsHealth.action === 'tls_rpt_failure' ? 'bg-red-50' : 'bg-green-50'}`}>
              <p className="text-xs text-gray-400 mb-1">Latest Report — {tlsHealth.date}</p>
              <p className={`text-lg font-bold ${tlsHealth.action === 'tls_rpt_failure' ? 'text-red-600' : 'text-green-600'}`}>
                {tlsHealth.action === 'tls_rpt_failure' ? `${tlsHealth.failures} TLS failure${tlsHealth.failures !== 1 ? 's' : ''}` : 'Clean — no TLS failures'}
              </p>
              <p className="text-xs text-gray-400">{tlsHealth.success} successful sessions</p>
            </div>
            <p className="text-xs text-gray-400 max-w-xs">
              TLS-RPT reports arrive via <code className="bg-gray-100 px-1 rounded">_smtp._tls.mydashrx.com</code> → rua= endpoint.
              {tlsHealth.action === 'tls_rpt_failure' && ' Investigate failure details in the audit log.'}
            </p>
          </div>
        </div>
      )}

      {/* P-RBAC38: Permission Drift card — orgs whose role templates diverge from platform defaults */}
      {drift && drift.count > 0 && (
        <div className="px-6 py-3 border-b border-purple-100 bg-white/60 shrink-0">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={14} className="text-amber-500" />
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Permission Drift — {drift.count} org-role pair{drift.count !== 1 ? 's' : ''} diverged from platform defaults
            </span>
          </div>
          <div className="space-y-1.5 max-h-48 overflow-auto">
            {drift.drifts.map((d, i) => (
              <div key={i} className="flex items-center gap-3 text-xs bg-amber-50 rounded-lg px-3 py-2">
                <span className="font-medium text-gray-900 w-40 truncate">{d.orgName}</span>
                <span className="text-gray-500 w-28 truncate">{d.role}</span>
                {d.addedPerms.length > 0 && (
                  <span className="text-red-600 font-medium">+{d.addedPerms.length} elevated: {d.addedPerms.slice(0, 2).join(', ')}{d.addedPerms.length > 2 ? `…` : ''}</span>
                )}
                {d.removedPerms.length > 0 && (
                  <span className="text-amber-600">-{d.removedPerms.length} removed</span>
                )}
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-2">Refresh to re-run live drift check. Use RBAC admin to propagate fixes.</p>
        </div>
      )}

      {/* Orgs table */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {loading ? (
          <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-14 bg-white rounded-xl border border-purple-100 animate-pulse" />)}</div>
        ) : (
          <div className="bg-white rounded-xl border border-purple-100 overflow-hidden">
            {/* P-A11Y14: table caption + scope=col (WCAG 1.3.1 Level A) */}
            <table className="w-full text-sm">
              <caption className="sr-only">Organizations — plan, BAA, onboarding step, SLA status, and actions</caption>
              <thead>
                <tr className="bg-purple-50/60 border-b border-purple-100">
                  {['Organization', 'Plan', 'BAA', 'Step', 'Status', 'Created', 'Actions'].map(h => (
                    <th key={h} scope="col" className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
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
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${org.baaAcceptedAt ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                        {org.baaAcceptedAt ? 'signed' : 'pending'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{org.onboardingStep ?? '—'}</td>
                    <td className="px-4 py-3">
                      {org.slaBreachedAt
                        ? <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">SLA BREACHED</span>
                        : org.pendingApproval
                          ? <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 font-medium">Pending</span>
                          : org.approvedAt
                            ? <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">Approved</span>
                            : <span className="text-xs text-gray-400">—</span>
                      }
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">
                      {new Date(org.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <select
                          aria-label={`Billing plan for ${org.name}`}
                          value={org.billingPlan}
                          onChange={e => changePlan(org.id, e.target.value)}
                          className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-purple-200 bg-white"
                        >
                          {['starter','growth','pro','enterprise'].map(p => (
                            <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                          ))}
                        </select>
                        {/* P-RBAC31: impersonation button */}
                        <button
                          onClick={() => impersonate(org.id, org.name)}
                          title={`Impersonate ${org.name}`}
                          className="flex items-center gap-1 px-2 py-1.5 text-xs bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 rounded-lg transition-colors"
                        >
                          <UserCheck size={12} /> View as
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {orgs.length === 0 && (
              <div className="text-center py-12 text-gray-400 text-sm">No organizations found</div>
            )}
            {/* P-PERF16: keyset pagination — load more button */}
            {orgsHasMore && (
              <div className="px-4 py-3 border-t border-purple-100 flex justify-center">
                <button
                  onClick={loadMoreOrgs}
                  disabled={orgsLoadingMore}
                  className="text-xs text-purple-600 hover:text-purple-800 font-medium disabled:opacity-50"
                >
                  {orgsLoadingMore ? 'Loading…' : 'Load more organizations'}
                </button>
              </div>
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
                <label htmlFor="create-org-timezone" className="block text-xs font-medium text-gray-500 mb-1">Timezone</label>
                <select id="create-org-timezone" value={createForm.timezone} onChange={e => setCreateForm(f => ({ ...f, timezone: e.target.value }))}
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
