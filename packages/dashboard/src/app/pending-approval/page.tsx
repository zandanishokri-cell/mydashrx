'use client';
import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';

const TASKS = [
  { id: 'submitted', text: 'Application submitted', locked: true },
  { id: 'npi', text: 'Gather pharmacy NPI number and state license' },
  { id: 'staff', text: 'Prepare staff list with names and email addresses' },
  { id: 'app', text: 'Download the MyDashRx driver app' },
  { id: 'walkthrough', text: 'Watch the 3-minute setup walkthrough' },
];

// P-CNV27: "Get ready while you wait" prep tasks
const PREP_TASKS = [
  { id: 'watch_overview', text: 'Watch the 2-min overview', href: '/help', cta: 'Watch →', ctaType: 'link' as const },
  { id: 'bookmark', text: 'Bookmark your dashboard', href: null, cta: 'Show me how', ctaType: 'bookmark' as const },
  { id: 'invite_team', text: 'Invite your team', href: '/dashboard/settings', cta: 'Invite →', ctaType: 'link' as const },
];

// P-CNV27: SVG animated progress ring
function ProgressRing({ done, total }: { done: number; total: number }) {
  const r = 22, cx = 28, cy = 28, stroke = 4;
  const circ = 2 * Math.PI * r;
  const pct = total > 0 ? done / total : 0;
  const offset = circ * (1 - pct);
  return (
    <svg width={56} height={56} className="shrink-0">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#e5e7eb" strokeWidth={stroke} />
      <circle
        cx={cx} cy={cy} r={r} fill="none"
        stroke={pct === 1 ? '#16a34a' : '#0F4C81'}
        strokeWidth={stroke}
        strokeDasharray={circ}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cy})`}
        style={{ transition: 'stroke-dashoffset 0.5s ease' }}
      />
      <text x={cx} y={cy + 5} textAnchor="middle" fontSize={11} fontWeight={600} fill={pct === 1 ? '#16a34a' : '#374151'}>
        {done}/{total}
      </text>
    </svg>
  );
}

export default function PendingApprovalPage() {
  const [checked, setChecked] = useState<Set<string>>(new Set(['submitted']));
  const [prepChecked, setPrepChecked] = useState<Set<string>>(new Set());
  const [mounted, setMounted] = useState(false);
  const [showBookmarkHelp, setShowBookmarkHelp] = useState(false);
  const [orgStatus, setOrgStatus] = useState<{ status: string; reason?: string; orgSize?: string } | null>(null);

  useEffect(() => {
    const user = getUser();
    const orgId = user?.orgId ?? 'default';
    const prepKey = `mdrx_waiting_tasks_${orgId}`;
    try {
      const stored = localStorage.getItem('mydashrx_pending_checklist');
      if (stored) setChecked(new Set(['submitted', ...(JSON.parse(stored) as string[])]));
      const prepStored = localStorage.getItem(prepKey);
      if (prepStored) setPrepChecked(new Set(JSON.parse(prepStored) as string[]));
    } catch { /* ignore */ }
    setMounted(true);
    api.get<{ status: string; reason?: string }>('/auth/org-status')
      .then(setOrgStatus)
      .catch(() => {});
  }, []);

  const toggle = (id: string) => {
    if (id === 'submitted') return;
    setChecked(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      try {
        localStorage.setItem('mydashrx_pending_checklist', JSON.stringify([...next].filter(k => k !== 'submitted')));
      } catch { /* ignore */ }
      return next;
    });
  };

  const togglePrep = (id: string) => {
    const user = getUser();
    const orgId = user?.orgId ?? 'default';
    setPrepChecked(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      try { localStorage.setItem(`mdrx_waiting_tasks_${orgId}`, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  };

  const completedCount = checked.size;
  const totalCount = TASKS.length;
  const prepDone = prepChecked.size;
  const prepTotal = PREP_TASKS.length;

  if (orgStatus?.status === 'rejected') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F7F8FC] py-8">
        <div className="w-full max-w-lg bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          <div className="text-center mb-6">
            <div className="w-14 h-14 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">Application not approved</h2>
            {orgStatus.reason && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4 text-left">
                <p className="text-sm font-semibold text-amber-900 mb-1">Reason</p>
                <p className="text-sm text-amber-800">{orgStatus.reason}</p>
              </div>
            )}
            <p className="text-sm text-gray-500">
              Questions? Contact{' '}
              <a href="mailto:support@mydashrx.com" className="text-[#0F4C81] hover:underline">support@mydashrx.com</a>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F7F8FC] py-8">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
        <div className="text-center mb-6">
          <div className="w-14 h-14 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Account pending approval</h2>
          {/* P-CNV24: orgSize-branched copy — solo = warm/personal, enterprise = SLA/call */}
          {orgStatus?.orgSize === 'enterprise' ? (
            <>
              <p className="text-gray-500 text-sm mb-3">Your enterprise account is in priority review.</p>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-50 text-blue-700 text-xs font-medium rounded-full border border-blue-100">
                <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
                Priority review — expect a call within 2 business hours
              </div>
            </>
          ) : orgStatus?.orgSize === 'solo' ? (
            <>
              <p className="text-gray-500 text-sm mb-3">We review every pharmacy personally. You&apos;ll hear from us within 24 hours.</p>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-green-50 text-green-700 text-xs font-medium rounded-full border border-green-100">
                <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                Personal review — typically within 24 hours
              </div>
            </>
          ) : (
            <>
              <p className="text-gray-500 text-sm mb-3">Your pharmacy account is under review.</p>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-green-50 text-green-700 text-xs font-medium rounded-full border border-green-100">
                <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                Typical approval: 2–4 business hours
              </div>
            </>
          )}
        </div>

        <div className="border-t border-gray-100 pt-5 mb-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700">While you wait</h3>
            {mounted && (
              <span className="text-xs text-gray-400">{completedCount}/{totalCount} done</span>
            )}
          </div>

          {/* Progress bar */}
          {mounted && (
            <div className="h-1 bg-gray-100 rounded-full mb-4 overflow-hidden">
              <div
                className="h-full bg-[#0F4C81] rounded-full transition-all duration-300"
                style={{ width: `${(completedCount / totalCount) * 100}%` }}
              />
            </div>
          )}

          <ul className="space-y-3">
            {TASKS.map(task => {
              const done = checked.has(task.id);
              return (
                <li
                  key={task.id}
                  onClick={() => toggle(task.id)}
                  className={`flex items-start gap-3 text-sm rounded-lg p-2 -mx-2 transition-colors ${task.locked ? '' : 'cursor-pointer hover:bg-gray-50'}`}
                >
                  <span className={`mt-0.5 w-4 h-4 rounded-full flex-shrink-0 flex items-center justify-center transition-colors ${done ? 'bg-green-100 text-green-600' : 'border-2 border-gray-200'}`}>
                    {done && (
                      <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </span>
                  <span className={done ? 'text-gray-400 line-through' : 'text-gray-600'}>{task.text}</span>
                </li>
              );
            })}
          </ul>
        </div>

        {/* P-CNV27: Get ready while you wait — 3 prep tasks + animated progress ring */}
        <div className="border-t border-gray-100 pt-5 mb-5">
          <div className="flex items-center gap-3 mb-3">
            {mounted && <ProgressRing done={prepDone} total={prepTotal} />}
            <div>
              <h3 className="text-sm font-semibold text-gray-700">Get ready while you wait</h3>
              <p className="text-xs text-gray-400 mt-0.5">Complete these before you go live</p>
            </div>
          </div>
          <ul className="space-y-2">
            {PREP_TASKS.map(task => {
              const done = prepChecked.has(task.id);
              return (
                <li key={task.id} className="flex items-center gap-3 text-sm">
                  <button
                    onClick={() => togglePrep(task.id)}
                    className={`w-4 h-4 rounded-full flex-shrink-0 flex items-center justify-center transition-colors ${done ? 'bg-green-100 text-green-600' : 'border-2 border-gray-200 hover:border-blue-300'}`}
                    aria-label={done ? `Uncheck ${task.text}` : `Check ${task.text}`}
                  >
                    {done && (
                      <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </button>
                  <span className={`flex-1 ${done ? 'text-gray-400 line-through' : 'text-gray-600'}`}>{task.text}</span>
                  {task.ctaType === 'link' && task.href && (
                    <a href={task.href} className="text-xs text-[#0F4C81] hover:underline font-medium">{task.cta}</a>
                  )}
                  {task.ctaType === 'bookmark' && (
                    <button
                      onClick={() => { setShowBookmarkHelp(v => !v); togglePrep(task.id); }}
                      className="text-xs text-[#0F4C81] hover:underline font-medium"
                    >{task.cta}</button>
                  )}
                </li>
              );
            })}
          </ul>
          {showBookmarkHelp && (
            <div className="mt-3 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 text-xs text-blue-800">
              <strong>How to bookmark:</strong> Press <kbd className="bg-white border border-blue-200 rounded px-1">Ctrl+D</kbd> (Windows) or <kbd className="bg-white border border-blue-200 rounded px-1">⌘+D</kbd> (Mac) to bookmark this page.
            </div>
          )}
        </div>

        {/* CTAs */}
        <div className="space-y-3 mb-5">
          {/* P-CNV24: enterprise gets phone call CTA, others get email onboarding call */}
          <a
            href={orgStatus?.orgSize === 'enterprise'
              ? "tel:+18005551234"
              : "mailto:onboarding@mydashrx.com?subject=MyDashRx%20Onboarding%20Call&body=Hi%2C%20I%27d%20like%20to%20schedule%20a%20call%20to%20get%20set%20up%20before%20my%20account%20goes%20live."
            }
            className="flex items-center gap-3 p-3 bg-blue-50 rounded-xl hover:bg-blue-100 transition-colors"
          >
            <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              {orgStatus?.orgSize === 'enterprise' ? (
                <>
                  <p className="text-xs font-semibold text-blue-800">Call our enterprise team now</p>
                  <p className="text-xs text-blue-600">A dedicated rep is ready to get your team onboarded</p>
                </>
              ) : (
                <>
                  <p className="text-xs font-semibold text-blue-800">Book a 15-min onboarding call</p>
                  <p className="text-xs text-blue-600">We&apos;ll have routes, drivers &amp; depot ready before you go live</p>
                </>
              )}
            </div>
          </a>

          <div className="flex gap-2">
            <a
              href="https://apps.apple.com/search?term=mydashrx"
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-2 p-2.5 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors text-xs text-gray-600 font-medium"
              onClick={() => toggle('app')}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>
              iOS App
            </a>
            <a
              href="https://play.google.com/store/search?q=mydashrx"
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-2 p-2.5 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors text-xs text-gray-600 font-medium"
              onClick={() => toggle('app')}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M3.18 23.76c.3.17.64.24.99.2L15.34 12 11.72 8.38 3.18 23.76zm17.45-10.4L18.1 12l2.53-1.36L18 8.32l-6.28 3.66 3.64 3.64 5.27-2.26zM3.54.04C3.24-.1 2.9-.03 2.6.14L14.28 12 2.6 23.86c.3.17.64.24.94.1L17.5 13.52 3.54.04z"/></svg>
              Android App
            </a>
          </div>
        </div>

        <div className="text-center space-y-1">
          <p className="text-xs text-gray-400">You'll receive a confirmation email when your account is activated.</p>
          <p className="text-xs text-gray-400">
            Questions? Contact{' '}
            <a href="mailto:support@mydashrx.com" className="text-[#0F4C81] hover:underline">support@mydashrx.com</a>
          </p>
        </div>
      </div>
    </div>
  );
}
