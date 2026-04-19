'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { ChevronLeft, Flame, Star, TrendingUp, Clock, CheckCircle2, AlertCircle } from 'lucide-react';

interface DriverPerf {
  completionRate: number | null;
  onTimeRate: number | null;
  avgMinutes: number | null;
  streak: number;
  tier: 'bronze' | 'silver' | 'gold' | 'platinum';
  terminal: number;
  completed: number;
}

const TIER_CONFIG = {
  bronze:   { label: 'Bronze',   color: 'text-amber-700',  bg: 'bg-amber-50',   border: 'border-amber-200',  bar: '#b45309' },
  silver:   { label: 'Silver',   color: 'text-slate-600',  bg: 'bg-slate-50',   border: 'border-slate-200',  bar: '#64748b' },
  gold:     { label: 'Gold',     color: 'text-yellow-600', bg: 'bg-yellow-50',  border: 'border-yellow-200', bar: '#d97706' },
  platinum: { label: 'Platinum', color: 'text-indigo-600', bg: 'bg-indigo-50',  border: 'border-indigo-200', bar: '#4f46e5' },
};

function RingProgress({ pct, color, size = 80 }: { pct: number; color: string; size?: number }) {
  const r = (size - 10) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (Math.min(pct, 100) / 100) * circ;
  return (
    <svg width={size} height={size} className="shrink-0">
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#f3f4f6" strokeWidth={10} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={10}
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        transform={`rotate(-90 ${size/2} ${size/2})`} />
    </svg>
  );
}

export default function DriverPerformancePage() {
  const router = useRouter();
  const [perf, setPerf] = useState<DriverPerf | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<DriverPerf>('/driver/me/performance')
      .then(setPerf)
      .catch(() => setError('Could not load performance data'))
      .finally(() => setLoading(false));
  }, []);

  const tier = TIER_CONFIG[perf?.tier ?? 'bronze'];
  const compPct = perf?.completionRate ?? 0;
  const onTimePct = perf?.onTimeRate ?? 0;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-[#0F4C81] text-white px-5 pt-12 pb-6">
        <button onClick={() => router.back()} className="flex items-center gap-1.5 text-blue-300 text-sm mb-4 -ml-1">
          <ChevronLeft size={18} /> Back
        </button>
        <h1 className="text-2xl font-bold">My Performance</h1>
        <p className="text-blue-300 text-sm mt-1">Last 30 days</p>
      </div>

      <div className="px-4 py-5 space-y-4">
        {loading ? (
          <div className="space-y-4">
            {[1,2,3].map(i => <div key={i} className="h-28 bg-white rounded-2xl animate-pulse" />)}
          </div>
        ) : error ? (
          <div className="bg-red-50 text-red-600 rounded-2xl p-4 text-sm text-center flex items-center gap-2 justify-center">
            <AlertCircle size={16} /> {error}
          </div>
        ) : perf ? (
          <>
            {/* Tier badge */}
            <div className={`${tier.bg} border ${tier.border} rounded-2xl p-5 flex items-center gap-4`}>
              <div className={`w-14 h-14 rounded-full ${tier.bg} border-2 ${tier.border} flex items-center justify-center shrink-0`}>
                <Star size={28} className={tier.color} />
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Your Tier</p>
                <p className={`text-2xl font-bold ${tier.color}`}>{tier.label}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {perf.tier === 'platinum' ? 'Elite performer — top 5%' :
                   perf.tier === 'gold' ? 'Strong performance — 90–95% completion' :
                   perf.tier === 'silver' ? 'Good — aim for 90%+ to reach Gold' :
                   'Keep going — reach 80% to unlock Silver'}
                </p>
              </div>
            </div>

            {/* Streak */}
            <div className="bg-white rounded-2xl p-5 flex items-center gap-4 border border-gray-100 shadow-sm">
              <div className="w-14 h-14 rounded-full bg-orange-50 flex items-center justify-center shrink-0">
                <Flame size={28} className="text-orange-500" />
              </div>
              <div className="flex-1">
                <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Current Streak</p>
                <p className="text-3xl font-bold text-gray-900">{perf.streak} <span className="text-lg font-normal text-gray-500">day{perf.streak !== 1 ? 's' : ''}</span></p>
                <p className="text-xs text-gray-400 mt-0.5">Consecutive days with 100% completion</p>
              </div>
            </div>

            {/* Completion rate */}
            <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
              <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-4">Completion Rate</p>
              <div className="flex items-center gap-5">
                <div className="relative">
                  <RingProgress pct={compPct} color={compPct >= 95 ? '#10b981' : compPct >= 80 ? '#f59e0b' : '#ef4444'} />
                  <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-gray-900">
                    {perf.completionRate != null ? `${perf.completionRate}%` : '—'}
                  </span>
                </div>
                <div className="flex-1">
                  <p className="text-2xl font-bold text-gray-900">
                    {perf.completed} <span className="text-base font-normal text-gray-500">/ {perf.terminal} stops</span>
                  </p>
                  <p className="text-xs text-gray-400 mt-1">Completed vs all terminal stops</p>
                  <div className="mt-2 flex items-center gap-1.5">
                    <TrendingUp size={13} className={compPct >= 90 ? 'text-emerald-500' : 'text-amber-500'} />
                    <span className={`text-xs font-medium ${compPct >= 90 ? 'text-emerald-600' : 'text-amber-600'}`}>
                      {compPct >= 95 ? 'Excellent' : compPct >= 90 ? 'Great' : compPct >= 80 ? 'Good' : 'Needs improvement'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* On-time rate */}
            {perf.onTimeRate != null && (
              <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
                <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-4">On-Time Rate</p>
                <div className="flex items-center gap-5">
                  <div className="relative">
                    <RingProgress pct={onTimePct} color={onTimePct >= 90 ? '#10b981' : onTimePct >= 70 ? '#f59e0b' : '#ef4444'} />
                    <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-gray-900">
                      {perf.onTimeRate != null ? `${perf.onTimeRate}%` : '—'}
                    </span>
                  </div>
                  <div className="flex-1">
                    <p className="text-2xl font-bold text-gray-900">{perf.onTimeRate}%</p>
                    <p className="text-xs text-gray-400 mt-1">Deliveries within scheduled window</p>
                  </div>
                </div>
              </div>
            )}

            {/* Avg delivery time */}
            {perf.avgMinutes != null && (
              <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center shrink-0">
                  <Clock size={22} className="text-[#0F4C81]" />
                </div>
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Avg Delivery Time</p>
                  <p className="text-2xl font-bold text-gray-900">{perf.avgMinutes} <span className="text-base font-normal text-gray-500">min</span></p>
                  <p className="text-xs text-gray-400 mt-0.5">Arrived → completed per stop</p>
                </div>
              </div>
            )}

            {/* Empty state when no data */}
            {perf.terminal === 0 && (
              <div className="bg-white rounded-2xl p-8 text-center border border-gray-100 shadow-sm">
                <CheckCircle2 size={44} className="text-gray-200 mx-auto mb-3" />
                <p className="font-semibold text-gray-700">No deliveries yet</p>
                <p className="text-sm text-gray-400 mt-1">Complete your first stop to see performance stats.</p>
              </div>
            )}

            {/* Tier progress guide */}
            <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
              <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-3">Tier Thresholds</p>
              <div className="space-y-2">
                {(['platinum', 'gold', 'silver', 'bronze'] as const).map(t => {
                  const cfg = TIER_CONFIG[t];
                  const isActive = perf.tier === t;
                  return (
                    <div key={t} className={`flex items-center gap-3 px-3 py-2 rounded-lg ${isActive ? cfg.bg : ''}`}>
                      <Star size={14} className={isActive ? cfg.color : 'text-gray-300'} />
                      <span className={`text-sm font-medium ${isActive ? cfg.color : 'text-gray-400'}`}>{cfg.label}</span>
                      <span className="text-xs text-gray-400 ml-auto">
                        {t === 'platinum' ? '>95%' : t === 'gold' ? '90–95%' : t === 'silver' ? '80–90%' : '<80%'}
                      </span>
                      {isActive && <span className={`text-xs font-bold ${cfg.color}`}>YOU</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
