'use client';
// P-CNV29: Re-activation banner — shows amber banner when last dispatch was >7 days ago
// Targets 62% post-first-use churn window with a low-friction CTA to create a new route
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, X } from 'lucide-react';
import { api } from '@/lib/api';

interface OnboardingStatus {
  lastDispatchedAt: string | null;
  reactivationBannerDismissedAt: string | null;
}

export function ReactivationBanner({ orgId }: { orgId: string }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    api.get<OnboardingStatus>('/pharmacy/onboarding-status')
      .then(s => {
        if (!s.lastDispatchedAt) return;
        const daysSinceLast = (Date.now() - new Date(s.lastDispatchedAt).getTime()) / 86_400_000;
        if (daysSinceLast < 7) return;
        // Show if dismissed before last dispatch or never dismissed
        const dismissedBefore = s.reactivationBannerDismissedAt
          ? new Date(s.reactivationBannerDismissedAt) < new Date(s.lastDispatchedAt)
          : true;
        setShow(dismissedBefore);
      })
      .catch(() => {});
  }, [orgId]);

  const dismiss = () => {
    setShow(false);
    api.patch('/pharmacy/reactivation-banner/dismiss', {}).catch(() => {});
  };

  if (!show) return null;

  return (
    // P-A11Y28: role=status + aria-live=polite so SR announces banner when it appears (WCAG 4.1.3)
    <div role="status" aria-live="polite" className="bg-amber-50 border-b border-amber-200 px-4 py-2.5 flex items-center gap-2.5 text-amber-900 text-sm">
      <AlertTriangle size={15} className="shrink-0 text-amber-600" />
      <span className="flex-1 text-xs md:text-sm">
        Your last delivery was over 7 days ago — ready to dispatch again?{' '}
      </span>
      <Link
        href="/dashboard/plans/new"
        className="shrink-0 text-xs font-semibold bg-amber-200 hover:bg-amber-300 text-amber-900 px-2.5 py-1 rounded-lg transition-colors"
      >
        Create Route →
      </Link>
      <button
        onClick={dismiss}
        className="shrink-0 p-1 rounded hover:bg-amber-200 transition-colors"
        aria-label="Dismiss re-activation banner"
      >
        <X size={14} className="text-amber-600" />
      </button>
    </div>
  );
}
