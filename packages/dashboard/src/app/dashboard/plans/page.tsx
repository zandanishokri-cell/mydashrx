'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { Badge } from '@/components/ui/Badge';
import { DepotFilter } from '@/components/ui/DepotFilter';
import { Plus, Calendar, ChevronLeft, ChevronRight } from 'lucide-react';

interface Plan { id: string; date: string; status: string; depotId: string; }
interface Route { id: string; driverId: string; status: string; stopOrder: string[]; estimatedDuration: number | null; }
interface Driver { id: string; name: string; }

interface PlanWithMeta extends Plan {
  routes: Route[];
  stopCount: number;
  depotName?: string;
}

function getWeekRange(offset: number) {
  const now = new Date();
  const day = now.getDay(); // 0=Sun
  const monday = new Date(now);
  monday.setDate(now.getDate() - day + 1 + offset * 7);
  const days: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    days.push(d.toISOString().split('T')[0]);
  }
  return days;
}

export default function PlansPage() {
  const [plans, setPlans] = useState<PlanWithMeta[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [depotId, setDepotId] = useState('');
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const user = getUser();

  const weekDays = getWeekRange(weekOffset);
  const today = new Date().toISOString().split('T')[0];

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [allPlans, allDrivers] = await Promise.all([
        api.get<Plan[]>(`/orgs/${user.orgId}/plans`),
        api.get<Driver[]>(`/orgs/${user.orgId}/drivers`),
      ]);
      setDrivers(allDrivers);

      const withMeta = await Promise.all(
        allPlans.map(async plan => {
          const routes = await api.get<Route[]>(`/plans/${plan.id}/routes`);
          const stopCount = routes.reduce((s, r) => s + (r.stopOrder?.length ?? 0), 0);
          return { ...plan, routes, stopCount };
        })
      );
      setPlans(withMeta);
    } catch { setPlans([]); }
    finally { setLoading(false); }
  }, [user, depotId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const filtered = plans.filter(p => {
    if (depotId && p.depotId !== depotId) return false;
    return true;
  });

  const forDate = filtered.filter(p => p.date === selectedDate);
  const dateCounts: Record<string, number> = {};
  for (const p of filtered) {
    dateCounts[p.date] = (dateCounts[p.date] ?? 0) + 1;
  }

  const weekLabel = () => {
    const start = new Date(weekDays[0] + 'T00:00:00');
    const end = new Date(weekDays[6] + 'T00:00:00');
    if (weekOffset === 0) return "This week";
    if (weekOffset === -1) return "Last week";
    return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-bold text-gray-900" style={{ fontFamily: 'var(--font-sora)' }}>Routes</h1>
        <div className="flex items-center gap-2">
          <DepotFilter value={depotId} onChange={setDepotId} />
          <Link
            href="/dashboard/plans/new"
            className="flex items-center gap-1.5 bg-[#0F4C81] text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-[#0d3d69] transition-colors"
          >
            <Plus size={14} /> Create new route
          </Link>
        </div>
      </div>

      {/* Week calendar */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 mb-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-gray-700">{weekLabel()}</span>
          <div className="flex items-center gap-1">
            <button onClick={() => setWeekOffset(w => w - 1)} className="p-1 hover:bg-gray-100 rounded text-gray-500">
              <ChevronLeft size={16} />
            </button>
            {weekOffset !== 0 && (
              <button onClick={() => setWeekOffset(0)} className="px-2 py-0.5 text-xs text-[#0F4C81] hover:underline">Today</button>
            )}
            <button onClick={() => setWeekOffset(w => w + 1)} className="p-1 hover:bg-gray-100 rounded text-gray-500">
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-1">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, i) => (
            <div key={day} className="text-center">
              <div className="text-xs text-gray-400 mb-1">{day}</div>
              <button
                onClick={() => setSelectedDate(weekDays[i])}
                className={`w-full py-2 rounded-lg text-sm font-medium transition-colors relative ${
                  selectedDate === weekDays[i]
                    ? 'bg-[#0F4C81] text-white'
                    : weekDays[i] === today
                    ? 'bg-blue-50 text-[#0F4C81]'
                    : 'hover:bg-gray-50 text-gray-700'
                }`}
              >
                {new Date(weekDays[i] + 'T00:00:00').getDate()}
                {dateCounts[weekDays[i]] > 0 && (
                  <span className={`absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full text-[9px] flex items-center justify-center font-bold ${
                    selectedDate === weekDays[i] ? 'bg-white text-[#0F4C81]' : 'bg-[#0F4C81] text-white'
                  }`}>
                    {dateCounts[weekDays[i]]}
                  </span>
                )}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Plans for selected date */}
      <div className="mb-2">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
          {selectedDate === today ? "Today" : new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          {forDate.length > 0 && <span className="normal-case font-normal text-gray-400 ml-2">· {forDate.length} plan{forDate.length !== 1 ? 's' : ''}</span>}
        </h2>

        {loading ? (
          <div className="space-y-2">
            {[1, 2].map(i => <div key={i} className="h-16 bg-white rounded-xl border border-gray-100 animate-pulse" />)}
          </div>
        ) : forDate.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 p-8 text-center">
            <Calendar size={28} className="text-gray-300 mx-auto mb-2" />
            <p className="text-gray-400 text-sm">No routes for this day.</p>
            <Link href="/dashboard/plans/new" className="text-[#0F4C81] text-xs hover:underline mt-1 block">
              Create a plan →
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {forDate.map(plan => (
              <Link
                key={plan.id}
                href={`/dashboard/plans/${plan.id}`}
                className="block bg-white rounded-xl border border-gray-100 px-4 py-3 hover:shadow-sm transition-shadow"
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900">{plan.date}</span>
                    <Badge status={plan.status} />
                  </div>
                  <span className="text-xs text-gray-400">{plan.stopCount} stops · {plan.routes.length} driver{plan.routes.length !== 1 ? 's' : ''}</span>
                </div>
                {plan.routes.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {plan.routes.map(r => {
                      const driver = drivers.find(d => d.id === r.driverId);
                      return (
                        <span key={r.id} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                          {driver?.name ?? 'Driver'} · {r.stopOrder?.length ?? 0} stops
                        </span>
                      );
                    })}
                  </div>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* All routes summary grouped by depot */}
      {!loading && filtered.length > 0 && (
        <div className="mt-6">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">All routes</h2>
          <div className="space-y-2">
            {filtered.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20).map(plan => (
              <Link
                key={plan.id}
                href={`/dashboard/plans/${plan.id}`}
                className="flex items-center justify-between bg-white rounded-xl border border-gray-100 px-4 py-3 hover:shadow-sm transition-shadow"
              >
                <div>
                  <span className="text-sm font-medium text-gray-900">{plan.date}</span>
                  <span className="text-xs text-gray-400 ml-2">{plan.stopCount} stops</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">{plan.routes.length} driver{plan.routes.length !== 1 ? 's' : ''}</span>
                  <Badge status={plan.status} />
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
