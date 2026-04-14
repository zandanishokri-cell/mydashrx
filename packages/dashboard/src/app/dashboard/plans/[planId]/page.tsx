'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { AddStopModal } from '@/components/AddStopModal';
import { StopDetailModal } from '@/components/StopDetailModal';
import { ArrowLeft, Plus, Zap, Send, Trash2, UserPlus, MoveRight } from 'lucide-react';

interface Plan { id: string; date: string; status: string; depotId: string; }
interface Route { id: string; driverId: string; status: string; stopOrder: string[]; estimatedDuration: number | null; totalDistance: number | null; }
interface Stop {
  id: string; routeId: string; recipientName: string; address: string;
  recipientPhone: string; status: string; sequenceNumber: number | null;
  requiresRefrigeration: boolean; controlledSubstance: boolean;
  requiresSignature: boolean; requiresPhoto: boolean;
  rxNumbers: string[]; packageCount: number; deliveryNotes?: string;
  codAmount?: number; trackingToken?: string; arrivedAt?: string;
  completedAt?: string; failureReason?: string; failureNote?: string;
}
interface Driver { id: string; name: string; vehicleType: string; status: string; }

export default function PlanDetailPage({ params }: { params: { planId: string } }) {
  const router = useRouter();
  const user = getUser();
  const { planId } = params;

  const [plan, setPlan] = useState<Plan | null>(null);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [stopsByRoute, setStopsByRoute] = useState<Record<string, Stop[]>>({});
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [optimizing, setOptimizing] = useState(false);
  const [distributing, setDistributing] = useState(false);
  const [error, setError] = useState('');

  const [showAddStop, setShowAddStop] = useState<string | null>(null);
  const [showAddRoute, setShowAddRoute] = useState(false);
  const [addingDriverId, setAddingDriverId] = useState('');
  const [selectedStop, setSelectedStop] = useState<Stop | null>(null);
  const [moveStop, setMoveStop] = useState<{ stop: Stop; targetRouteId: string } | null>(null);
  const [movingStop, setMovingStop] = useState<Stop | null>(null);

  const loadPlan = useCallback(async () => {
    if (!user) return;
    try {
      const [planData, routesData, driversData] = await Promise.all([
        api.get<Plan & { routes: Route[] }>(`/orgs/${user.orgId}/plans/${planId}`),
        api.get<Route[]>(`/plans/${planId}/routes`),
        api.get<Driver[]>(`/orgs/${user.orgId}/drivers`),
      ]);
      setPlan(planData);
      setRoutes(routesData);
      setDrivers(driversData);

      const stopsMap: Record<string, Stop[]> = {};
      await Promise.all(
        routesData.map(async (route) => {
          const s = await api.get<Stop[]>(`/plans/${planId}/routes/${route.id}/stops`);
          stopsMap[route.id] = s;
        }),
      );
      setStopsByRoute(stopsMap);
    } catch {
      setError('Failed to load plan');
    } finally {
      setLoading(false);
    }
  }, [user, planId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadPlan(); }, [loadPlan]);

  const optimize = async () => {
    setOptimizing(true);
    setError('');
    try {
      await api.post(`/orgs/${user!.orgId}/plans/${planId}/optimize`, {});
      await loadPlan();
    } catch (err: any) {
      setError(err?.message ?? 'Optimization failed');
    } finally {
      setOptimizing(false);
    }
  };

  const distribute = async () => {
    setDistributing(true);
    setError('');
    try {
      await api.patch(`/orgs/${user!.orgId}/plans/${planId}/distribute`, {});
      await loadPlan();
    } catch (err: any) {
      setError(err?.message ?? 'Failed to distribute');
    } finally {
      setDistributing(false);
    }
  };

  const addRoute = async () => {
    if (!addingDriverId) return;
    try {
      await api.post(`/plans/${planId}/routes`, { driverId: addingDriverId });
      setShowAddRoute(false);
      setAddingDriverId('');
      await loadPlan();
    } catch {
      setError('Failed to add driver to plan');
    }
  };

  const removeRoute = async (routeId: string) => {
    if (!confirm('Remove this route and all its stops?')) return;
    try {
      await api.del(`/plans/${planId}/routes/${routeId}`);
      await loadPlan();
    } catch {
      setError('Failed to remove route');
    }
  };

  const confirmMoveStop = async () => {
    if (!movingStop || !moveStop) return;
    try {
      // Update stop's routeId by patching status to same value (triggers route reassign)
      // We need a dedicated move endpoint — use patch on stop with new routeId
      await api.patch(`/routes/${movingStop.routeId}/stops/${movingStop.id}/move`, {
        targetRouteId: moveStop.targetRouteId,
      });
      setMovingStop(null);
      setMoveStop(null);
      await loadPlan();
    } catch {
      setError('Failed to move stop');
    }
  };

  const totalStops = Object.values(stopsByRoute).reduce((s, arr) => s + arr.length, 0);
  const assignedDriverIds = new Set(routes.map(r => r.driverId));
  const availableDrivers = drivers.filter(d => !assignedDriverIds.has(d.id));

  if (loading) {
    return (
      <div className="p-6">
        <div className="h-8 w-48 bg-gray-100 rounded animate-pulse mb-6" />
        <div className="space-y-4">
          {[1, 2].map(i => <div key={i} className="h-32 bg-white rounded-2xl border border-gray-100 animate-pulse" />)}
        </div>
      </div>
    );
  }

  if (!plan) return <div className="p-6 text-red-500">{error || 'Plan not found'}</div>;

  return (
    <div className="p-6">
      <button onClick={() => router.back()} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-4 transition-colors">
        <ArrowLeft size={14} /> Back to Routes
      </button>

      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900" style={{ fontFamily: 'var(--font-sora)' }}>
              {new Date(plan.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </h1>
            <Badge status={plan.status} />
          </div>
          <p className="text-sm text-gray-500 mt-1">{routes.length} driver{routes.length !== 1 ? 's' : ''} · {totalStops} stop{totalStops !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <Button variant="secondary" size="sm" onClick={() => setShowAddRoute(true)}>
            <UserPlus size={14} /> Add Driver
          </Button>
          {plan.status !== 'distributed' && plan.status !== 'completed' && (
            <Button size="sm" onClick={optimize} loading={optimizing} disabled={totalStops === 0}>
              <Zap size={14} /> Optimize
            </Button>
          )}
          {(plan.status === 'optimized' || plan.status === 'draft') && totalStops > 0 && (
            <Button size="sm" onClick={distribute} loading={distributing}>
              <Send size={14} /> Distribute
            </Button>
          )}
        </div>
      </div>

      {error && <div className="bg-red-50 text-red-700 rounded-lg px-4 py-3 text-sm mb-4">{error}</div>}

      {routes.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center">
          <p className="text-gray-400 text-sm mb-3">No drivers assigned to this plan yet.</p>
          <Button size="sm" onClick={() => setShowAddRoute(true)}>
            <UserPlus size={14} /> Assign a Driver
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {routes.map(route => {
            const driver = drivers.find(d => d.id === route.driverId);
            const stops = stopsByRoute[route.id] ?? [];
            const completed = stops.filter(s => s.status === 'completed').length;
            return (
              <div key={route.id} className="bg-white rounded-2xl border border-gray-100">
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-50">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center text-[#0F4C81] font-semibold text-sm">
                      {driver?.name[0] ?? '?'}
                    </div>
                    <div>
                      <span className="font-medium text-gray-900 text-sm">{driver?.name ?? 'Unknown Driver'}</span>
                      <span className="text-xs text-gray-400 ml-2">{driver?.vehicleType}</span>
                    </div>
                    <Badge status={route.status} />
                  </div>
                  <div className="flex items-center gap-3">
                    {route.estimatedDuration && (
                      <span className="text-xs text-gray-400">{Math.round(route.estimatedDuration)} min</span>
                    )}
                    <span className="text-xs text-gray-500">{stops.length} stops{stops.length > 0 ? ` · ${completed} done` : ''}</span>
                    <button onClick={() => setShowAddStop(route.id)} className="flex items-center gap-1 text-xs text-[#0F4C81] hover:underline">
                      <Plus size={12} /> Add Stop
                    </button>
                    <button onClick={() => removeRoute(route.id)} className="text-gray-300 hover:text-red-500 transition-colors">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {stops.length === 0 ? (
                  <div className="px-5 py-6 text-center">
                    <p className="text-gray-400 text-sm mb-2">No stops yet.</p>
                    <button onClick={() => setShowAddStop(route.id)} className="text-[#0F4C81] text-sm hover:underline">
                      + Add first stop
                    </button>
                  </div>
                ) : (
                  <div className="divide-y divide-gray-50">
                    {stops.map((stop, idx) => (
                      <div key={stop.id} className="flex items-center gap-4 px-5 py-3 hover:bg-gray-50 cursor-pointer transition-colors group">
                        <span className="w-6 h-6 rounded-full bg-gray-100 text-gray-500 text-xs flex items-center justify-center font-medium shrink-0">
                          {stop.sequenceNumber != null ? stop.sequenceNumber + 1 : idx + 1}
                        </span>
                        <div className="flex-1 min-w-0" onClick={() => setSelectedStop(stop)}>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-900 truncate">{stop.recipientName}</span>
                            {stop.requiresRefrigeration && <span className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">❄ Cold</span>}
                            {stop.controlledSubstance && <span className="text-xs bg-orange-50 text-orange-600 px-1.5 py-0.5 rounded">⚠ Ctrl</span>}
                          </div>
                          <p className="text-xs text-gray-400 truncate">{stop.address}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {stop.rxNumbers?.length > 0 && <span className="text-xs text-gray-400">Rx ×{stop.rxNumbers.length}</span>}
                          <Badge status={stop.status} />
                          {routes.length > 1 && (
                            <button
                              onClick={() => setMovingStop(stop)}
                              className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-[#0F4C81] transition-all"
                              title="Move to another route"
                            >
                              <MoveRight size={13} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add Driver Modal */}
      {showAddRoute && (
        <Modal title="Add Driver to Plan" onClose={() => setShowAddRoute(false)}>
          {availableDrivers.length === 0 ? (
            <p className="text-gray-500 text-sm">All drivers are already assigned to this plan.</p>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Select Driver</label>
                <select
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  value={addingDriverId}
                  onChange={e => setAddingDriverId(e.target.value)}
                >
                  <option value="">Choose a driver…</option>
                  {availableDrivers.map(d => (
                    <option key={d.id} value={d.id}>{d.name} ({d.vehicleType})</option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="secondary" size="sm" onClick={() => setShowAddRoute(false)}>Cancel</Button>
                <Button size="sm" onClick={addRoute} disabled={!addingDriverId}>Add Driver</Button>
              </div>
            </div>
          )}
        </Modal>
      )}

      {/* Move Stop Modal */}
      {movingStop && (
        <Modal title="Move stop to another route" onClose={() => setMovingStop(null)}>
          <p className="text-sm text-gray-600 mb-3">Moving <strong>{movingStop.recipientName}</strong> to:</p>
          <div className="space-y-2">
            {routes.filter(r => r.id !== movingStop.routeId).map(r => {
              const d = drivers.find(dr => dr.id === r.driverId);
              return (
                <button
                  key={r.id}
                  onClick={async () => {
                    setMoveStop({ stop: movingStop, targetRouteId: r.id });
                    try {
                      await api.patch(`/routes/${movingStop.routeId}/stops/${movingStop.id}/move`, { targetRouteId: r.id });
                      setMovingStop(null);
                      await loadPlan();
                    } catch { setError('Failed to move stop'); setMovingStop(null); }
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 border border-gray-200 rounded-xl hover:border-blue-300 hover:bg-blue-50 transition-colors text-left"
                >
                  <div className="w-7 h-7 rounded-full bg-blue-50 flex items-center justify-center text-[#0F4C81] font-semibold text-sm">
                    {d?.name[0] ?? '?'}
                  </div>
                  <span className="text-sm font-medium text-gray-800">{d?.name ?? 'Unknown'}</span>
                  <span className="text-xs text-gray-400 ml-auto">{(stopsByRoute[r.id] ?? []).length} stops</span>
                </button>
              );
            })}
          </div>
        </Modal>
      )}

      {showAddStop && (
        <AddStopModal
          routeId={showAddStop}
          orgId={user!.orgId}
          onClose={() => setShowAddStop(null)}
          onSaved={() => { setShowAddStop(null); loadPlan(); }}
        />
      )}

      {selectedStop && (
        <StopDetailModal
          stop={selectedStop}
          onClose={() => setSelectedStop(null)}
          onUpdated={() => { setSelectedStop(null); loadPlan(); }}
        />
      )}
    </div>
  );
}
