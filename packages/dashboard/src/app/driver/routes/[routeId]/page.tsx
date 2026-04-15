'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { ArrowLeft, MapPin, CheckCircle2, XCircle, Clock, Navigation, Play, PartyPopper } from 'lucide-react';

interface Stop {
  id: string; routeId: string; recipientName: string; address: string;
  recipientPhone: string; status: string; sequenceNumber: number | null;
  requiresRefrigeration: boolean; controlledSubstance: boolean;
  requiresSignature: boolean; rxNumbers: string[]; packageCount: number;
  deliveryNotes?: string;
}

const ETA_PER_STOP_MIN = 8;

const statusColor: Record<string, string> = {
  pending: 'text-gray-400',
  en_route: 'text-blue-500',
  arrived: 'text-yellow-500',
  completed: 'text-green-500',
  failed: 'text-red-500',
};

const statusIcon = (s: string) => {
  if (s === 'completed') return <CheckCircle2 size={20} className="text-green-500" />;
  if (s === 'failed') return <XCircle size={20} className="text-red-400" />;
  if (s === 'arrived') return <Clock size={20} className="text-yellow-500" />;
  return <MapPin size={20} className="text-gray-300" />;
};

const statusLabel: Record<string, string> = {
  pending: 'Pending', en_route: 'En Route', arrived: 'Arrived', completed: 'Done', failed: 'Failed',
};

const fmtETA = (remainingStops: number): string => {
  const ms = remainingStops * ETA_PER_STOP_MIN * 60 * 1000;
  const eta = new Date(Date.now() + ms);
  return eta.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

export default function DriverRoutePage({ params }: { params: { routeId: string } }) {
  const router = useRouter();
  const { routeId } = params;
  const [stops, setStops] = useState<Stop[]>([]);
  const [routeStatus, setRouteStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);

  const load = () => {
    api.get<Stop[]>(`/driver/me/routes/${routeId}/stops`)
      .then((data) => { setStops(data); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, []); // eslint-disable-line

  const startRoute = async () => {
    setStarting(true);
    try {
      const r = await api.patch<{ status: string }>(`/driver/me/routes/${routeId}/start`, {});
      setRouteStatus(r.status);
    } finally { setStarting(false); }
  };

  const completed = stops.filter((s) => s.status === 'completed').length;
  const failed = stops.filter((s) => s.status === 'failed').length;
  const remaining = stops.length - completed - failed;
  const allDone = stops.length > 0 && remaining === 0;
  const pct = stops.length > 0 ? Math.round((completed / stops.length) * 100) : 0;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-[#0F4C81] text-white px-5 pt-12 pb-5">
        <button onClick={() => router.back()} className="flex items-center gap-2 text-blue-200 mb-4 text-sm min-h-[44px]">
          <ArrowLeft size={18} /> Back
        </button>
        <h1 className="text-2xl font-bold mb-1">Today&apos;s Route</h1>

        {/* Stop count + ETA */}
        <div className="flex items-center gap-4 text-sm text-blue-200 mt-2 flex-wrap">
          <span className="flex items-center gap-1.5">
            <CheckCircle2 size={14} /> {completed} done
          </span>
          {failed > 0 && (
            <span className="flex items-center gap-1.5 text-red-300">
              <XCircle size={14} /> {failed} failed
            </span>
          )}
          <span className="font-semibold text-white">{remaining} remaining</span>
          {!allDone && remaining > 0 && (
            <span className="flex items-center gap-1 text-blue-200">
              <Clock size={13} /> Est. complete by {fmtETA(remaining)}
            </span>
          )}
        </div>

        {/* Progress bar */}
        <div className="mt-4 bg-blue-800/60 rounded-full h-2.5">
          <div
            className="bg-white h-2.5 rounded-full transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="text-xs text-blue-200 mt-1.5 flex justify-between">
          <span>
            {stops.length > 0
              ? `Stop ${Math.min(completed + 1, stops.length)} of ${stops.length}`
              : ''}
          </span>
          <span>{pct}% complete</span>
        </div>
      </div>

      <div className="px-4 py-4">
        {/* All deliveries complete celebration */}
        {allDone && (
          <div className="bg-green-50 border border-green-200 rounded-2xl p-5 mb-4 text-center">
            <PartyPopper size={32} className="text-green-500 mx-auto mb-2" />
            <p className="font-bold text-green-800 text-lg">All deliveries complete!</p>
            <p className="text-green-600 text-sm mt-1">Great work today.</p>
          </div>
        )}

        {routeStatus !== 'active' && stops.length > 0 && !allDone && (
          <button
            onClick={startRoute}
            disabled={starting}
            className="w-full bg-green-500 text-white py-4 rounded-2xl font-bold text-base flex items-center justify-center gap-2 mb-4 hover:bg-green-600 active:bg-green-700 transition-colors disabled:opacity-50 shadow-lg shadow-green-500/25 min-h-[56px]"
          >
            <Play size={20} /> {starting ? 'Starting…' : 'Start Route'}
          </button>
        )}

        {/* Navigate to Next Stop */}
        {(() => {
          const nextStop = stops.find(s => s.status !== 'completed' && s.status !== 'failed');
          if (!nextStop) return null;
          const mapsUrl = `https://maps.google.com/?q=${encodeURIComponent(nextStop.address)}&dirflg=d`;
          return (
            <a
              href={mapsUrl}
              target="_blank"
              rel="noreferrer"
              className="w-full bg-[#0F4C81] text-white py-4 rounded-2xl font-bold text-base flex items-center justify-center gap-2 mb-4 hover:bg-[#0d3d69] active:bg-[#0b3258] transition-colors shadow-lg shadow-[#0F4C81]/25 min-h-[56px]"
            >
              <MapPin size={20} /> Navigate to Next Stop
            </a>
          );
        })()}

        {loading ? (
          <div className="space-y-2.5">
            {[1, 2, 3].map((i) => <div key={i} className="h-24 bg-white rounded-2xl animate-pulse" />)}
          </div>
        ) : stops.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <MapPin size={36} className="mx-auto mb-3 text-gray-200" />
            <p className="font-medium">No stops assigned yet</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {stops.map((stop, idx) => {
              const stopNum = (stop.sequenceNumber != null ? stop.sequenceNumber + 1 : idx + 1);
              return (
                <button
                  key={stop.id}
                  onClick={() => router.push(`/driver/stops/${stop.id}`)}
                  className={`w-full bg-white rounded-2xl p-4 shadow-sm text-left flex items-start gap-3.5 active:scale-[0.99] transition-all min-h-[80px] ${
                    stop.status === 'completed' ? 'opacity-50' : 'hover:shadow-md'
                  }`}
                >
                  {/* Stop number / status icon */}
                  <div className="shrink-0 flex flex-col items-center gap-1 pt-0.5">
                    {statusIcon(stop.status)}
                    <span className="text-[10px] font-bold text-gray-300">#{stopNum}</span>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <span className="font-bold text-gray-900 text-sm leading-tight">{stop.recipientName}</span>
                      <div className="flex flex-col items-end gap-0.5 shrink-0">
                        <span className={`text-xs font-semibold ${statusColor[stop.status] ?? 'text-gray-400'}`}>
                          {statusLabel[stop.status] ?? stop.status}
                        </span>
                        <span className="text-[10px] text-gray-300">Stop {stopNum} of {stops.length}</span>
                      </div>
                    </div>
                    <p className="text-xs text-gray-400 truncate flex items-center gap-1 mb-1.5">
                      <Navigation size={10} className="shrink-0" /> {stop.address}
                    </p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-gray-400">{stop.packageCount} pkg</span>
                      {stop.rxNumbers?.length > 0 && <span className="text-xs text-gray-400">Rx ×{stop.rxNumbers.length}</span>}
                      {stop.requiresRefrigeration && <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-medium">❄ Cold</span>}
                      {stop.controlledSubstance && <span className="text-xs bg-orange-50 text-orange-600 px-2 py-0.5 rounded-full font-medium">⚠ Ctrl</span>}
                      {stop.requiresSignature && <span className="text-xs bg-purple-50 text-purple-600 px-2 py-0.5 rounded-full font-medium">✍ Sig</span>}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
