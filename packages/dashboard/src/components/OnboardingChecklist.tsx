'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { CheckCircle2, Circle, X, ChevronDown, ChevronUp } from 'lucide-react';

const DISMISS_KEY = 'mdrx_onboarding_dismissed';

interface Step {
  id: string;
  label: string;
  done: boolean;
  href?: string;
}

export function OnboardingChecklist() {
  const [steps, setSteps] = useState<Step[]>([]);
  const [dismissed, setDismissed] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const user = getUser();

  useEffect(() => {
    if (!user || !['pharmacy_admin'].includes(user.role)) return;
    if (localStorage.getItem(DISMISS_KEY)) return;
    setDismissed(false);

    const orgId = user.orgId;
    Promise.all([
      api.get<unknown[]>(`/orgs/${orgId}/depots`).catch(() => []),
      api.get<unknown[]>(`/orgs/${orgId}/drivers`).catch(() => []),
      api.get<{ stops: unknown[]; total: number }>(`/orgs/${orgId}/stops?limit=1`).catch(() => ({ stops: [], total: 0 })),
    ]).then(([depots, drivers, stopsData]) => {
      const stopsResp = stopsData as { stops: unknown[]; total: number };
      setSteps([
        { id: 'account', label: 'Account created', done: true },
        { id: 'depot', label: 'Add first depot', done: (depots as unknown[]).length > 0, href: '/dashboard/settings' },
        { id: 'driver', label: 'Add first driver', done: (drivers as unknown[]).length > 0, href: '/dashboard/settings' },
        { id: 'route', label: 'Create first route', done: stopsResp.total > 0, href: '/dashboard/stops' },
      ]);
    });
  }, []);

  if (dismissed || steps.length === 0) return null;

  const doneCount = steps.filter(s => s.done).length;
  const allDone = doneCount === steps.length;
  const progress = Math.round((doneCount / steps.length) * 100);

  if (allDone) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1');
    setDismissed(true);
  };

  return (
    <div className="mx-6 mt-4 bg-white border border-blue-100 rounded-xl shadow-sm overflow-hidden">
      <div className="px-4 py-3 flex items-center justify-between bg-blue-50/60 border-b border-blue-100">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="flex-1">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-semibold text-blue-800">Setup checklist — {doneCount}/{steps.length} done</p>
              <span className="text-xs font-medium text-blue-600">{progress}%</span>
            </div>
            <div className="h-1.5 bg-blue-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-[#0F4C81] rounded-full transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
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
      {!collapsed && (
        <div className="px-4 py-3 space-y-2">
          {steps.map(step => (
            <div key={step.id} className="flex items-center gap-2.5">
              {step.done
                ? <CheckCircle2 size={15} className="text-emerald-500 shrink-0" />
                : <Circle size={15} className="text-gray-300 shrink-0" />
              }
              {step.href && !step.done ? (
                <a href={step.href} className="text-sm text-[#0F4C81] hover:underline font-medium">
                  {step.label}
                </a>
              ) : (
                <span className={`text-sm ${step.done ? 'text-gray-400 line-through' : 'text-gray-700'}`}>
                  {step.label}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
