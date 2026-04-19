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
  ArrowLeft, Phone, Mail, MapPin, Package, Thermometer, AlertTriangle,
  PenLine, Clock, CheckCircle2, XCircle, Truck, User, FileCheck,
  Flag, RotateCcw, FileEdit, ChevronRight, AlertCircle, X, MessageSquare, StickyNote, Send, Trash2,
} from 'lucide-react';
import Link from 'next/link';

interface TimelineEvent { event: string; timestamp: string | null; meta?: string; }

interface StopDetail {
  id: string;
  recipientName: string;
  recipientPhone: string;
  recipientEmail?: string;
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
  priority: string;
  notifications?: NotificationLog[];
}

interface NotificationLog {
  id: string;
  event: string;
  channel: string;
  recipient: string;
  status: string;
  sentAt: string;
}

interface StopNote {
  id: string;
  body: string;
  authorName: string;
  visibleToDriver: boolean;
  createdAt: string;
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

const EVENT_LABELS: Record<string, string> = {
  route_dispatched: 'Route Dispatched',
  stop_arrived: 'Driver Arrived',
  stop_completed: 'Delivery Confirmed',
  stop_failed: 'Failed Delivery',
  stop_rescheduled: 'Delivery Rescheduled',
};

function maskPhone(phone: string): string {
  if (!phone) return '—';
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits[0] === '1') {
    return `(${digits.slice(1,4)}) ***-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0,3)}) ***-${digits.slice(6)}`;
  }
  return phone.slice(0, 4) + '***' + phone.slice(-2);
}

function StopDetailContent({ stopId }: { stopId: string }) {
  const router = useRouter();
  const user = getUser();
  const [stop, setStop] = useState<StopDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [saveNotesError, setSaveNotesError] = useState('');
  const [rescheduling, setRescheduling] = useState(false);
  const [rescheduleError, setRescheduleError] = useState<string | null>(null);
  const [showPod, setShowPod] = useState(false);
  const [showReassign, setShowReassign] = useState(false);
  const [priorityError, setPriorityError] = useState('');
  const [planRoutes, setPlanRoutes] = useState<{ id: string; driverId: string; driverName: string }[]>([]);
  const [reassignTargetId, setReassignTargetId] = useState('');
  const [reassigning, setReassigning] = useState(false);
  const [reassignError, setReassignError] = useState<string | null>(null);
  const [openReassignError, setOpenReassignError] = useState('');
  const [showAssign, setShowAssign] = useState(false);
  const [assignRoutes, setAssignRoutes] = useState<{ id: string; driverName: string | null; planDate: string | null; depotName: string | null; stopCount: number }[]>([]);
  const [assignTargetId, setAssignTargetId] = useState('');
  const [assignLoading, setAssignLoading] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState('');
  // P-DISP1: dispatcher notes
  const [dispNotes, setDispNotes] = useState<StopNote[]>([]);
  const [dispNoteBody, setDispNoteBody] = useState('');
  const [dispNoteVisible, setDispNoteVisible] = useState(true);
  const [addingNote, setAddingNote] = useState(false);
  const [noteError, setNoteError] = useState('');
  // P-DISP3: retry failed stop
  const [showRetry, setShowRetry] = useState(false);
  const [retryRoutes, setRetryRoutes] = useState<{ id: string; driverName: string | null; planDate: string | null; stopCount: number }[]>([]);
  const [retryTargetId, setRetryTargetId] = useState('');
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState('');
  const [retryLoadingRoutes, setRetryLoadingRoutes] = useState(false);

  const loadDispNotes = useCallback(async () => {
    if (!user) return;
    api.get<StopNote[]>(`/orgs/${user.orgId}/stops/${stopId}/notes`)
      .then(notes => setDispNotes(notes ?? []))
      .catch(() => {});
  }, [stopId, user]);

  const load = useCallback(async () => {
    if (!user) return;
    setLoadError(false);
    try {
      const data = await api.get<StopDetail>(`/orgs/${user.orgId}/stops/${stopId}`);
      setStop(data);
      setNotesValue(data.deliveryNotes ?? '');
    } catch (err: unknown) {
      if (err instanceof Error && err.message.startsWith('API 404')) setNotFound(true);
      else setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [stopId, user]);

  useEffect(() => { load(); loadDispNotes(); }, [load, loadDispNotes]);

  const addDispNote = async () => {
    if (!user || !dispNoteBody.trim()) return;
    setAddingNote(true); setNoteError('');
    try {
      const note = await api.post<StopNote>(`/orgs/${user.orgId}/stops/${stopId}/notes`, {
        body: dispNoteBody.trim(), visibleToDriver: dispNoteVisible,
      });
      setDispNotes(n => [note, ...n]);
      setDispNoteBody('');
    } catch { setNoteError('Failed to add note'); }
    finally { setAddingNote(false); }
  };

  const deleteDispNote = async (noteId: string) => {
    if (!user) return;
    await api.del(`/orgs/${user.orgId}/stops/${stopId}/notes/${noteId}`)
      .then(() => setDispNotes(n => n.filter(x => x.id !== noteId)))
      .catch(() => {});
  };

  const openRetry = async () => {
    if (!user) return;
    setRetryLoadingRoutes(true); setRetryError('');
    try {
      const data = await api.get<{ routes: { id: string; driverName: string | null; planDate: string | null; depotName: string | null; stopCount: number }[] }>(`/orgs/${user.orgId}/routes`);
      setRetryRoutes(data.routes ?? []);
      setRetryTargetId(data.routes?.[0]?.id ?? '');
      setShowRetry(true);
    } catch { setRetryError('Failed to load routes'); }
    finally { setRetryLoadingRoutes(false); }
  };

  const confirmRetry = async () => {
    if (!stop || !user) return;
    setRetrying(true); setRetryError('');
    try {
      const newStop = await api.post<{ id: string }>(`/orgs/${user.orgId}/stops/${stop.id}/retry`, {
        targetRouteId: retryTargetId || undefined,
      });
      setShowRetry(false);
      router.push(`/dashboard/stops/${newStop.id}`);
    } catch { setRetryError('Failed to create retry stop. Please try again.'); }
    finally { setRetrying(false); }
  };

  const saveNotes = async () => {
    if (!stop || !user || !stop.routeId) return;
    setSavingNotes(true); setSaveNotesError('');
    try {
      await api.patch(`/routes/${stop.routeId}/stops/${stop.id}`, { deliveryNotes: notesValue });
      setStop(s => s ? { ...s, deliveryNotes: notesValue } : s);
      setEditingNotes(false);
    } catch { setSaveNotesError('Failed to save notes. Please try again.'); }
    finally { setSavingNotes(false); }
  };

  const reschedule = async () => {
    if (!stop || !user || !stop.routeId) return;
    setRescheduling(true);
    setRescheduleError(null);
    try {
      await api.patch(`/routes/${stop.routeId}/stops/${stop.id}/status`, { status: 'rescheduled' });
      await load();
    } catch {
      setRescheduleError('Failed to reschedule. Please try again.');
    } finally { setRescheduling(false); }
  };

  const openReassign = async () => {
    if (!stop?.planId || !user) return;
    setOpenReassignError('');
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
    } catch { setOpenReassignError('Failed to load routes. Please try again.'); }
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

  const openAssign = async () => {
    if (!user) return;
    setAssignLoading(true); setAssignError('');
    try {
      const data = await api.get<{ routes: { id: string; driverName: string | null; planDate: string | null; depotName: string | null; stopCount: number }[] }>(`/orgs/${user.orgId}/routes`);
      setAssignRoutes(data.routes ?? []);
      setAssignTargetId(data.routes?.[0]?.id ?? '');
      setShowAssign(true);
    } catch { setAssignError('Failed to load routes. Please try again.'); }
    finally { setAssignLoading(false); }
  };

  const confirmAssign = async () => {
    if (!stop || !assignTargetId || !user) return;
    setAssigning(true); setAssignError('');
    try {
      await api.post(`/orgs/${user.orgId}/stops/bulk-reassign`, { stopIds: [stop.id], targetRouteId: assignTargetId });
      await load();
      setShowAssign(false);
    } catch {
      setAssignError('Failed to assign route. Please try again.');
    } finally { setAssigning(false); }
  };

  if (loading) return (
    <div className="p-6 space-y-4">
      {[1, 2, 3].map(i => <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />)}
    </div>
  );

  if (loadError) return (
    <div className="p-6 text-center text-gray-400">
      <AlertCircle size={24} className="mx-auto mb-2 text-amber-400" />
      <p className="text-base font-medium text-gray-700">Couldn&apos;t load stop details</p>
      <p className="text-sm text-gray-400 mt-1 mb-3">There was a problem connecting to the server.</p>
      <button onClick={load} className="text-sm text-[#0F4C81] hover:underline">
        Retry
      </button>
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
            {stop.recipientEmail && (
              <div className="flex items-center gap-2 text-gray-600 col-span-2">
                <Mail size={14} className="shrink-0 text-gray-400" />
                <span className="truncate">{stop.recipientEmail}</span>
              </div>
            )}
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

          {/* Priority */}
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Priority</span>
                <select
                  value={stop.priority}
                  onChange={async e => {
                    const newPriority = e.target.value;
                    setPriorityError('');
                    try {
                      await api.patch(`/orgs/${user!.orgId}/stops/${stopId}`, { priority: newPriority });
                      setStop(prev => prev ? { ...prev, priority: newPriority } : prev);
                    } catch {
                      setPriorityError('Failed to save priority');
                    }
                  }}
                  className="text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[#0F4C81]/30"
                >
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
              {priorityError && <p className="text-xs text-red-500 mt-1">{priorityError}</p>}

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
                {saveNotesError && (
                  <p className="text-xs text-red-500 flex items-center gap-1"><AlertCircle size={12} />{saveNotesError}</p>
                )}
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

        {/* P-DISP1: Dispatcher Notes — eliminates out-of-band PHI on Signal/SMS */}
        {user && ['dispatcher', 'pharmacy_admin', 'super_admin', 'pharmacist'].includes(user.role) && (
          <section className="bg-amber-50 rounded-2xl border border-amber-100 p-5">
            <h2 className="text-sm font-semibold text-amber-800 uppercase tracking-wide flex items-center gap-2 mb-4">
              <StickyNote size={14} className="text-amber-600" />
              Dispatcher Notes
              {dispNotes.length > 0 && (
                <span className="ml-auto bg-amber-200 text-amber-800 text-xs font-bold px-2 py-0.5 rounded-full">{dispNotes.length}</span>
              )}
            </h2>
            {/* Existing notes */}
            {dispNotes.length > 0 && (
              <div className="space-y-2 mb-4">
                {dispNotes.map(n => (
                  <div key={n.id} className="bg-white rounded-xl border border-amber-100 px-3 py-2.5 flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-800">{n.body}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-gray-400">{n.authorName} · {new Date(n.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                        {n.visibleToDriver && (
                          <span className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded-full">Driver visible</span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => deleteDispNote(n.id)}
                      className="p-1 text-gray-300 hover:text-red-400 transition-colors shrink-0"
                      title="Delete note"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {/* Add note form */}
            <div className="space-y-2">
              <textarea
                value={dispNoteBody}
                onChange={e => setDispNoteBody(e.target.value)}
                placeholder="Add a note for this stop (patient instructions, access codes, etc.)…"
                rows={2}
                className="w-full border border-amber-200 bg-white rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-200 placeholder-gray-300"
              />
              <div className="flex items-center justify-between gap-3">
                <label className="flex items-center gap-1.5 text-xs text-amber-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={dispNoteVisible}
                    onChange={e => setDispNoteVisible(e.target.checked)}
                    className="accent-amber-500"
                  />
                  Visible to driver
                </label>
                <button
                  onClick={addDispNote}
                  disabled={addingNote || !dispNoteBody.trim()}
                  className="flex items-center gap-1.5 text-xs bg-amber-600 text-white px-3 py-1.5 rounded-lg disabled:opacity-40 hover:bg-amber-700 transition-colors"
                >
                  <Send size={11} /> {addingNote ? 'Adding…' : 'Add Note'}
                </button>
              </div>
              {noteError && <p className="text-xs text-red-500">{noteError}</p>}
            </div>
          </section>
        )}

        {stop.notifications && stop.notifications.length > 0 && (
          <section className="bg-white rounded-2xl border border-gray-100 p-5">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-2 mb-4">
              <MessageSquare size={14} />
              Patient Notifications
            </h2>
            <div className="space-y-2">
              {stop.notifications.map(n => (
                <div key={n.id} className="flex items-center justify-between gap-3 py-2 border-b border-gray-50 last:border-0">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className={`shrink-0 w-2 h-2 rounded-full ${n.status === 'sent' ? 'bg-emerald-400' : 'bg-red-400'}`} aria-label={n.status} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800">{EVENT_LABELS[n.event] ?? n.event}</p>
                      <p className="text-xs text-gray-400">
                        {n.channel === 'sms' ? 'SMS' : 'Email'} → {n.channel === 'sms' ? maskPhone(n.recipient) : n.recipient.split('@')[0] + '@***'}
                      </p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${n.status === 'sent' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                      {n.status === 'sent' ? 'Sent' : 'Failed'}
                    </span>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {new Date(n.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
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
          {stop.status === 'failed' && user && ['dispatcher', 'pharmacy_admin', 'super_admin'].includes(user.role) && (
            <div className="flex flex-col gap-1.5">
              <button
                onClick={openRetry}
                disabled={retryLoadingRoutes}
                className="flex items-center gap-2 px-4 py-2 border border-orange-200 text-orange-700 rounded-xl text-sm font-medium hover:bg-orange-50 disabled:opacity-50 transition-colors"
              >
                <RotateCcw size={15} /> {retryLoadingRoutes ? 'Loading…' : 'Create Retry Stop'}
              </button>
              {retryError && !showRetry && <p className="text-xs text-red-600">{retryError}</p>}
            </div>
          )}
          {!stop.routeId && !['completed', 'failed', 'rescheduled'].includes(stop.status) &&
           user && user.role !== 'driver' && user.role !== 'pharmacist' && (
            <>
              <button
                onClick={openAssign}
                disabled={assignLoading}
                className="flex items-center gap-2 px-4 py-2 bg-[#0F4C81] text-white rounded-xl text-sm font-medium hover:bg-[#0d3d69] disabled:opacity-50 transition-colors"
              >
                <Truck size={15} /> {assignLoading ? 'Loading routes…' : 'Assign to Route'}
              </button>
              {assignError && !showAssign && (
                <p className="text-xs text-red-500 flex items-center gap-1"><AlertCircle size={12} />{assignError}</p>
              )}
            </>
          )}
          {stop.routeId && stop.planId && !['completed', 'failed', 'rescheduled'].includes(stop.status) &&
           user && user.role !== 'driver' && user.role !== 'pharmacist' && (
            <>
              <button
                onClick={openReassign}
                className="flex items-center gap-2 px-4 py-2 border border-gray-200 text-gray-700 rounded-xl text-sm hover:bg-gray-50 transition-colors"
              >
                <Truck size={15} /> Reassign Driver
              </button>
              {openReassignError && (
                <p className="text-xs text-red-500 flex items-center gap-1"><AlertCircle size={12} />{openReassignError}</p>
              )}
            </>
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

        {/* Assign to Route Modal */}
        {showAssign && (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-4" onClick={() => { setShowAssign(false); setAssignError(''); }}>
            <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-base font-semibold text-gray-900">Assign to Route</h3>
                <button onClick={() => { setShowAssign(false); setAssignError(''); }} className="p-1 text-gray-400 hover:text-gray-600"><X size={16} /></button>
              </div>
              <p className="text-sm text-gray-500 mb-4">Select a route to add this stop to</p>
              {assignRoutes.length === 0 ? (
                <p className="text-sm text-gray-400 mb-4">No active routes available. Create a route plan first.</p>
              ) : (
                <div className="mb-4 space-y-2 max-h-64 overflow-y-auto">
                  {assignRoutes.map(r => (
                    <button
                      key={r.id}
                      onClick={() => setAssignTargetId(r.id)}
                      className={`w-full text-left px-3 py-2.5 rounded-xl border text-sm transition-colors ${
                        assignTargetId === r.id
                          ? 'border-[#0F4C81] bg-blue-50 text-[#0F4C81]'
                          : 'border-gray-200 hover:bg-gray-50 text-gray-700'
                      }`}
                    >
                      <div className="font-medium">{r.driverName ?? 'Unassigned driver'}</div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        {r.planDate ?? 'No date'} · {r.depotName ?? 'No depot'} · {r.stopCount} stop{r.stopCount !== 1 ? 's' : ''}
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {assignError && <p className="text-xs text-red-600 mb-3 flex items-center gap-1"><AlertCircle size={12} />{assignError}</p>}
              <div className="flex gap-2">
                <button onClick={() => { setShowAssign(false); setAssignError(''); }}
                  className="flex-1 px-4 py-2 border border-gray-200 text-gray-700 rounded-xl text-sm hover:bg-gray-50">
                  Cancel
                </button>
                <button
                  onClick={confirmAssign}
                  disabled={assigning || !assignTargetId || assignRoutes.length === 0}
                  className="flex-1 px-4 py-2 bg-[#0F4C81] text-white rounded-xl text-sm font-medium hover:bg-[#0d3d69] disabled:opacity-50 transition-colors"
                >
                  {assigning ? 'Assigning…' : 'Assign'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* P-DISP3: Retry Stop Modal */}
        {showRetry && stop && (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-4" onClick={() => setShowRetry(false)}>
            <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-base font-semibold text-gray-900">Create Retry Stop</h3>
                <button onClick={() => setShowRetry(false)} className="p-1 text-gray-400 hover:text-gray-600"><X size={16} /></button>
              </div>
              <p className="text-sm text-gray-500 mb-1">A new pending stop will be created copying all fields from this failed stop.</p>
              {stop.controlledSubstance && (
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-3">
                  <AlertTriangle size={13} className="text-amber-600 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-800">Controlled substance — chain-of-custody will be logged to HIPAA audit trail.</p>
                </div>
              )}
              <div className="mb-4">
                <p className="text-xs font-medium text-gray-700 mb-1">Recipient: <span className="font-normal">{stop.recipientName}</span></p>
                <p className="text-xs font-medium text-gray-700 mb-3">Address: <span className="font-normal">{stop.address}</span></p>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Assign to route (optional)</label>
                {retryRoutes.length === 0 ? (
                  <p className="text-xs text-gray-400">No active routes — stop will be created unassigned.</p>
                ) : (
                  <select
                    value={retryTargetId}
                    onChange={e => setRetryTargetId(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F4C81]/20"
                  >
                    <option value="">No route — unassigned</option>
                    {retryRoutes.map(r => (
                      <option key={r.id} value={r.id}>
                        {r.driverName ?? 'Unassigned'} · {r.planDate ?? 'No date'} · {r.stopCount} stops
                      </option>
                    ))}
                  </select>
                )}
              </div>
              {retryError && <p className="text-xs text-red-600 mb-3 flex items-center gap-1"><AlertCircle size={12} />{retryError}</p>}
              <div className="flex gap-2">
                <button onClick={() => setShowRetry(false)} className="flex-1 px-4 py-2 border border-gray-200 text-gray-700 rounded-xl text-sm hover:bg-gray-50">Cancel</button>
                <button
                  onClick={confirmRetry}
                  disabled={retrying}
                  className="flex-1 px-4 py-2 bg-orange-600 text-white rounded-xl text-sm font-medium hover:bg-orange-700 disabled:opacity-50 transition-colors"
                >
                  {retrying ? 'Creating…' : 'Create Retry Stop'}
                </button>
              </div>
            </div>
          </div>
        )}

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
