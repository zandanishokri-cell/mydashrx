'use client';
import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

const STORAGE_KEY = 'mydashrx_pending_checklist';

const TASKS = [
  { id: 'submitted', text: 'Application submitted', locked: true },
  { id: 'npi', text: 'Gather pharmacy NPI number and state license' },
  { id: 'staff', text: 'Prepare staff list with names and email addresses' },
  { id: 'app', text: 'Download the MyDashRx driver app' },
  { id: 'walkthrough', text: 'Watch the 3-minute setup walkthrough' },
];

export default function PendingApprovalPage() {
  const [checked, setChecked] = useState<Set<string>>(new Set(['submitted']));
  const [mounted, setMounted] = useState(false);
  const [orgStatus, setOrgStatus] = useState<{ status: string; reason?: string } | null>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed: string[] = JSON.parse(stored);
        setChecked(new Set(['submitted', ...parsed]));
      }
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
        const toStore = [...next].filter(k => k !== 'submitted');
        localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
      } catch { /* ignore */ }
      return next;
    });
  };

  const completedCount = checked.size;
  const totalCount = TASKS.length;

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
          <p className="text-gray-500 text-sm mb-3">Your pharmacy account is under review.</p>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-green-50 text-green-700 text-xs font-medium rounded-full border border-green-100">
            <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
            Typical approval: 2–4 business hours
          </div>
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

        {/* CTAs */}
        <div className="space-y-3 mb-5">
          <a
            href="mailto:onboarding@mydashrx.com?subject=MyDashRx%20Onboarding%20Call&body=Hi%2C%20I%27d%20like%20to%20schedule%20a%20call%20to%20get%20set%20up%20before%20my%20account%20goes%20live."
            className="flex items-center gap-3 p-3 bg-blue-50 rounded-xl hover:bg-blue-100 transition-colors"
          >
            <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <p className="text-xs font-semibold text-blue-800">Book a 15-min onboarding call</p>
              <p className="text-xs text-blue-600">We'll have routes, drivers & depot ready before you go live</p>
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
