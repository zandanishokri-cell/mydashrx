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
import { ArrowLeft, Plus, Zap, Send, Trash2, UserPlus, MoveRight, GripVertical, AlertTriangle, CheckCircle2, CheckSquare, Square } from 'lucide-react';
import { DndContext, closestCenter } from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

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
  priority?: string;
}
interface Driver { id: string; name: string; vehicleType: string; status: string; }

export default function PlanDetailPage({ params }: { params: { planId: string } }) {
  const router = useRouter();
  const [user] = useState(getUser);
  const { planId } = params;

  const [plan, setPlan] = useState<Plan | null>(null);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [stopsByRoute, setStopsByRoute] = useState<Record<string, Stop[]>>({});
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [optimizing, setOptimizing] = useState(false);
  const [distributing, setDistributing] = useState(false);
  const [autoDistributing, setAutoDistributing] = useState(false);
  const [autoDistributeResult, setAutoDistributeResult] = useState<{ assigned: number } | null>(null);
  const [error, setError] = useState('');
  const [windowViolations, setWindowViolations] = useState<{ stopId: string; address: string; windowEnd: string; estimatedArrival: string }[]>([]);

  const [showAddStop, setShowAddStop] = useState<string | null>(null);
  const [showAddRoute, setShowAddRoute] = useState(false);
  const [addingDriverId, setAddingDriverId] = useState('');
  const [addingRoute, setAddingRoute] = useState(false);
  const [addRouteError, setAddRouteError] = useState('');
  const [selectedStop, setSelectedStop] = useState<Stop | null>(null);
  const [movingStop, setMovingStop] = useState<Stop | null>(null);
  const [movingStopError, setMovingStopError] = useState('');
  const [confirmRemoveRouteId, setConfirmRemoveRouteId] = useState<string | null>(null);
  const [selectedStopIds, setSelectedStopIds] = useState<Set<string>>(new Set());
  const [selectionSourceRouteId, setSelectionSourceRouteId] = useState<string | null>(null);
  const [bulkMoveTargetRouteId, setBulkMoveTargetRouteId] = useState('');
  const [bulkMoving, setBulkMoving] = useState(false);
  const [bulkMoveError, setBulkMoveError] = useState('');
  const [removingRoute, setRemovingRoute] = useState(false);

  const loadPlan = useCallback(async () => {
    if (!user) return;
    try {
      // planData already embeds routes — skip redundant GET /plans/:planId/routes
      const [planData, driversData] = await Promise.all([
        api.get<Plan & { routes: Route[] }>(`/orgs/${user.orgId}/plans/${planId}`),
        api.get<Driver[]>(`/orgs/${user.orgId}/drivers`),
      ]);
      const routesData = planData.routes ?? [];
      setPlan(planData);
      setRoutes(routesData);
      setDrivers(driversData);

      const stopsMap: Record<string, Stop[]> = {};
      await Promise.all(
        routesData.map(async (route) => {
          const s = await api.get<Stop[]>(`/routes/${route.id}/stops`);
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
    setWindowViolations([]);
    try {
      const result = await api.post<{
        optimized: number;
        windowViolations: { stopId: string; address: string; windowEnd: string; estimatedArrival: string }[];
        departureAssumption: string;
      }>(`/orgs/${user!.orgId}/plans/${planId}/optimize`, {});
      if (result.windowViolations?.length > 0) {
        setWindowViolations(result.windowViolations);
      }
      await loadPlan();
    } catch {
      setError('Optimization failed. Please try again.');
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
    } catch {
      setError('Failed to distribute. Please try again.');
    } finally {
      setDistributing(false);
    }
  };

  const autoDistribute = async () => {
    if (autoDistributing) return;
    setAutoDistributing(true);
    setError('');
    setAutoDistributeResult(null);
    try {
      const result = await api.post<{ assigned: number; byRoute: { routeId: string; stopCount: number }[] }>(
        `/orgs/${user!.orgId}/plans/${planId}/auto-distribute`,
        {},
      );
      setAutoDistributeResult({ assigned: result.assigned });
      await loadPlan();
    } catch {
      setError('Auto-distribute failed. Make sure you have routes and unassigned stops for this date.');
    } finally {
      setAutoDistributing(false);
    }
  };

  const addRoute = async () => {
    if (!addingDriverId || addingRoute) return;
    setAddingRoute(true); setAddRouteError('');
    try {
      await api.post(`/plans/${planId}/routes`, { driverId: addingDriverId });
      setShowAddRoute(false);
      setAddingDriverId('');
      await loadPlan();
    } catch {
      setAddRouteError('Failed to add driver. Please try again.');
    } finally { setAddingRoute(false); }
  };

  const reorderStops = useCallback(async (routeId: string, stopIds: string[]) => {
    try {
      await api.patch(`/routes/${routeId}/stops/reorder`, { stopIds });
    } catch {
      setError('Failed to reorder stops — order restored');
      loadPlan();
    }
  }, [loadPlan]);

  const removeRoute = async () => {
    if (!confirmRemoveRouteId || removingRoute) return;
    setRemovingRoute(true);
    try {
      await api.del(`/plans/${planId}/routes/${confirmRemoveRouteId}`);
      setConfirmRemoveRouteId(null);
      await loadPlan();
    } catch {
      setError('Failed to remove route');
    } finally { setRemovingRoute(false); }
  };

  const toggleStopSelection = useCallback((stopId: string, routeId: string) => {
    setSelectedStopIds(prev => {
      const next = new Set(prev);
      if (selectionSourceRouteId && selectionSourceRouteId !== routeId) {
        // Different route — clear and start fresh
        setSelectionSourceRouteId(routeId);
        return new Set([stopId]);
      }
      if (next.has(stopId)) {
        next.delete(stopId);
        if (next.size === 0) setSelectionSourceRouteId(null);
      } else {
        next.add(stopId);
        setSelectionSourceRouteId(routeId);
      }
      return next;
    });
  }, [selectionSourceRouteId]);

  const clearSelection = useCallback(() => {
    setSelectedStopIds(new Set());
    setSelectionSourceRouteId(null);
    setBulkMoveTargetRouteId('');
    setBulkMoveError('');
  }, []);

  const executeBulkMove = async () => {
    if (!bulkMoveTargetRouteId || !selectionSourceRouteId || bulkMoving) return;
    setBulkMoving(true);
    setBulkMoveError('');
    try {
      await api.post(`/routes/${selectionSourceRouteId}/stops/bulk-move`, {
        stopIds: Array.from(selectedStopIds),
        targetRouteId: bulkMoveTargetRouteId,
      });
      clearSelection();
      await loadPlan();
    } catch {
      setBulkMoveError('Failed to move stops. Please try again.');
    } finally {
      setBulkMoving(false);
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

  if (!plan) return (
    <div className="p-6 text-center">
      <p className="text-red-500 mb-2">{error || 'Plan not found'}</p>
      {error && <button onClick={loadPlan} className="text-sm text-[#0F4C81] hover:underline">Retry</button>}
    </div>
  );

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
          {plan.status !== 'distributed' && plan.status !== 'completed' && routes.length > 0 && (
            <Button variant="secondary" size="sm" onClick={autoDistribute} loading={autoDistributing}>
              <MoveRight size={14} /> Auto-Distribute
            </Button>
          )}
          {plan.status !== 'distributed' && plan.status !== 'completed' && (
            <Button size="sm" onClick={optimize} loading={optimizing} disabled={totalStops === 0}>
              <Zap size={14} /> Optimize
            </Button>
          )}
          {(plan.status === 'optimized' || plan.status === 'draft') && routes.length > 0 && totalStops > 0 && (
            <Button size="sm" onClick={distribute} loading={distributing}>
              <Send size={14} /> Distribute
            </Button>
          )}
        </div>
      </div>

      {confirmRemoveRouteId && (
        <div className="mb-4 px-4 py-2.5 bg-amber-50 border border-amber-100 rounded-xl text-sm text-amber-800 flex items-center justify-between">
          <span>Remove this route? Non-terminal stops will become unassigned.</span>
          <div className="flex items-center gap-2 ml-4 shrink-0">
            <button onClick={() => setConfirmRemoveRouteId(null)} disabled={removingRoute} className="text-xs text-gray-500 hover:text-gray-700 disabled:opacity-50">Cancel</button>
            <button onClick={removeRoute} disabled={removingRoute} className="text-xs bg-red-500 text-white px-3 py-1 rounded-lg hover:bg-red-600 disabled:opacity-60 flex items-center gap-1">
              {removingRoute && <span className="inline-block w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
              {removingRoute ? 'Removing…' : 'Remove'}
            </button>
          </div>
        </div>
      )}

      {error && <div className="bg-red-50 text-red-700 rounded-lg px-4 py-3 text-sm mb-4">{error}</div>}

      {autoDistributeResult && (
        <div className="flex items-center gap-2 mb-4 px-4 py-2.5 bg-green-50 border border-green-200 rounded-xl text-sm text-green-800">
          <CheckCircle2 size={15} className="text-green-600 shrink-0" />
          {autoDistributeResult.assigned} stop{autoDistributeResult.assigned !== 1 ? 's' : ''} distributed across {routes.length} route{routes.length !== 1 ? 's' : ''}.
          <button onClick={() => setAutoDistributeResult(null)} className="ml-auto text-green-600 hover:underline text-xs">Dismiss</button>
        </div>
      )}

      {windowViolations.length > 0 && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <AlertTriangle size={15} className="text-amber-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-amber-900">
                  {windowViolations.length} delivery window{windowViolations.length !== 1 ? 's' : ''} may be missed
                </p>
                <p className="text-xs text-amber-700 mt-0.5">These stops are estimated to arrive after their delivery deadline. Resequence manually before distributing.</p>
                <div className="mt-2 space-y-1">
                  {windowViolations.slice(0, 3).map((v) => (
                    <p key={v.stopId} className="text-xs text-amber-800">
                      <strong>{v.address.split(',')[0]}</strong>
                      {' '}— window closes {new Date(v.windowEnd).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })},
                      {' '}arriving ~{new Date(v.estimatedArrival).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                    </p>
                  ))}
                  {windowViolations.length > 3 && (
                    <p className="text-xs text-amber-600">+{windowViolations.length - 3} more</p>
                  )}
                </div>
              </div>
            </div>
            <button onClick={() => setWindowViolations([])} className="text-amber-400 hover:text-amber-600 shrink-0">✕</button>
          </div>
        </div>
      )}

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
                      {driver?.name?.[0] ?? '?'}
                    </div>
                    <div>
                      <span className="font-medium text-gray-900 text-sm">{driver?.name ?? 'Unknown Driver'}</span>
                      <span className="text-xs text-gray-400 ml-2">{driver?.vehicleType}</span>
                    </div>
                    <Badge status={route.status} />
                  </div>
                  <div className="flex items-center gap-3">
                    {route.estimatedDuration && (
                      <span className="text-xs text-gray-400">{Math.round(route.estimatedDuration / 60)} min</span>
                    )}
                    <span className="text-xs text-gray-500">{stops.length} stops{stops.length > 0 ? ` · ${completed} done` : ''}</span>
                    <button onClick={() => setShowAddStop(route.id)} className="flex items-center gap-1 text-xs text-[#0F4C81] hover:underline">
                      <Plus size={12} /> Add Stop
                    </button>
                    <button onClick={() => setConfirmRemoveRouteId(route.id)} className="text-gray-300 hover:text-red-500 transition-colors">
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
                  <DndContext
                    collisionDetection={closestCenter}
                    onDragEnd={(event: DragEndEvent) => {
                      const { active, over } = event;
                      if (!over || active.id === over.id) return;
                      const routeStops = stopsByRoute[route.id] ?? [];
                      const oldIdx = routeStops.findIndex(s => s.id === String(active.id));
                      const newIdx = routeStops.findIndex(s => s.id === String(over.id));
                      if (oldIdx < 0 || newIdx < 0) return;
                      const reordered = arrayMove(routeStops, oldIdx, newIdx);
                      setStopsByRoute(prev => ({ ...prev, [route.id]: reordered }));
                      reorderStops(route.id, reordered.map(s => s.id));
                    }}
                  >
                    <SortableContext items={stops.map(s => s.id)} strategy={verticalListSortingStrategy}>
                      <div className="divide-y divide-gray-50">
                        {stops.map((stop, idx) => (
                          <SortableStopItem
                            key={stop.id}
                            stop={stop}
                            idx={idx}
                            routeCount={routes.length}
                            onSelect={() => setSelectedStop(stop)}
                            onMove={() => setMovingStop(stop)}
                            isSelected={selectedStopIds.has(stop.id)}
                            onToggleSelect={(stopId) => toggleStopSelection(stopId, route.id)}
                            selectionEnabled={route.status !== 'completed'}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Bulk Move Action Bar */}
      {selectedStopIds.size > 0 && selectionSourceRouteId && (
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200 shadow-lg px-6 py-3 flex items-center gap-4 flex-wrap">
          <span className="text-sm font-medium text-gray-800">
            {selectedStopIds.size} stop{selectedStopIds.size !== 1 ? 's' : ''} selected from{' '}
            <strong>{drivers.find(d => d.id === routes.find(r => r.id === selectionSourceRouteId)?.driverId)?.name ?? 'route'}</strong>
          </span>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <label className="text-sm text-gray-500 shrink-0">Move to:</label>
            <select
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm min-w-0 flex-1 max-w-xs"
              value={bulkMoveTargetRouteId}
              onChange={e => setBulkMoveTargetRouteId(e.target.value)}
              disabled={bulkMoving}
            >
              <option value="">Choose route…</option>
              {routes.filter(r => r.id !== selectionSourceRouteId).map(r => {
                const d = drivers.find(dr => dr.id === r.driverId);
                return (
                  <option key={r.id} value={r.id}>
                    {d?.name ?? 'Unknown'} ({(stopsByRoute[r.id] ?? []).length} stops)
                  </option>
                );
              })}
            </select>
          </div>
          {bulkMoveError && <span className="text-xs text-red-600">{bulkMoveError}</span>}
          <div className="flex items-center gap-2 shrink-0">
            <Button
              size="sm"
              onClick={executeBulkMove}
              disabled={!bulkMoveTargetRouteId || bulkMoving}
              loading={bulkMoving}
            >
              <MoveRight size={13} /> Move
            </Button>
            <Button variant="secondary" size="sm" onClick={clearSelection} disabled={bulkMoving}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Add Driver Modal */}
      {showAddRoute && (
        <Modal title="Add Driver to Plan" onClose={() => { setShowAddRoute(false); setAddRouteError(''); setAddingDriverId(''); }}>
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
                  disabled={addingRoute}
                >
                  <option value="">Choose a driver…</option>
                  {availableDrivers.map(d => (
                    <option key={d.id} value={d.id}>{d.name} ({d.vehicleType})</option>
                  ))}
                </select>
              </div>
              {addRouteError && (
                <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{addRouteError}</p>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="secondary" size="sm" onClick={() => { setShowAddRoute(false); setAddRouteError(''); setAddingDriverId(''); }} disabled={addingRoute}>Cancel</Button>
                <Button size="sm" onClick={addRoute} disabled={!addingDriverId || addingRoute} loading={addingRoute}>
                  {addingRoute ? 'Adding…' : 'Add Driver'}
                </Button>
              </div>
            </div>
          )}
        </Modal>
      )}

      {/* Move Stop Modal */}
      {movingStop && (
        <Modal title="Move stop to another route" onClose={() => { setMovingStop(null); setMovingStopError(''); }}>
          <p className="text-sm text-gray-600 mb-3">Moving <strong>{movingStop.recipientName}</strong> to:</p>
          {movingStopError && (
            <p className="text-xs text-red-600 mb-3 bg-red-50 px-3 py-2 rounded-lg">{movingStopError}</p>
          )}
          <div className="space-y-2">
            {routes.filter(r => r.id !== movingStop.routeId).map(r => {
              const d = drivers.find(dr => dr.id === r.driverId);
              return (
                <button
                  key={r.id}
                  onClick={async () => {
                    setMovingStopError('');
                    try {
                      await api.patch(`/routes/${movingStop.routeId}/stops/${movingStop.id}/move`, { targetRouteId: r.id });
                      setMovingStop(null);
                      await loadPlan();
                    } catch {
                      setMovingStopError('Failed to move stop. Please try again.');
                    }
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 border border-gray-200 rounded-xl hover:border-blue-300 hover:bg-blue-50 transition-colors text-left"
                >
                  <div className="w-7 h-7 rounded-full bg-blue-50 flex items-center justify-center text-[#0F4C81] font-semibold text-sm">
                    {d?.name?.[0] ?? '?'}
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

function SortableStopItem({ stop, idx, routeCount, onSelect, onMove, isSelected, onToggleSelect, selectionEnabled }: {
  stop: Stop;
  idx: number;
  routeCount: number;
  onSelect: () => void;
  onMove: () => void;
  isSelected: boolean;
  onToggleSelect: (stopId: string) => void;
  selectionEnabled: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: stop.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      className={`flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors group${isSelected ? ' bg-blue-50' : ''}`}
    >
      {selectionEnabled && (
        <button
          onClick={() => onToggleSelect(stop.id)}
          className="text-gray-300 hover:text-[#0F4C81] shrink-0 transition-colors"
          tabIndex={-1}
        >
          {isSelected ? <CheckSquare size={15} className="text-[#0F4C81]" /> : <Square size={15} />}
        </button>
      )}
      <button
        {...attributes}
        {...listeners}
        className="touch-none text-gray-300 hover:text-gray-400 cursor-grab active:cursor-grabbing shrink-0"
        tabIndex={-1}
      >
        <GripVertical size={14} />
      </button>
      <span className="w-6 h-6 rounded-full bg-gray-100 text-gray-500 text-xs flex items-center justify-center font-medium shrink-0">
        {stop.sequenceNumber != null ? stop.sequenceNumber + 1 : idx + 1}
      </span>
      <div className="flex-1 min-w-0 cursor-pointer" onClick={onSelect}>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-900 truncate">{stop.recipientName}</span>
          {stop.priority === 'urgent' && <span className="text-xs bg-red-50 text-red-600 px-1.5 py-0.5 rounded font-medium">Urgent</span>}
          {stop.priority === 'high' && <span className="text-xs bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded font-medium">High</span>}
          {stop.requiresRefrigeration && <span className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">❄ Cold</span>}
          {stop.controlledSubstance && <span className="text-xs bg-orange-50 text-orange-600 px-1.5 py-0.5 rounded">⚠ Ctrl</span>}
        </div>
        <p className="text-xs text-gray-400 truncate">{stop.address}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {stop.rxNumbers?.length > 0 && <span className="text-xs text-gray-400">Rx ×{stop.rxNumbers.length}</span>}
        <Badge status={stop.status} />
        {routeCount > 1 && (
          <button
            onClick={onMove}
            className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-[#0F4C81] transition-all"
            title="Move to another route"
          >
            <MoveRight size={13} />
          </button>
        )}
      </div>
    </div>
  );
}
