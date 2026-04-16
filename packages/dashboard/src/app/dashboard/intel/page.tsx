'use client';
import { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, Lightbulb, TrendingUp, Truck, Clock, BarChart2, AlertCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';

interface AnalyticsSummary {
  total: number;
  completed: number;
  successRate: number;
  onTimeRate: number | null;
  avgDeliveryTime: number | null;
  activeDriverCount?: number;
}

const competitors = [
  {
    name: 'Spoke',
    tagline: 'Delivery management for pharmacies',
    pricing: '$299–$599/mo',
    strengths: ['Established brand', 'Basic route management', 'Some pharmacy-specific features'],
    weaknesses: [
      'No built-in HIPAA compliance tools',
      'No Michigan pharmacy law compliance',
      'Expensive for independent pharmacies',
      'Limited analytics',
      'No built-in lead generation',
      'Outdated UI/UX',
      'No automated patient notifications',
    ],
    myDashRxAdvantage: "MyDashRx is 40–60% cheaper with HIPAA compliance built-in and Michigan-specific features Spoke doesn't have.",
  },
  {
    name: 'Dispatch',
    tagline: 'Last-mile delivery platform',
    pricing: '$200–$500/mo',
    strengths: ['General delivery focus', 'Real-time tracking', 'Mobile app'],
    weaknesses: [
      'Not pharmacy-specific — generic delivery platform',
      'No HIPAA compliance features',
      'No controlled substance workflows',
      'No pharmacy CRM or lead generation',
      'No Michigan compliance tooling',
      'Limited reporting for pharmacy operations',
    ],
    myDashRxAdvantage: 'Dispatch is a generic delivery tool. MyDashRx is purpose-built for pharmacy — with compliance, MAPS integration, and a lead engine that grows your business.',
  },
  {
    name: 'Manual / Paper / Phone',
    tagline: 'The status quo',
    pricing: '$0 + labor costs',
    strengths: ['No monthly fee', 'Familiar to staff'],
    weaknesses: [
      'No real-time tracking',
      'No audit trail (HIPAA risk)',
      'High labor cost and human error',
      'No data or analytics',
      'No patient notifications',
      'Impossible to scale',
      'No compliance documentation',
    ],
    myDashRxAdvantage: 'Replace paper and phone tag with a modern system. Starter plan is free — you save money immediately.',
  },
];

const featureMatrix: Array<{
  feature: string;
  myDashRx: boolean | string;
  spoke: boolean | string;
  dispatch: boolean | string;
  manual: boolean | string;
}> = [
  { feature: 'Real-time driver tracking', myDashRx: true, spoke: true, dispatch: true, manual: false },
  { feature: 'Route optimization', myDashRx: true, spoke: true, dispatch: true, manual: false },
  { feature: 'HIPAA Compliance Center', myDashRx: true, spoke: false, dispatch: false, manual: false },
  { feature: 'Michigan pharmacy law compliance', myDashRx: true, spoke: false, dispatch: false, manual: false },
  { feature: 'Controlled substance ID verification', myDashRx: true, spoke: false, dispatch: false, manual: false },
  { feature: 'Digital signature + POD', myDashRx: true, spoke: true, dispatch: true, manual: false },
  { feature: 'Automated patient SMS/email', myDashRx: true, spoke: false, dispatch: false, manual: false },
  { feature: 'Built-in lead finder CRM', myDashRx: true, spoke: false, dispatch: false, manual: false },
  { feature: 'Audit log (HIPAA-ready)', myDashRx: true, spoke: false, dispatch: false, manual: false },
  { feature: 'Analytics & reporting', myDashRx: true, spoke: true, dispatch: true, manual: false },
  { feature: 'Daily email reports', myDashRx: true, spoke: false, dispatch: false, manual: false },
  { feature: 'CSV bulk import', myDashRx: true, spoke: false, dispatch: false, manual: false },
  { feature: 'Recurring delivery scheduling', myDashRx: true, spoke: false, dispatch: false, manual: false },
  { feature: 'Pharmacist portal', myDashRx: true, spoke: false, dispatch: false, manual: false },
  { feature: 'Starter plan (free)', myDashRx: true, spoke: false, dispatch: false, manual: true },
  { feature: 'Pricing (entry)', myDashRx: '$0/mo', spoke: '$299/mo', dispatch: '$200/mo', manual: 'High labor' },
];

function FeatureCell({ value, isMdx }: { value: boolean | string; isMdx?: boolean }) {
  if (typeof value === 'string') {
    return (
      <span className={`text-sm font-semibold ${isMdx ? 'text-[#0F4C81]' : 'text-gray-600'}`}>
        {value}
      </span>
    );
  }
  if (value) {
    return <CheckCircle2 size={18} className={`mx-auto ${isMdx ? 'text-green-600' : 'text-green-500'}`} strokeWidth={isMdx ? 2.5 : 2} />;
  }
  return <XCircle size={18} className="mx-auto text-red-300" strokeWidth={1.5} />;
}

export default function IntelPage() {
  const [user] = useState(getUser);
  const [stats, setStats] = useState<AnalyticsSummary | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState(false);

  const loadStats = () => {
    if (!user) return;
    setStatsLoading(true);
    setStatsError(false);
    api.get<{ summary: AnalyticsSummary; driverStats: { total: number }[] }>(`/orgs/${user.orgId}/analytics`)
      .then(res => setStats({ ...res.summary, activeDriverCount: (res.driverStats ?? []).filter(d => d.total > 0).length }))
      .catch(() => setStatsError(true))
      .finally(() => setStatsLoading(false));
  };

  useEffect(() => { loadStats(); }, [user]); // eslint-disable-line

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Competitive Intelligence</h1>
        <p className="text-gray-500 mt-1">Know your market. Win every deal.</p>
        <p className="text-xs text-gray-400 mt-1">Last reviewed: April 2026</p>
      </div>

      {/* Summary banner */}
      <div className="bg-[#0F4C81] text-white rounded-xl px-6 py-4 flex items-center gap-3">
        <CheckCircle2 size={22} className="shrink-0 text-blue-200" />
        <p className="text-sm font-medium">
          MyDashRx has more compliance features than any competitor — at a fraction of the price.
        </p>
      </div>

      {/* Your Numbers — live 7-day platform metrics */}
      <div>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Your Numbers (last 7 days)</h2>
        {statsError ? (
          <div className="flex items-center gap-2 text-sm text-amber-600 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
            <AlertCircle size={14} /> Performance data unavailable
            <button onClick={loadStats} className="ml-auto text-xs font-medium text-amber-700 hover:underline">Retry</button>
          </div>
        ) : statsLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[0,1,2,3].map(i => <div key={i} className="bg-white border border-gray-100 rounded-xl p-4 h-20 animate-pulse" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { icon: Truck, label: 'Deliveries', value: stats ? String(stats.total) : '—', sub: stats ? `${stats.completed} completed` : '' },
              { icon: BarChart2, label: 'Success Rate', value: stats ? `${stats.successRate}%` : '—', sub: stats?.successRate != null && stats.total >= 10 ? (stats.successRate >= 90 ? '✓ Excellent' : 'Below target') : '' },
              { icon: Clock, label: 'Avg Delivery', value: stats?.avgDeliveryTime != null ? `${stats.avgDeliveryTime}m` : '—', sub: 'Avg stop duration' },
              { icon: TrendingUp, label: 'On-Time Rate', value: stats?.onTimeRate != null ? `${stats.onTimeRate}%` : '—', sub: stats?.onTimeRate != null && stats.onTimeRate >= 90 ? '✓ Top tier' : stats?.onTimeRate != null ? 'Needs attention' : 'No window data' },
            ].map(({ icon: Icon, label, value, sub }) => (
              <div key={label} className="bg-white border border-gray-100 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Icon size={14} className="text-[#0F4C81]" />
                  <span className="text-xs font-medium text-gray-500">{label}</span>
                </div>
                <p className="text-2xl font-bold text-gray-900">{value}</p>
                {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Competitor cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {competitors.map(c => (
          <div key={c.name} className="border border-gray-100 rounded-xl p-6 bg-white space-y-4">
            <div>
              <h2 className="text-lg font-bold text-gray-900">{c.name}</h2>
              <p className="text-xs text-gray-400 mt-0.5">{c.tagline}</p>
              <span className="inline-block mt-2 text-xs font-semibold bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                {c.pricing}
              </span>
            </div>

            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Strengths</p>
              <ul className="space-y-1">
                {c.strengths.map(s => (
                  <li key={s} className="flex items-start gap-1.5 text-sm text-gray-700">
                    <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-green-500" />
                    {s}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Weaknesses</p>
              <ul className="space-y-1">
                {c.weaknesses.map(w => (
                  <li key={w} className="flex items-start gap-1.5 text-sm text-gray-700">
                    <XCircle size={14} className="mt-0.5 shrink-0 text-red-400" />
                    {w}
                  </li>
                ))}
              </ul>
            </div>

            <div className="bg-blue-50 border border-blue-100 rounded-lg p-3">
              <p className="text-xs font-semibold text-[#0F4C81] mb-1">Our Advantage</p>
              <p className="text-xs text-blue-900 leading-relaxed">{c.myDashRxAdvantage}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Feature matrix */}
      <div>
        <h2 className="text-lg font-bold text-gray-900 mb-4">Feature Comparison</h2>
        <div className="border border-gray-100 rounded-xl overflow-hidden overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-1/2">
                  Feature
                </th>
                <th className="text-center px-3 py-3 bg-blue-50/70 text-xs font-bold text-[#0F4C81] uppercase tracking-wide">
                  MyDashRx
                </th>
                <th className="text-center px-3 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Spoke
                </th>
                <th className="text-center px-3 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Dispatch
                </th>
                <th className="text-center px-3 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Manual
                </th>
              </tr>
            </thead>
            <tbody>
              {featureMatrix.map((row, i) => (
                <tr key={row.feature} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                  <td className="px-4 py-3 text-gray-700 font-medium">{row.feature}</td>
                  <td className="px-3 py-3 text-center bg-blue-50/50">
                    <FeatureCell value={row.myDashRx} isMdx />
                  </td>
                  <td className="px-3 py-3 text-center">
                    <FeatureCell value={row.spoke} />
                  </td>
                  <td className="px-3 py-3 text-center">
                    <FeatureCell value={row.dispatch} />
                  </td>
                  <td className="px-3 py-3 text-center">
                    <FeatureCell value={row.manual} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Sales tip */}
      <div className="bg-amber-50 border border-amber-100 rounded-xl p-5 flex gap-3">
        <Lightbulb size={20} className="text-amber-500 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-amber-900">Use this in sales calls</p>
          <p className="text-sm text-amber-800 mt-1 leading-relaxed">
            Lead with compliance — it's your strongest differentiator. Ask prospects: "Does your current solution help you stay compliant with Michigan pharmacy delivery law?" Neither Spoke nor Dispatch can say yes. Then show them the pricing comparison.
          </p>
        </div>
      </div>
    </div>
  );
}
