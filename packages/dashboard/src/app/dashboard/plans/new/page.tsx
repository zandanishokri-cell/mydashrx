'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { Button } from '@/components/ui/Button';
import { FormField, SelectField } from '@/components/ui/FormField';
import { ArrowLeft } from 'lucide-react';
import { localDateStr } from '@/lib/dateUtils';
import { StepCompleteModal } from '@/components/StepCompleteModal';

interface Depot { id: string; name: string; address: string; }

export default function NewPlanPage() {
  const router = useRouter();
  const [user] = useState(getUser);
  const [depots, setDepots] = useState<Depot[]>([]);
  const [depotId, setDepotId] = useState('');
  const [date, setDate] = useState(() => localDateStr());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [celebrateNewPlan, setCelebrateNewPlan] = useState<string | null>(null); // plan id after first creation
  const [planCount, setPlanCount] = useState<number | null>(null);

  useEffect(() => {
    if (!user) return;
    api.get<Depot[]>(`/orgs/${user.orgId}/depots`)
      .then((d) => { setDepots(d); if (d.length > 0) setDepotId(d[0].id); })
      .catch(() => setError('Failed to load depots'));
    // P-ONB39: track existing plan count to detect first plan creation
    api.get<{ plans: unknown[]; total?: number }>(`/orgs/${user.orgId}/plans?limit=1`)
      .then(r => setPlanCount(Array.isArray(r) ? (r as unknown[]).length : ((r as { total?: number }).total ?? 0)))
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !depotId) return;
    setSaving(true);
    setError('');
    try {
      const plan = await api.post<{ id: string }>(`/orgs/${user.orgId}/plans`, { depotId, date });
      // P-ONB39: show celebration if this is the first route plan created
      if (planCount === 0) {
        setCelebrateNewPlan(plan.id);
      } else {
        router.refresh();
        router.replace(`/dashboard/plans/${plan.id}`);
      }
    } catch {
      setError('Failed to create plan');
      setSaving(false);
    }
  };

  // P-ONB39: navigate away after celebration dismisses
  if (celebrateNewPlan) {
    return (
      <StepCompleteModal
        step="route"
        onClose={() => { router.refresh(); router.replace(`/dashboard/plans/${celebrateNewPlan}`); }}
      />
    );
  }

  return (
    <div className="p-6 max-w-lg">
      <button
        onClick={() => router.back()}
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-6 transition-colors"
      >
        <ArrowLeft size={14} /> Back
      </button>
      <h1 className="text-2xl font-bold text-gray-900 mb-6" style={{ fontFamily: 'var(--font-sora)' }}>
        New Route Plan
      </h1>
      <div className="bg-white rounded-2xl border border-gray-100 p-6">
        <form onSubmit={submit} className="space-y-4">
          <FormField
            label="Delivery Date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
          <SelectField
            label="Depot"
            value={depotId}
            onChange={(e) => setDepotId(e.target.value)}
            required
          >
            {depots.length === 0 && <option value="">Loading depots…</option>}
            {depots.map((d) => (
              <option key={d.id} value={d.id}>{d.name} — {d.address}</option>
            ))}
          </SelectField>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <div className="pt-2">
            <Button type="submit" loading={saving} disabled={!depotId}>
              Create Plan
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
