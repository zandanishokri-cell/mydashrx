'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { Badge } from '@/components/ui/Badge';
import { DepotFilter } from '@/components/ui/DepotFilter';
import { Plus, Calendar, ChevronLeft, ChevronRight, Zap, Route, AlertCircle, X } from 'lucide-react';

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
  const [optimizingId, setOptimizingId] = useState<string | null>(null);
  const [optimizeToast, setOptimizeToast] = useState('');
  const [depotId, setDepotId] = useState('');
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [user] = useState(getUser);
  const [loadError, setLoadError] = useState(false);

  const weekDays = getWeekRange(weekOffset);
  const today = new Date().toISOString().split('T')[0];

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true); setLoadError(false);
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
    } catch { setPlans([]); setLoadError(true); }
    finally { setLoading(false); }
  }, [user, depotId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  const optimizePlan = async (planId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setOptimizingId(planId);
    try {
      const result = await api.post<{ optimized: number }>(`/orgs/${user!.orgId}/plans/${planId}/optimize`, {});
      setOptimizeToast(`${result.optimized} route${result.optimized !== 1 ? 's' : ''} optimized`);
      setTimeout(() => setOptimizeToast(''), 3000);
      await load();
    } catch { setOptimizeToast('Optimization failed. Please try again.'); setTimeout(() => setOptimizeToast(''), 3000); }
    finally { setOptimizingId(null); }
  };

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
      {optimizeToast && (
        <div className="fixed bottom-4 right-4 z-50 bg-gray-900 text-white text-sm px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-2">
          <Zap size={14} className="text-[#00B8A9]" /> {optimizeToast}
        </div>
      )}
      {loadError && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 mb-5 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          <span className="flex items-center gap-2"><AlertCircle size={14} />Failed to load routes. Please try again.</span>
          <button onClick={load} className="text-red-600 font-medium hover:underline text-xs">Retry</button>
        </div>
      )}
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

      {/* Top-level onboarding empty state — zero plans ever created */}
      {!loading && plans.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Route size={64} className="text-gray-200 mb-4" />
          <p className="text-gray-800 font-semibold text-base mb-2">No delivery plans yet</p>
          <p className="text-gray-400 text-sm max-w-xs">
            Create your first delivery plan to start organizing routes and dispatching drivers.
          </p>
        </div>
      )}

      {/* Week calendar + day view — only shown when plans exist or loading */}
      {(loading || plans.length > 0) && (
        <>
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
              <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
                <Calendar size={48} className="text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500 text-sm">No routes for this day.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {forDate.map(plan => (
                  <div key={plan.id} className="relative bg-white rounded-xl border border-gray-100 hover:shadow-sm transition-shadow">
                    <Link
                      href={`/dashboard/plans/${plan.id}`}
                      className="block px-4 py-3"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-900">{plan.date}</span>
                          <Badge status={plan.status} />
                        </div>
                        <div className="flex items-center gap-2">
                          {plan.status !== 'distributed' && plan.status !== 'completed' && plan.stopCount > 0 && (
                            <button
                              onClick={e => optimizePlan(plan.id, e)}
                              disabled={optimizingId === plan.id}
                              className="flex items-center gap-1 text-xs font-medium text-[#0F4C81] bg-blue-50 hover:bg-blue-100 px-2 py-0.5 rounded-full transition-colors disabled:opacity-50"
                            >
                              <Zap size={11} /> {optimizingId === plan.id ? 'Optimizing…' : 'Optimize'}
                            </button>
                          )}
                          <span className="text-xs text-gray-400">{plan.stopCount} stops · {plan.routes.length} driver{plan.routes.length !== 1 ? 's' : ''}</span>
                        </div>
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
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* All routes summary */}
          {!loading && filtered.length > 0 && (
            <div className="mt-6">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">All routes</h2>
              <div className="space-y-2">
                {filtered.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20).map(plan => (
                  <div key={plan.id} className="bg-white rounded-xl border border-gray-100 hover:shadow-sm transition-shadow">
                    <Link
                      href={`/dashboard/plans/${plan.id}`}
                      className="flex items-center justify-between px-4 py-3"
                    >
                      <div>
                        <span className="text-sm font-medium text-gray-900">{plan.date}</span>
                        <span className="text-xs text-gray-400 ml-2">{plan.stopCount} stops</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {plan.status !== 'distributed' && plan.status !== 'completed' && plan.stopCount > 0 && (
                          <button
                            onClick={e => optimizePlan(plan.id, e)}
                            disabled={optimizingId === plan.id}
                            className="flex items-center gap-1 text-xs font-medium text-[#0F4C81] bg-blue-50 hover:bg-blue-100 px-2 py-0.5 rounded-full transition-colors disabled:opacity-50"
                          >
                            <Zap size={11} /> {optimizingId === plan.id ? 'Optimizing…' : 'Optimize'}
                          </button>
                        )}
                        <span className="text-xs text-gray-400">{plan.routes.length} driver{plan.routes.length !== 1 ? 's' : ''}</span>
                        <Badge status={plan.status} />
                      </div>
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
