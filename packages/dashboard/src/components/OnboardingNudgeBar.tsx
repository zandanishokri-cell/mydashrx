'use client';
// P-ONB40: Amber activation nudge bar for pharmacy admins stuck >48hr post-approval
// Shows when: approvedAt > 48hr ago AND routesCreated === 0
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, X } from 'lucide-react';
import { api } from '@/lib/api';

const NUDGE_DISMISS_KEY = 'mdrx_activation_nudge_dismissed';

interface OnboardingStatus {
  hasDriver: boolean;
  routesCreated: number;
  approvedAt: string | null;
  dismissedAt?: string | null;
}

export function OnboardingNudgeBar({ orgId }: { orgId: string }) {
  const [show, setShow] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && localStorage.getItem(NUDGE_DISMISS_KEY)) {
      setDismissed(true);
      return;
    }

    api.get<OnboardingStatus>('/pharmacy/onboarding-status')
      .then(s => {
        if (!s.approvedAt) return;
        const hoursSinceApproval = (Date.now() - new Date(s.approvedAt).getTime()) / 3_600_000;
        const stuck = hoursSinceApproval > 48 && s.routesCreated === 0;
        setShow(stuck);
      })
      .catch(() => {});
  }, [orgId]);

  if (!show || dismissed) return null;

  const dismiss = () => {
    localStorage.setItem(NUDGE_DISMISS_KEY, '1');
    setDismissed(true);
  };

  return (
    <div className="bg-amber-50 border-b border-amber-200 px-4 py-2.5 flex items-center gap-2.5 text-amber-900 text-sm">
      <AlertTriangle size={15} className="shrink-0 text-amber-600" />
      <span className="flex-1 text-xs md:text-sm">
        Your account is approved but not yet active.{' '}
        <span className="font-medium">Add a driver and create your first route to start delivering.</span>
      </span>
      <div className="flex items-center gap-2 shrink-0">
        <Link
          href="/dashboard/drivers"
          className="text-xs font-semibold bg-amber-200 hover:bg-amber-300 text-amber-900 px-2.5 py-1 rounded transition-colors"
        >
          Add Driver
        </Link>
        <Link
          href="/dashboard/plans"
          className="text-xs font-semibold bg-amber-200 hover:bg-amber-300 text-amber-900 px-2.5 py-1 rounded transition-colors"
        >
          Create Route
        </Link>
        <button onClick={dismiss} className="p-1 rounded hover:bg-amber-200 text-amber-600 transition-colors">
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
