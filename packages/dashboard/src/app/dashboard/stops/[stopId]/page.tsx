'use client';
import { useEffect, useState, useCallback, Suspense } from 'react';
import { useParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { Badge } from '@/components/ui/Badge';
import { PodViewer } from '@/components/PodViewer';

const LeafletMap = dynamic(() => import('@/components/ui/LeafletMap'), {
  ssr: false,
  loading: () => <div className="w-full h-40 bg-gray-100 animate-pulse" />,
});
import {
  ArrowLeft, Phone, MapPin, Package, Thermometer, AlertTriangle,
  PenLine, Clock, CheckCircle2, XCircle, Truck, User, FileCheck,
  Flag, RotateCcw, FileEdit, ChevronRight,
} from 'lucide-react';
import Link from 'next/link';

interface TimelineEvent { event: string; timestamp: string | null; meta?: string; }

interface StopDetail {
  id: string;
  recipientName: string;
  recipientPhone: string;
  address: string;
  unit?: string;
  status: string;
  rxNumbers: string[];
  packageCount: number;
  requiresRefrigeration: boolean;
  controlledSubstance: boolean;
  requiresSignature: boolean;
  requiresPhoto: boolean;
  requiresAgeVerification: boolean;
  codAmount?: number;
  deliveryNotes?: string;
  failureReason?: string;
  failureNote?: string;
  windowStart?: string;
  windowEnd?: string;
  arrivedAt?: string;
  completedAt?: string;
  createdAt: string;
  trackingToken?: string;
  lat?: number;
  lng?: number;
  routeId?: string;
  routeStatus?: string;
  planId?: string;
  planDate?: string;
  planStatus?: string;
  driverId?: string;
  driverName?: string;
  driverPhone?: string;
  depotName?: string;
  pod?: Record<string, unknown> | null;
  barcodesScanned?: string[];
  packageConfirmed?: boolean;
  timeline?: TimelineEvent[];
}

const TIMELINE_ICONS: Record<string, React.ElementType> = {
  'Created': Clock,
  'Assigned to route': Truck,
  'Driver picked up': User,
  'Arrived': MapPin,
  'Completed': CheckCircle2,
  'Failed': XCircle,
};

const initials = (name: string) =>
  name.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase();

function StopDetailContent({ stopId }: { stopId: string }) {
  const router = useRouter();
  const user = getUser();
  const [stop, setStop] = useState<StopDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [rescheduleError, setRescheduleError] = useState<string | null>(null);
  const [showPod, setShowPod] = useState(false);
  const [showReassign, setShowReassign] = useState(false);
  const [planRoutes, setPlanRoutes] = useState<{ id: string; driverId: string; driverName: string }[]>([]);
  const [reassignTargetId, setReassignTargetId] = useState('');
  const [reassigning, setReassigning] = useState(false);
  const [reassignError, setReassignError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const data = await api.get<StopDetail>(`/orgs/${user.orgId}/stops/${stopId}`);
      setStop(data);
      setNotesValue(data.deliveryNotes ?? '');
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [stopId, user]);

  useEffect(() => { load(); }, [load]);

  const saveNotes = async () => {
    if (!stop || !user || !stop.routeId) return;
    setSavingNotes(true);
    try {
      await api.patch(`/routes/${stop.routeId}/stops/${stop.id}`, { deliveryNotes: notesValue });
      setStop(s => s ? { ...s, deliveryNotes: notesValue } : s);
      setEditingNotes(false);
    } catch { /* silent */ }
    finally { setSavingNotes(false); }
  };

  const reschedule = async () => {
    if (!stop || !user || !stop.routeId) return;
    setRescheduling(true);
    setRescheduleError(null);
    try {
      await api.patch(`/routes/${stop.routeId}/stops/${stop.id}/status`, { status: 'pending' });
      await load();
    } catch {
      setRescheduleError('Failed to reschedule. Please try again.');
    } finally { setRescheduling(false); }
  };

  const openReassign = async () => {
    if (!stop?.planId || !user) return;
    try {
      const [planRoutesData, driversData] = await Promise.all([
        api.get<{ id: string; driverId: string }[]>(`/plans/${stop.planId}/routes`),
        api.get<{ id: string; name: string }[]>(`/orgs/${user.orgId}/drivers`),
      ]);
      const driverMap = Object.fromEntries(driversData.map(d => [d.id, d.name]));
      const others = planRoutesData
        .filter(r => r.id !== stop.routeId)
        .map(r => ({ ...r, driverName: driverMap[r.driverId] ?? 'Unknown Driver' }));
      setPlanRoutes(others);
      setReassignTargetId(others[0]?.id ?? '');
      setShowReassign(true);
    } catch { /* silent — button just won't work */ }
  };

  const confirmReassign = async () => {
    if (!stop || !reassignTargetId || !user) return;
    setReassigning(true);
    setReassignError(null);
    try {
      await api.patch(`/routes/${stop.routeId}/stops/${stop.id}/move`, { targetRouteId: reassignTargetId });
      await load();
      setShowReassign(false);
    } catch {
      setReassignError('Failed to reassign. Please try again.');
    } finally { setReassigning(false); }
  };

  if (loading) return (
    <div className="p-6 space-y-4">
      {[1, 2, 3].map(i => <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />)}
    </div>
  );

  if (notFound || !stop) return (
    <div className="p-6 text-center text-gray-400">
      <p className="text-lg font-medium">Stop not found</p>
      <button onClick={() => router.back()} className="text-sm text-[#0F4C81] mt-2 hover:underline">
        Go back
      </button>
    </div>
  );

  const mapsHref = stop.lat && stop.lng
    ? `https://maps.google.com/?q=${stop.lat},${stop.lng}`
    : `https://maps.google.com/?q=${encodeURIComponent(stop.address)}`;

  return (
    <div className="flex flex-col h-full overflow-auto">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-100 bg-white shrink-0 sticky top-0 z-10">
        <div className="flex items-center gap-3 mb-3">
          <button
            onClick={() => router.back()}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-sm font-bold text-gray-600 shrink-0">
              {initials(stop.recipientName)}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="font-bold text-gray-900 text-lg truncate" style={{ fontFamily: 'var(--font-sora)' }}>
                  {stop.address}
                </h1>
                {stop.unit && <span className="text-gray-400 text-sm">Unit {stop.unit}</span>}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <Badge status={stop.status} />
                {stop.controlledSubstance && (
                  <span className="flex items-center gap-1 text-xs bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full font-medium">
                    <AlertTriangle size={10} /> Controlled
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-6 max-w-3xl">
        {/* Timeline */}
        {stop.timeline && stop.timeline.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Activity Timeline</h2>
            <div className="relative">
              {/* Vertical line */}
              <div className="absolute left-4 top-5 bottom-5 w-px bg-gray-200" />
              <div className="space-y-4">
                {stop.timeline.map((event, i) => {
                  const Icon = TIMELINE_ICONS[event.event] ?? Clock;
                  const isLast = i === stop.timeline!.length - 1;
                  const isFail = event.event === 'Failed';
                  return (
                    <div key={i} className="flex items-start gap-4">
                      <div className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                        isLast && isFail ? 'bg-red-100' :
                        isLast ? 'bg-emerald-100' :
                        'bg-gray-100'
                      }`}>
                        <Icon size={14} className={
                          isLast && isFail ? 'text-red-600' :
                          isLast ? 'text-emerald-600' :
                          'text-gray-500'
                        } />
                      </div>
                      <div className="flex-1 pt-1">
                        <p className="text-sm font-medium text-gray-900">{event.event}</p>
                        {event.meta && (
                          <p className="text-xs text-gray-500 mt-0.5">{event.meta}</p>
                        )}
                        {event.timestamp && (
                          <p className="text-xs text-gray-400 mt-0.5">
                            {new Date(event.timestamp).toLocaleString([], {
                              month: 'short', day: 'numeric',
                              hour: 'numeric', minute: '2-digit',
                            })}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {/* Delivery Details */}
        <section className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Delivery Details</h2>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="flex items-start gap-2 text-gray-600 col-span-2">
              <MapPin size={14} className="mt-0.5 shrink-0 text-gray-400" />
              <span>{stop.address}{stop.unit ? `, Unit ${stop.unit}` : ''}</span>
            </div>
            <div className="flex items-center gap-2 text-gray-600">
              <Phone size={14} className="shrink-0 text-gray-400" />
              <span>{stop.recipientPhone || '—'}</span>
            </div>
            <div className="flex items-center gap-2 text-gray-600">
              <Package size={14} className="shrink-0 text-gray-400" />
              <span>{stop.packageCount} package{stop.packageCount !== 1 ? 's' : ''}</span>
            </div>
            {stop.rxNumbers?.length > 0 && (
              <div className="flex items-center gap-2 text-gray-600 col-span-2">
                <FileEdit size={14} className="shrink-0 text-gray-400" />
                <span>Rx: {stop.rxNumbers.join(', ')}</span>
              </div>
            )}
            {(stop.windowStart || stop.windowEnd) && (
              <div className="flex items-center gap-2 text-gray-600 col-span-2">
                <Clock size={14} className="shrink-0 text-gray-400" />
                <span>
                  Window: {stop.windowStart ? new Date(stop.windowStart).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—'}
                  {' – '}
                  {stop.windowEnd ? new Date(stop.windowEnd).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—'}
                </span>
              </div>
            )}
            {stop.driverName && (
              <div className="flex items-center gap-2 text-gray-600 col-span-2">
                <Truck size={14} className="shrink-0 text-gray-400" />
                <span>Driver: {stop.driverName}</span>
                {stop.driverPhone && <span className="text-gray-400">· {stop.driverPhone}</span>}
              </div>
            )}
            {stop.depotName && (
              <div className="flex items-center gap-2 text-gray-600 col-span-2 text-xs text-gray-400">
                Depot: {stop.depotName}
              </div>
            )}
          </div>

          {/* Flags */}
          <div className="flex flex-wrap gap-2 pt-1">
            {stop.requiresRefrigeration && (
              <span className="flex items-center gap-1 text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded-full">
                <Thermometer size={11} /> Refrigeration
              </span>
            )}
            {stop.controlledSubstance && (
              <span className="flex items-center gap-1 text-xs bg-amber-50 text-amber-700 px-2 py-1 rounded-full border border-amber-200">
                <AlertTriangle size={11} /> Controlled Substance
              </span>
            )}
            {stop.requiresSignature && (
              <span className="flex items-center gap-1 text-xs bg-purple-50 text-purple-700 px-2 py-1 rounded-full">
                <PenLine size={11} /> Signature Required
              </span>
            )}
            {stop.codAmount && (
              <span className="text-xs bg-yellow-50 text-yellow-700 px-2 py-1 rounded-full">
                COD ${stop.codAmount}
              </span>
            )}
          </div>

          {/* Notes */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-gray-500">Delivery Notes</span>
              <button
                onClick={() => setEditingNotes(e => !e)}
                disabled={!stop.routeId}
                title={!stop.routeId ? 'Assign to a route first' : undefined}
                className="text-xs text-[#0F4C81] hover:underline disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {editingNotes ? 'Cancel' : 'Edit'}
              </button>
            </div>
            {editingNotes ? (
              <div className="space-y-2">
                <textarea
                  value={notesValue}
                  onChange={e => setNotesValue(e.target.value)}
                  rows={3}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-100"
                />
                <button
                  onClick={saveNotes}
                  disabled={savingNotes}
                  className="text-xs bg-[#0F4C81] text-white px-3 py-1.5 rounded-lg disabled:opacity-50 hover:bg-[#0d3d69] transition-colors"
                >
                  {savingNotes ? 'Saving…' : 'Save Notes'}
                </button>
              </div>
            ) : (
              <p className="text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-2 min-h-[36px]">
                {stop.deliveryNotes || <span className="text-gray-300">No notes</span>}
              </p>
            )}
          </div>
        </section>

        {/* Failure info */}
        {stop.status === 'failed' && stop.failureReason && (
          <section className="bg-red-50 rounded-2xl border border-red-100 p-5">
            <h2 className="text-sm font-semibold text-red-700 mb-2 flex items-center gap-2">
              <XCircle size={15} /> Failure Details
            </h2>
            <p className="text-sm text-red-800 font-medium">{stop.failureReason}</p>
            {stop.failureNote && <p className="text-sm text-red-600 mt-1">{stop.failureNote}</p>}
          </section>
        )}

        {/* Interactive map */}
        <section className="rounded-2xl overflow-hidden border border-gray-100 relative" style={{ height: 160 }}>
          {stop.lat && stop.lng ? (
            <LeafletMap lat={stop.lat} lng={stop.lng} address={stop.address} />
          ) : (
            <div className="w-full h-full bg-gray-50 flex items-center justify-center">
              <MapPin size={16} className="text-gray-300 mr-2" />
              <span className="text-xs text-gray-400">No coordinates — address only</span>
            </div>
          )}
          <a
            href={mapsHref}
            target="_blank"
            rel="noreferrer"
            className="absolute bottom-2 right-2 z-[400] bg-white/90 backdrop-blur-sm text-xs font-medium text-[#0F4C81] px-2.5 py-1 rounded-lg shadow-sm flex items-center gap-1 hover:bg-white transition-colors"
          >
            <MapPin size={11} /> Open in Maps
          </a>
        </section>

        {/* POD */}
        {(stop.status === 'completed' || stop.pod) && (
          <section className="bg-white rounded-2xl border border-gray-100 p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-2">
                <FileCheck size={15} className="text-emerald-600" /> Proof of Delivery
              </h2>
              {stop.pod && (
                <button
                  onClick={() => setShowPod(v => !v)}
                  className="text-xs text-[#0F4C81] hover:underline"
                >
                  {showPod ? 'Hide' : 'Show'}
                </button>
              )}
            </div>
            {!stop.pod ? (
              <p className="text-sm text-gray-400">No POD on file</p>
            ) : showPod ? (
              <PodViewer pod={{ ...(stop.pod as any), barcodesScanned: stop.barcodesScanned, packageConfirmed: stop.packageConfirmed }} />
            ) : (
              <button
                onClick={() => setShowPod(true)}
                className="w-full text-sm text-[#0F4C81] border border-gray-200 rounded-lg py-2 hover:bg-gray-50 transition-colors"
              >
                View POD
              </button>
            )}
          </section>
        )}

        {/* Actions */}
        <section className="flex flex-wrap gap-3">
          {stop.status === 'failed' && (
            <div className="flex flex-col gap-1.5">
              <button
                onClick={reschedule}
                disabled={rescheduling}
                className="flex items-center gap-2 px-4 py-2 bg-[#0F4C81] text-white rounded-xl text-sm font-medium hover:bg-[#0d3d69] disabled:opacity-50 transition-colors"
              >
                <RotateCcw size={15} /> {rescheduling ? 'Rescheduling…' : 'Reschedule Delivery'}
              </button>
              {rescheduleError && (
                <p className="text-xs text-red-600">{rescheduleError}</p>
              )}
            </div>
          )}
          {stop.routeId && stop.planId && !['completed', 'failed', 'rescheduled'].includes(stop.status) &&
           user && user.role !== 'driver' && user.role !== 'pharmacist' && (
            <button
              onClick={openReassign}
              className="flex items-center gap-2 px-4 py-2 border border-gray-200 text-gray-700 rounded-xl text-sm hover:bg-gray-50 transition-colors"
            >
              <Truck size={15} /> Reassign Driver
            </button>
          )}
          {stop.trackingToken && (
            <a
              href={`/track/${stop.trackingToken}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 px-4 py-2 border border-gray-200 text-gray-700 rounded-xl text-sm hover:bg-gray-50 transition-colors"
            >
              <Flag size={15} /> Tracking Link
            </a>
          )}
          {stop.planId && (
            <Link
              href={`/dashboard/plans/${stop.planId}`}
              className="flex items-center gap-2 px-4 py-2 border border-gray-200 text-gray-700 rounded-xl text-sm hover:bg-gray-50 transition-colors"
            >
              View Route Plan <ChevronRight size={14} />
            </Link>
          )}
        </section>

        {/* Reassign Driver Modal */}
        {showReassign && (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-4" onClick={() => setShowReassign(false)}>
            <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl" onClick={e => e.stopPropagation()}>
              <h3 className="text-base font-semibold text-gray-900 mb-1">Reassign Driver</h3>
              <p className="text-sm text-gray-500 mb-4">Move this stop to a different driver's route</p>
              {planRoutes.length === 0 ? (
                <p className="text-sm text-gray-400 mb-4">No other routes available on this plan.</p>
              ) : (
                <div className="mb-4">
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">Select driver</label>
                  <select
                    value={reassignTargetId}
                    onChange={e => setReassignTargetId(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F4C81]/20"
                  >
                    {planRoutes.map(r => (
                      <option key={r.id} value={r.id}>{r.driverName}</option>
                    ))}
                  </select>
                </div>
              )}
              {reassignError && <p className="text-xs text-red-600 mb-3">{reassignError}</p>}
              <div className="flex gap-2">
                <button
                  onClick={() => setShowReassign(false)}
                  className="flex-1 px-4 py-2 border border-gray-200 text-gray-700 rounded-xl text-sm hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmReassign}
                  disabled={reassigning || planRoutes.length === 0}
                  className="flex-1 px-4 py-2 bg-[#0F4C81] text-white rounded-xl text-sm font-medium hover:bg-[#0d3d69] disabled:opacity-50 transition-colors"
                >
                  {reassigning ? 'Moving…' : 'Reassign'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function StopDetailPage() {
  const { stopId } = useParams<{ stopId: string }>();
  return (
    <Suspense fallback={
      <div className="p-6 space-y-4">
        {[1, 2, 3].map(i => <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />)}
      </div>
    }>
      <StopDetailContent stopId={stopId} />
    </Suspense>
  );
}
