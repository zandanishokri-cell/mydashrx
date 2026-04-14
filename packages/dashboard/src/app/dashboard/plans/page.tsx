'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { Plus, Calendar } from 'lucide-react';
import type { Plan } from '@mydash-rx/shared';

export default function PlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const user = getUser();

  useEffect(() => {
    if (!user) return;
    api.get<Plan[]>(`/orgs/${user.orgId}/plans`)
      .then(setPlans)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const statusColors: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-600',
    optimized: 'bg-blue-50 text-blue-700',
    distributed: 'bg-teal-50 text-teal-700',
    completed: 'bg-green-50 text-green-700',
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900" style={{ fontFamily: 'var(--font-sora)' }}>
          Route Plans
        </h1>
        <a
          href="/dashboard/plans/new"
          className="flex items-center gap-2 bg-[#0F4C81] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#0d3d69] transition-colors"
        >
          <Plus size={14} />
          New Plan
        </a>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-white rounded-xl border border-gray-100 animate-pulse" />
          ))}
        </div>
      ) : plans.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center">
          <Calendar size={32} className="text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">No plans yet. Create your first route plan.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {plans.map((plan) => (
            <a
              key={plan.id}
              href={`/dashboard/plans/${plan.id}`}
              className="flex items-center justify-between bg-white rounded-xl border border-gray-100 px-4 py-3 hover:shadow-sm transition-shadow"
            >
              <div>
                <span className="text-sm font-medium text-gray-900">{plan.date}</span>
                <span className="text-xs text-gray-400 ml-3">{plan.totalStops ?? 0} stops</span>
              </div>
              <span className={`text-xs px-2 py-1 rounded-full font-medium ${statusColors[plan.status] ?? ''}`}>
                {plan.status}
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
