'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { BarChart2, CheckCircle2, AlertTriangle, Clock } from 'lucide-react';

interface AnalyticsData {
  today: { dispensed: number; controlled: number; pending: number };
  week: { dispensed: number; controlled: number; pending: number };
}

function StatRow({ label, value, icon: Icon, color }: { label: string; value: number; icon: React.ElementType; color: string }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-gray-50 last:border-0">
      <div className="flex items-center gap-2.5">
        <Icon size={15} className={color} />
        <span className="text-sm text-gray-700">{label}</span>
      </div>
      <span className="text-sm font-bold text-gray-900">{value}</span>
    </div>
  );
}

export default function PharmacistAnalyticsPage() {
  const user = getUser();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    api.get<AnalyticsData>(`/orgs/${user.orgId}/pharmacist/analytics`)
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900" style={{ fontFamily: 'var(--font-sora)' }}>Analytics</h1>
        <p className="text-sm text-gray-500 mt-0.5">Dispensing activity overview</p>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[1, 2].map(i => <div key={i} className="h-40 bg-white rounded-2xl border border-gray-100 animate-pulse" />)}
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-5">
          {/* Today */}
          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <div className="flex items-center gap-2 mb-4">
              <BarChart2 size={16} className="text-emerald-600" />
              <h2 className="font-semibold text-gray-800">Today</h2>
            </div>
            <StatRow label="Dispensed" value={data?.today.dispensed ?? 0} icon={CheckCircle2} color="text-emerald-600" />
            <StatRow label="Controlled Substances" value={data?.today.controlled ?? 0} icon={AlertTriangle} color="text-amber-500" />
            <StatRow label="Pending" value={data?.today.pending ?? 0} icon={Clock} color="text-gray-400" />
          </div>

          {/* This week */}
          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <div className="flex items-center gap-2 mb-4">
              <BarChart2 size={16} className="text-emerald-600" />
              <h2 className="font-semibold text-gray-800">This Week</h2>
            </div>
            <StatRow label="Dispensed" value={data?.week.dispensed ?? 0} icon={CheckCircle2} color="text-emerald-600" />
            <StatRow label="Controlled Substances" value={data?.week.controlled ?? 0} icon={AlertTriangle} color="text-amber-500" />
            <StatRow label="Pending" value={data?.week.pending ?? 0} icon={Clock} color="text-gray-400" />
          </div>
        </div>
      )}
    </div>
  );
}
