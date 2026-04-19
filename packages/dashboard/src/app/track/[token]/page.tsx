'use client';
import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams } from 'next/navigation';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const REFRESH_MS = 30_000;

interface TrackingData {
  stopId: string;
  status: string;
  recipientName: string;
  driverFirstName: string | null;
  routeActive: boolean;
  stopsAhead: number;
  estimatedArrivalAt?: string | null;
  windowStart?: string | null;
  windowEnd?: string | null;
  completedAt?: string | null;
  driverLocation?: { lat: number; lng: number; lastPingAt: string } | null;
}

const TIMELINE_STEPS = [
  { key: 'pending',   label: 'Order Received' },
  { key: 'preparing', label: 'Preparing'       },
  { key: 'en_route',  label: 'Out for Delivery' },
  { key: 'delivered', label: 'Delivered'        },
] as const;

function timelineIndex(status: string) {
  const map: Record<string, number> = { pending: 0, preparing: 1, en_route: 2, arrived: 2, completed: 3, failed: 3, rescheduled: 1 };
  return map[status] ?? 0;
}
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const etaWindow = (iso: string) => {
  const b = new Date(iso);
  return `${fmtTime(new Date(b.getTime() - 15 * 60000).toISOString())} – ${fmtTime(new Date(b.getTime() + 15 * 60000).toISOString())}`;
};
const staticMapUrl = (lat: number, lng: number) => {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!key) return null;
  return `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=14&size=400x160&scale=2&markers=color:0x0F4C81%7C${lat},${lng}&key=${key}&style=feature:poi|visibility:off`;
};

export default function TrackingPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<TrackingData | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loadErr, setLoadErr] = useState(false);
  const [note, setNote] = useState('');
  const [noteSending, setNoteSending] = useState(false);
  const [noteSent, setNoteSent] = useState(false);
  const [noteCooldown, setNoteCooldown] = useState(0); // seconds remaining
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/v1/track/${token}`);
      if (res.status === 404) { setNotFound(true); return; }
      if (!res.ok) { setLoadErr(true); return; }
      setData(await res.json() as TrackingData);
      setLoadErr(false);
    } catch { setLoadErr(true); }
  }, [token]);

  useEffect(() => {
    load();
    // Auto-refresh every 30s while delivery is in progress
    const timer = setInterval(() => { load(); }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const sendNote = async () => {
    if (!note.trim() || noteSending || noteCooldown > 0) return;
    setNoteSending(true);
    try {
      const res = await fetch(`${API}/api/v1/track/${token}/note`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: note.trim() }),
      });
      if (res.ok) {
        setNoteSent(true);
        setNote('');
        // 30s rate-limit cooldown
        setNoteCooldown(30);
        cooldownRef.current = setInterval(() => {
          setNoteCooldown(prev => {
            if (prev <= 1) { clearInterval(cooldownRef.current!); return 0; }
            return prev - 1;
          });
        }, 1000);
      }
    } catch { /* silent — non-critical */ }
    finally { setNoteSending(false); }
  };

  useEffect(() => () => { if (cooldownRef.current) clearInterval(cooldownRef.current); }, []);

  if (notFound) return (
    <div className="min-h-screen bg-[#F7F8FC] flex flex-col items-center py-10 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <h1 className="font-bold text-2xl text-[#0F4C81]">MyDashRx</h1>
          <p className="text-gray-400 text-sm mt-1">Prescription Delivery Tracker</p>
        </div>
        <div className="bg-red-50 border border-red-100 rounded-2xl p-6 text-center">
          <p className="font-semibold text-red-700 mb-2">Tracking link not found</p>
          <p className="text-sm text-gray-600">This link may have expired or is invalid. Contact your pharmacy for updates.</p>
        </div>
      </div>
    </div>
  );

  if (loadErr && !data) return (
    <div className="min-h-screen bg-[#F7F8FC] flex flex-col items-center py-10 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <h1 className="font-bold text-2xl text-[#0F4C81]">MyDashRx</h1>
          <p className="text-gray-400 text-sm mt-1">Prescription Delivery Tracker</p>
        </div>
        <div className="bg-amber-50 border border-amber-100 rounded-2xl p-6 text-center shadow-sm">
          <p className="font-semibold text-amber-800 mb-2">Tracking temporarily unavailable</p>
          <p className="text-sm text-gray-600">Refreshing automatically&hellip;</p>
        </div>
      </div>
    </div>
  );

  if (!data) return (
    <div className="min-h-screen bg-[#F7F8FC] flex items-center justify-center">
      <div className="space-y-3 w-full max-w-sm px-4">
        <div className="h-8 bg-gray-100 rounded-xl animate-pulse mx-auto w-32" />
        <div className="h-48 bg-gray-100 rounded-2xl animate-pulse" />
        <div className="h-32 bg-gray-100 rounded-2xl animate-pulse" />
      </div>
    </div>
  );

  const { status, recipientName, driverFirstName, routeActive, stopsAhead, estimatedArrivalAt, driverLocation, windowStart, windowEnd, completedAt } = data;
  const activeStep = timelineIndex(status);
  const isDelivered = status === 'completed';
  const isFailed = status === 'failed';
  const isRescheduled = status === 'rescheduled';
  const isEnRoute = (status === 'en_route' || status === 'arrived') && routeActive;
  const inProgress = !isDelivered && !isFailed && !isRescheduled;
  const mapUrl = driverLocation ? staticMapUrl(driverLocation.lat, driverLocation.lng) : null;
  const etaIso = estimatedArrivalAt ?? windowEnd ?? windowStart;

  return (
    <div className="min-h-screen bg-[#F7F8FC] flex flex-col items-center py-10 px-4">
      <style>{`
        @keyframes delivered-in { from { opacity:0;transform:scale(0.85); } to { opacity:1;transform:scale(1); } }
        .delivered-anim { animation: delivered-in 0.5s ease-out both; }
        @keyframes pulse-ring { 0%{box-shadow:0 0 0 0 rgba(15,76,129,0.4);} 70%{box-shadow:0 0 0 8px rgba(15,76,129,0);} 100%{box-shadow:0 0 0 0 rgba(15,76,129,0);} }
        .pulse-dot { animation: pulse-ring 1.6s ease-out infinite; }
      `}</style>

      <div className="w-full max-w-sm space-y-4">
        <div className="text-center mb-6">
          <h1 className="font-bold text-2xl text-[#0F4C81]" style={{ fontFamily: 'system-ui' }}>MyDashRx</h1>
          <p className="text-gray-400 text-sm mt-1">Prescription Delivery Tracker</p>
        </div>

        {isDelivered && (
          <div className="delivered-anim bg-green-50 border border-green-100 rounded-2xl p-6 text-center shadow-sm">
            <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-3 shadow-md">
              <svg className="w-9 h-9 text-white" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-xl font-bold text-green-700 mb-1">
              {recipientName ? `${recipientName}, your delivery is complete!` : 'Your delivery is complete!'}
            </p>
            {completedAt && <p className="text-sm text-green-600 mb-3">Delivered at {fmtTime(completedAt)}</p>}
            <p className="text-xs text-gray-500">Questions? Contact your pharmacy directly.</p>
          </div>
        )}

        {isFailed && (
          <div className="bg-red-50 border border-red-100 rounded-2xl p-5 shadow-sm">
            <p className="text-base font-semibold text-red-700 mb-1">Delivery Attempted</p>
            <p className="text-sm text-gray-600">We attempted delivery but could not complete it. Please contact your pharmacy to reschedule.</p>
          </div>
        )}

        {isRescheduled && (
          <div className="bg-amber-50 border border-amber-100 rounded-2xl p-5 shadow-sm">
            <p className="text-base font-semibold text-amber-800 mb-1">Delivery Rescheduled</p>
            <p className="text-sm text-gray-600">Your delivery has been rescheduled. Your pharmacy will contact you with a new delivery window.</p>
          </div>
        )}

        {inProgress && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-sm font-semibold text-gray-800 flex-1">
                {recipientName ? `Hi ${recipientName}!` : 'Your Delivery'}
              </span>
              <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${isEnRoute ? 'bg-teal-50 text-teal-700' : 'bg-gray-100 text-gray-600'}`}>
                {isEnRoute ? 'On the way' : 'Preparing'}
              </span>
            </div>
            {etaIso && (
              <div className="bg-blue-50 rounded-xl px-4 py-3 mb-4">
                <p className="text-xs text-blue-500 font-medium uppercase tracking-wide mb-0.5">Estimated Arrival</p>
                <p className="text-base font-bold text-blue-800">{etaWindow(etaIso)}</p>
              </div>
            )}
            {isEnRoute && stopsAhead > 0 && (
              <div className="text-sm text-teal-700 bg-teal-50 rounded-lg px-3 py-2.5 mb-4">
                {stopsAhead === 1 ? "You're next!" : `${stopsAhead} stops before yours`}
              </div>
            )}
            {isEnRoute && stopsAhead === 0 && (
              <div className="text-sm text-[#0F4C81] bg-blue-50 rounded-lg px-3 py-2.5 mb-4 font-medium">
                Arriving soon!
              </div>
            )}
            <p className="text-xs text-gray-400 text-right">Auto-refreshes every 30s</p>
          </div>
        )}

        {/* Timeline */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-4">Delivery Progress</p>
          <div className="relative">
            <div className="absolute left-[13px] top-3 bottom-3 w-[2px] bg-gray-100" />
            <div className="space-y-5">
              {TIMELINE_STEPS.map((step, i) => {
                const done = i < activeStep, active = i === activeStep, pending = i > activeStep;
                return (
                  <div key={step.key} className="flex items-center gap-3 relative">
                    <div className={`relative z-10 w-7 h-7 rounded-full flex items-center justify-center shrink-0 transition-all ${done ? 'bg-[#0F4C81]' : ''} ${active ? 'bg-[#0F4C81] pulse-dot' : ''} ${pending ? 'bg-white border-2 border-gray-200' : ''}`}>
                      {done && <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                      {active && <div className="w-2.5 h-2.5 bg-white rounded-full" />}
                    </div>
                    <p className={`text-sm ${done || active ? 'text-gray-800 font-semibold' : 'text-gray-400'}`}>{step.label}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Driver card */}
        {isEnRoute && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Your Driver</p>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-[#0F4C81]/10 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-[#0F4C81]" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-800">
                  {driverFirstName ? `${driverFirstName} is on the way` : 'Your driver is on the way'}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {stopsAhead === 0 ? 'Arriving at your address' : `${stopsAhead} stop${stopsAhead === 1 ? '' : 's'} before yours`}
                </p>
              </div>
            </div>
            {mapUrl && (
              <div className="mt-4 rounded-xl overflow-hidden border border-gray-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={mapUrl} alt="Driver location map" className="w-full h-auto" width={400} height={160} />
              </div>
            )}
          </div>
        )}

        {/* P-TRACK1: Leave a note for the driver */}
        {inProgress && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Leave a Note for the Driver</p>
            {noteSent && (
              <div className="bg-green-50 border border-green-100 rounded-xl px-4 py-2.5 mb-3 text-sm text-green-700 font-medium">
                Note sent — your driver will see it!
              </div>
            )}
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="e.g. Leave at the front door, ring twice..."
              maxLength={500}
              rows={3}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 placeholder-gray-400 resize-none focus:outline-none focus:ring-2 focus:ring-[#0F4C81]/30 focus:border-[#0F4C81]"
            />
            <div className="flex items-center justify-between mt-2">
              <span className="text-xs text-gray-400">{note.length}/500</span>
              <button
                onClick={sendNote}
                disabled={!note.trim() || noteSending || noteCooldown > 0}
                className="px-4 py-2 bg-[#0F4C81] text-white text-sm font-medium rounded-xl disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#0a3d6b] transition-colors"
              >
                {noteSending ? 'Sending…' : noteCooldown > 0 ? `Wait ${noteCooldown}s` : 'Send Note'}
              </button>
            </div>
          </div>
        )}

        <p className="text-center text-xs text-gray-400 pt-2">
          Questions about your delivery? Contact your pharmacy directly.
        </p>
      </div>
    </div>
  );
}
