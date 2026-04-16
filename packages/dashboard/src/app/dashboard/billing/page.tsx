'use client';
import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { CreditCard, CheckCircle2, Zap, Building2, TrendingUp, AlertCircle, Check, X } from 'lucide-react';

interface PlanDetails {
  name: string;
  price: number | null;
  stopLimit: number | null;
  driverLimit: number | null;
  features: string[];
}

interface BillingData {
  currentPlan: string;
  planDetails: PlanDetails;
  usage: {
    stopsThisMonth: number;
    stopLimit: number | null;
    driversActive: number;
    driverLimit: number | null;
    stopsPercent: number;
  };
  stripeCustomerId: string | null;
  subscriptionStatus: string;
}

interface PlanOption {
  key: string;
  name: string;
  price: number | null;
  stopLimit: number | null;
  driverLimit: number | null;
  features: string[];
}

const PLAN_ORDER = ['starter', 'growth', 'pro', 'enterprise'];

const planIcon = (key: string) => {
  if (key === 'starter') return <CreditCard size={18} />;
  if (key === 'growth') return <TrendingUp size={18} />;
  if (key === 'pro') return <Zap size={18} />;
  return <Building2 size={18} />;
};

const barColor = (pct: number) =>
  pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-400' : 'bg-emerald-500';

function UsageBar({ label, used, limit, pct }: { label: string; used: number; limit: number | null; pct: number }) {
  return (
    <div>
      <div className="flex justify-between items-center mb-1.5">
        <span className="text-xs font-medium text-gray-600">{label}</span>
        <span className="text-xs text-gray-500 font-mono">
          {used.toLocaleString()} / {limit ? limit.toLocaleString() : '∞'}
        </span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor(pct)}`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      <p className={`text-xs mt-1 ${pct >= 90 ? 'text-red-500' : pct >= 70 ? 'text-amber-500' : 'text-gray-400'}`}>
        {pct}% used
      </p>
    </div>
  );
}

function CircleRing({ pct, label, used, limit }: { pct: number; label: string; used: number; limit: number | null }) {
  const r = 32;
  const circ = 2 * Math.PI * r;
  const offset = circ - (Math.min(100, pct) / 100) * circ;
  const color = pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : '#10b981';

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative w-20 h-20">
        <svg className="w-20 h-20 -rotate-90" viewBox="0 0 80 80">
          <circle cx="40" cy="40" r={r} fill="none" stroke="#f3f4f6" strokeWidth="8" />
          <circle
            cx="40" cy="40" r={r} fill="none" stroke={color} strokeWidth="8"
            strokeDasharray={circ} strokeDashoffset={offset}
            strokeLinecap="round" style={{ transition: 'stroke-dashoffset 0.5s ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-sm font-bold text-gray-800">{pct}%</span>
        </div>
      </div>
      <div className="text-center">
        <p className="text-xs font-semibold text-gray-700">{label}</p>
        <p className="text-xs text-gray-400">{used} / {limit ?? '∞'}</p>
      </div>
    </div>
  );
}

export default function BillingPage() {
  const [billing, setBilling] = useState<BillingData | null>(null);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [actionError, setActionError] = useState('');
  const [loadError, setLoadError] = useState(false);
  const [showUpgradeSuccess, setShowUpgradeSuccess] = useState(
    () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('success') === '1'
  );
  const user = getUser();
  const orgId = user?.orgId;

  useEffect(() => {
    if (!orgId) return;
    setLoadError(false);
    Promise.all([
      api.get<BillingData>(`/orgs/${orgId}/billing/plan`),
      api.get<PlanOption[]>(`/orgs/${orgId}/billing/plans`),
    ])
      .then(([b, p]) => {
        setBilling(b);
        setPlans(p.sort((a, b) => PLAN_ORDER.indexOf(a.key) - PLAN_ORDER.indexOf(b.key)));
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, [orgId]);

  const handleUpgrade = async (planKey: string) => {
    if (!orgId) return;
    setUpgrading(planKey);
    try {
      const origin = window.location.origin;
      const res = await api.post<{ url?: string; error?: string; configureUrl?: string }>(
        `/orgs/${orgId}/billing/checkout`,
        { plan: planKey, successUrl: `${origin}/dashboard/billing?success=1`, cancelUrl: `${origin}/dashboard/billing` },
      );
      if (res.url) window.location.href = res.url;
      else if (res.error === 'Stripe not configured') {
        setActionError('Stripe is not configured. Add STRIPE_SECRET_KEY to enable billing.');
      }
    } catch {
      setActionError('Failed to start checkout. Please try again.');
    } finally {
      setUpgrading(null);
    }
  };

  const handlePortal = async () => {
    if (!orgId || portalLoading) return;
    setPortalLoading(true);
    setActionError('');
    try {
      const res = await api.post<{ url?: string; error?: string }>(`/orgs/${orgId}/billing/portal`, {});
      if (res.url) window.location.href = res.url;
      else if (res.error) setActionError('Billing portal is not yet configured. Please subscribe first.');
    } catch {
      setActionError('Failed to open billing portal. Please try again.');
    } finally {
      setPortalLoading(false);
    }
  };

  if (loading) return (
    <div className="p-6 space-y-4">
      {[1, 2, 3].map(i => <div key={i} className="h-32 bg-white rounded-2xl animate-pulse" />)}
    </div>
  );

  if (loadError) return (
    <div className="p-6">
      <div className="flex items-center gap-3 px-4 py-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
        <AlertCircle size={16} className="shrink-0" />
        <div className="flex-1">Failed to load billing information. Please refresh the page.</div>
        <button onClick={() => window.location.reload()} className="text-red-600 font-medium hover:underline text-xs">Refresh</button>
      </div>
    </div>
  );

  const driversPct = billing?.usage.driverLimit
    ? Math.round((billing.usage.driversActive / billing.usage.driverLimit) * 100)
    : 0;

  return (
    <div className="p-5 md:p-6 max-w-5xl mx-auto space-y-6">
      {/* Payment success banner */}
      {showUpgradeSuccess && (
        <div className="flex items-center gap-3 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-700">
          <Check size={16} className="shrink-0 text-emerald-500" />
          <span className="flex-1 font-medium">Payment successful — your plan has been upgraded!</span>
          <button onClick={() => { setShowUpgradeSuccess(false); window.history.replaceState({}, '', '/dashboard/billing'); }}
            className="text-emerald-400 hover:text-emerald-600 transition-colors">
            <X size={14} />
          </button>
        </div>
      )}
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
            <CreditCard size={18} className="text-[#0F4C81]" />
          </div>
          <div>
            <h1 className="font-bold text-gray-900 text-lg" style={{ fontFamily: 'var(--font-sora)' }}>
              Billing & Subscription
            </h1>
            <p className="text-xs text-gray-400 mt-0.5">Manage your plan and usage</p>
          </div>
        </div>
        {billing?.stripeCustomerId && (
          <button
            onClick={handlePortal}
            disabled={portalLoading}
            className="text-sm font-medium text-[#0F4C81] hover:bg-blue-50 px-4 py-2 rounded-lg transition-colors border border-blue-100 disabled:opacity-50"
          >
            {portalLoading ? 'Loading…' : 'Manage Billing'}
          </button>
        )}
      </div>

      {actionError && (
        <div className="px-4 py-2.5 bg-red-50 border border-red-100 rounded-xl text-sm text-red-600 flex items-center justify-between">
          {actionError}
          <button onClick={() => setActionError('')} className="ml-2 text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      {/* Current plan + usage */}
      {billing && (
        <div className="grid md:grid-cols-2 gap-4">
          {/* Current plan card */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-1">Current Plan</p>
                <h2 className="text-2xl font-bold text-gray-900">{billing.planDetails.name}</h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  {billing.planDetails.price != null
                    ? billing.planDetails.price === 0 ? 'Free forever' : `$${billing.planDetails.price}/month`
                    : 'Custom pricing'}
                </p>
              </div>
              <span className={`px-2.5 py-1 rounded-full text-xs font-semibold capitalize ${
                billing.subscriptionStatus === 'active' ? 'bg-emerald-50 text-emerald-700'
                : billing.subscriptionStatus === 'past_due' ? 'bg-red-50 text-red-700'
                : billing.subscriptionStatus === 'canceled' ? 'bg-gray-100 text-gray-500'
                : billing.subscriptionStatus === 'trialing' ? 'bg-blue-50 text-blue-700'
                : 'bg-gray-100 text-gray-400'
              }`}>
                {billing.subscriptionStatus === 'inactive' && billing.currentPlan === 'starter' ? 'Free' : billing.subscriptionStatus}
              </span>
            </div>
            <div className="space-y-4">
              <UsageBar
                label="Stops this month"
                used={billing.usage.stopsThisMonth}
                limit={billing.usage.stopLimit}
                pct={billing.usage.stopsPercent}
              />
              <UsageBar
                label="Active drivers"
                used={billing.usage.driversActive}
                limit={billing.usage.driverLimit}
                pct={driversPct}
              />
            </div>
            {billing.currentPlan === 'starter' && (
              <div className="mt-4 bg-blue-50 border border-blue-100 rounded-xl p-3">
                <p className="text-xs font-semibold text-[#0F4C81]">Unlock more with Growth</p>
                <p className="text-xs text-blue-600 mt-0.5">500 stops/mo, route optimization, SMS — $99/mo</p>
                <button
                  onClick={() => handleUpgrade('growth')}
                  disabled={upgrading === 'growth'}
                  className="mt-2 text-xs font-bold text-white bg-[#0F4C81] hover:bg-[#0d3d69] px-3 py-1.5 rounded-lg transition-colors disabled:opacity-60"
                >
                  {upgrading === 'growth' ? 'Loading…' : 'Upgrade to Growth →'}
                </button>
              </div>
            )}
          </div>

          {/* Usage rings */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-4">Usage Overview</p>
            <div className="flex items-center justify-around">
              <CircleRing
                pct={billing.usage.stopsPercent}
                label="Stops"
                used={billing.usage.stopsThisMonth}
                limit={billing.usage.stopLimit}
              />
              <CircleRing
                pct={driversPct}
                label="Drivers"
                used={billing.usage.driversActive}
                limit={billing.usage.driverLimit}
              />
            </div>
            <p className="text-xs text-gray-400 text-center mt-4">Usage resets on the 1st of each month</p>
          </div>
        </div>
      )}

      {/* Plans comparison table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-50">
          <h3 className="font-bold text-gray-900">Compare Plans</h3>
          <p className="text-xs text-gray-400 mt-0.5">All plans include core delivery management</p>
        </div>

        <div className="overflow-x-auto">
        {/* Plan headers */}
        <div className="grid grid-cols-4 border-b border-gray-100 min-w-[480px]">
          {plans.map(plan => {
            const isCurrent = billing?.currentPlan === plan.key;
            const isRecommended = plan.key === 'growth';
            return (
              <div
                key={plan.key}
                className={`p-4 text-center border-r last:border-r-0 border-gray-100 relative ${
                  isRecommended ? 'border-2 border-[#0F4C81] border-t-0' : ''
                }`}
              >
                {isRecommended && (
                  <span className="absolute -top-px left-1/2 -translate-x-1/2 bg-[#0F4C81] text-white text-[10px] font-bold px-2.5 py-0.5 rounded-b-lg">
                    Most Popular
                  </span>
                )}
                <div className={`flex justify-center mb-1.5 ${isRecommended ? 'text-[#0F4C81]' : 'text-gray-400'}`}>
                  {planIcon(plan.key)}
                </div>
                <p className="font-bold text-gray-900 text-sm">{plan.name}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {plan.price == null ? 'Custom' : plan.price === 0 ? 'Free' : `$${plan.price}/mo`}
                </p>
              </div>
            );
          })}
        </div>

        {/* Limit rows */}
        {[
          { label: 'Stops / mo', values: plans.map(p => p.stopLimit ? p.stopLimit.toLocaleString() : 'Unlimited') },
          { label: 'Drivers', values: plans.map(p => p.driverLimit ? p.driverLimit.toString() : 'Unlimited') },
        ].map(row => (
          <div key={row.label} className="grid grid-cols-4 border-b border-gray-50 min-w-[480px]">
            {plans.map((plan, i) => (
              <div key={plan.key} className={`p-3 text-center border-r last:border-r-0 border-gray-100 ${
                plan.key === 'growth' ? 'bg-blue-50/30' : ''
              }`}>
                <p className="text-xs font-bold text-gray-800">{row.values[i]}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">{row.label}</p>
              </div>
            ))}
          </div>
        ))}

        {/* Feature rows */}
        {Array.from({ length: Math.max(0, ...plans.map(p => p.features.length)) }, (_, i) => (
          <div key={i} className="grid grid-cols-4 border-b last:border-b-0 border-gray-50 min-w-[480px]">
            {plans.map(plan => (
              <div key={plan.key} className={`p-3 flex items-center justify-center ${
                plan.key === 'growth' ? 'bg-blue-50/30' : ''
              } border-r last:border-r-0 border-gray-100`}>
                {plan.features[i] ? (
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />
                    <span className="text-xs text-gray-600 leading-tight">{plan.features[i]}</span>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ))}

        {/* CTA row */}
        <div className="grid grid-cols-4 border-t border-gray-100 bg-gray-50/50 p-4 gap-3 min-w-[480px]">
          {plans.map(plan => {
            const isCurrent = billing?.currentPlan === plan.key;
            const isEnterprise = plan.key === 'enterprise';
            const isDowngrade = PLAN_ORDER.indexOf(plan.key) < PLAN_ORDER.indexOf(billing?.currentPlan ?? 'starter');

            if (isCurrent) return (
              <button key={plan.key} disabled
                className="w-full py-2 rounded-xl text-xs font-bold bg-gray-100 text-gray-400 border border-gray-200">
                Current Plan
              </button>
            );
            if (isEnterprise) return (
              <a key={plan.key} href="mailto:sales@mydashtrx.com"
                className="w-full py-2 rounded-xl text-xs font-bold text-center block text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 transition-colors">
                Contact Sales
              </a>
            );
            if (isDowngrade) return (
              <button key={plan.key} onClick={() => handlePortal()}
                className="w-full py-2 rounded-xl text-xs font-bold text-gray-500 bg-white border border-gray-200 hover:bg-gray-50 transition-colors">
                Downgrade
              </button>
            );
            return (
              <button key={plan.key}
                onClick={() => handleUpgrade(plan.key)}
                disabled={upgrading === plan.key}
                className={`w-full py-2 rounded-xl text-xs font-bold transition-colors disabled:opacity-60 ${
                  plan.key === 'growth'
                    ? 'bg-[#0F4C81] text-white hover:bg-[#0d3d69] shadow-md shadow-blue-900/20'
                    : 'bg-gray-800 text-white hover:bg-gray-900'
                }`}>
                {upgrading === plan.key ? 'Loading…' : 'Upgrade'}
              </button>
            );
          })}
        </div>
        </div>{/* /overflow-x-auto */}
      </div>
    </div>
  );
}
