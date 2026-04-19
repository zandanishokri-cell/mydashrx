'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { CheckCircle2, Circle, X, ChevronDown, ChevronUp, ArrowRight, Clock } from 'lucide-react';

const DISMISS_KEY = 'mdrx_onboarding_dismissed';

interface StepDef {
  id: string;
  label: string;
  description: string;
  time: string;
  cta: string;
  href: string;
}

const STEP_DEFS: StepDef[] = [
  {
    id: 'depot',
    label: 'Add your depot',
    description: 'Set your pharmacy location — drivers use this as their dispatch hub.',
    time: '~2 min',
    cta: 'Add depot →',
    href: '/dashboard/settings',
  },
  {
    id: 'driver',
    label: 'Invite your first driver',
    description: 'Add a driver and send them a magic-link invite to download the app.',
    time: '~3 min',
    cta: 'Add driver →',
    href: '/dashboard/drivers',
  },
  {
    id: 'plan',
    label: 'Create a delivery route',
    description: 'Build a delivery plan with stops and assign it to a driver.',
    time: '~5 min',
    cta: 'Create route →',
    href: '/dashboard/plans',
  },
  {
    id: 'delivery',
    label: 'Complete your first delivery',
    description: "Dispatch the route and track your driver's first real delivery.",
    time: '~10 min',
    cta: 'View stops →',
    href: '/dashboard/stops',
  },
];

interface StatusMap { hasDepot: boolean; hasDriver: boolean; hasPlan: boolean; hasCompletedStop: boolean; dismissedAt?: string | null; }

// P-ONB45: forceExpanded — bypasses dismiss guard when opened via Setup Guide nav link
export function OnboardingChecklist({ forceExpanded }: { forceExpanded?: boolean } = {}) {
  const [status, setStatus] = useState<StatusMap | null>(null);
  const [dismissed, setDismissed] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const user = getUser();

  useEffect(() => {
    if (!user || user.role !== 'pharmacy_admin') return;

    api.get<StatusMap>('/pharmacy/onboarding-status')
      .then(s => {
        setStatus(s);
        // P-ONB42: server state wins over localStorage — cross-device dismiss sync
        if (!forceExpanded) {
          if (s.dismissedAt) { setDismissed(true); return; }
          if (localStorage.getItem(DISMISS_KEY)) { setDismissed(true); return; }
        }
        setDismissed(false);
      })
      .catch(() => {});
  }, [forceExpanded]);

  if (dismissed || !status) return null;

  const stepStates = [
    { ...STEP_DEFS[0], done: status.hasDepot },
    { ...STEP_DEFS[1], done: status.hasDriver },
    { ...STEP_DEFS[2], done: status.hasPlan },
    { ...STEP_DEFS[3], done: status.hasCompletedStop },
  ];

  // P-ONB41: sort incomplete first, completed last
  const sorted = [
    ...stepStates.filter(s => !s.done),
    ...stepStates.filter(s => s.done),
  ];

  const doneCount = stepStates.filter(s => s.done).length;
  const allDone = doneCount === stepStates.length;
  const progress = Math.round((doneCount / stepStates.length) * 100);

  if (allDone) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1');
    setDismissed(true);
    // P-ONB42: sync dismiss to server so cross-device sessions don't trigger false nudge emails
    api.patch(`/orgs/${user!.orgId}/onboarding/progress`, { dismissed: true }).catch(() => {});
  };

  return (
    <div className="mx-6 mt-4 bg-white border border-blue-100 rounded-xl shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between bg-blue-50/60 border-b border-blue-100">
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs font-semibold text-blue-800">Setup checklist — {doneCount}/{stepStates.length} done</p>
            <span className="text-xs font-medium text-blue-600">{progress}%</span>
          </div>
          <div className="h-1.5 bg-blue-100 rounded-full overflow-hidden">
            <div className="h-full bg-[#0F4C81] rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
        </div>
        <div className="flex items-center gap-1 ml-3 shrink-0">
          <button onClick={() => setCollapsed(v => !v)} className="p-1 rounded hover:bg-blue-100 text-blue-500 transition-colors">
            {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
          <button onClick={dismiss} className="p-1 rounded hover:bg-blue-100 text-blue-400 transition-colors">
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Steps */}
      {!collapsed && (
        <div className="divide-y divide-gray-50">
          {sorted.map(step => (
            <div key={step.id} className={`px-4 py-3 flex items-start gap-3 ${step.done ? 'opacity-50' : ''}`}>
              <div className="mt-0.5 shrink-0">
                {step.done
                  ? <CheckCircle2 size={16} className="text-emerald-500" />
                  : <Circle size={16} className="text-gray-300" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${step.done ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
                  {step.label}
                </p>
                {!step.done && (
                  <>
                    <p className="text-xs text-gray-500 mt-0.5">{step.description}</p>
                    <div className="flex items-center gap-3 mt-2">
                      <span className="flex items-center gap-1 text-xs text-gray-400">
                        <Clock size={11} /> {step.time}
                      </span>
                      <a
                        href={step.href}
                        className="flex items-center gap-1 text-xs font-medium text-[#0F4C81] hover:underline"
                      >
                        {step.cta} <ArrowRight size={11} />
                      </a>
                    </div>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
