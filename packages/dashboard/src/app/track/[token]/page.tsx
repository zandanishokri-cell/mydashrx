import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

interface TrackingData {
  stopId: string;
  status: string;
  stopsAhead: number;
  estimatedArrivalAt?: string | null;
  windowStart?: string | null;
  windowEnd?: string | null;
  completedAt?: string | null;
  driverLocation?: { lat: number; lng: number; lastPingAt: string } | null;
}

async function getTrackingData(token: string): Promise<TrackingData | null> {
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/api/v1/track/${token}`,
      { next: { revalidate: 30 } },
    );
    if (!res.ok) return null;
    return res.json() as Promise<TrackingData>;
  } catch {
    return null;
  }
}

export async function generateMetadata(): Promise<Metadata> {
  return { title: 'Track Your Delivery — MyDashRx' };
}

// Timeline steps in order
const TIMELINE_STEPS = [
  { key: 'pending',   label: 'Order Received' },
  { key: 'preparing', label: 'Preparing'       },
  { key: 'en_route',  label: 'Out for Delivery' },
  { key: 'delivered', label: 'Delivered'        },
] as const;

// Map DB status → timeline index (0-based)
function timelineIndex(status: string): number {
  const map: Record<string, number> = {
    pending:     0,
    preparing:   1,
    en_route:    2,
    arrived:     2,
    completed:   3,
    failed:      3,
    rescheduled: 1,
  };
  return map[status] ?? 0;
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function etaWindow(iso: string) {
  const base = new Date(iso);
  const lo = new Date(base.getTime() - 15 * 60 * 1000);
  const hi = new Date(base.getTime() + 15 * 60 * 1000);
  return `${fmtTime(lo.toISOString())} – ${fmtTime(hi.toISOString())}`;
}

function staticMapUrl(lat: number, lng: number) {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!key) return null;
  return `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=14&size=400x160&scale=2&markers=color:0x0F4C81%7C${lat},${lng}&key=${key}&style=feature:poi|visibility:off`;
}

export default async function TrackingPage({ params }: { params: { token: string } }) {
  const data = await getTrackingData(params.token);
  if (!data) notFound();

  const { status, stopsAhead, estimatedArrivalAt, driverLocation, windowStart, windowEnd, completedAt } = data;
  const activeStep = timelineIndex(status);
  const isDelivered = status === 'completed';
  const isFailed = status === 'failed';
  const isEnRoute = status === 'en_route' || status === 'arrived';
  const mapUrl = driverLocation ? staticMapUrl(driverLocation.lat, driverLocation.lng) : null;

  // Dynamic ETA from stops-ahead calc; fall back to scheduled window if not available
  const etaIso = estimatedArrivalAt ?? windowEnd ?? windowStart;

  return (
    <div className="min-h-screen bg-[#F7F8FC] flex flex-col items-center py-10 px-4">
      <style>{`
        @keyframes delivered-in {
          from { opacity: 0; transform: scale(0.85); }
          to   { opacity: 1; transform: scale(1); }
        }
        .delivered-anim { animation: delivered-in 0.5s ease-out both; }
        @keyframes pulse-ring {
          0%   { box-shadow: 0 0 0 0 rgba(15,76,129,0.4); }
          70%  { box-shadow: 0 0 0 8px rgba(15,76,129,0); }
          100% { box-shadow: 0 0 0 0 rgba(15,76,129,0); }
        }
        .pulse-dot { animation: pulse-ring 1.6s ease-out infinite; }
      `}</style>

      <div className="w-full max-w-sm space-y-4">

        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="font-bold text-2xl text-[#0F4C81]" style={{ fontFamily: 'var(--font-sora)' }}>
            MyDashRx
          </h1>
          <p className="text-gray-400 text-sm mt-1">Prescription Delivery Tracker</p>
        </div>

        {/* ── DELIVERED STATE ── */}
        {isDelivered && (
          <div className="delivered-anim bg-green-50 border border-green-100 rounded-2xl p-6 text-center shadow-sm">
            <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-3 shadow-md">
              <svg className="w-9 h-9 text-white" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-xl font-bold text-green-700 mb-1">Your delivery is complete!</p>
            {completedAt && (
              <p className="text-sm text-green-600 mb-3">
                Delivered at {fmtTime(completedAt)}
              </p>
            )}
            <p className="text-xs text-gray-500">Questions? Call your pharmacy directly.</p>
          </div>
        )}

        {/* ── FAILED STATE ── */}
        {isFailed && (
          <div className="bg-red-50 border border-red-100 rounded-2xl p-5 shadow-sm">
            <p className="text-base font-semibold text-red-700 mb-1">Delivery Attempted</p>
            <p className="text-sm text-gray-600">We attempted delivery but could not complete it. Please contact your pharmacy to reschedule.</p>
          </div>
        )}

        {/* ── IN-PROGRESS STATUS CARD ── */}
        {!isDelivered && !isFailed && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-sm font-semibold text-gray-800 flex-1">Your Delivery</span>
              {isEnRoute && (
                <span className="text-xs bg-teal-50 text-teal-700 px-2.5 py-1 rounded-full font-medium">On the way</span>
              )}
              {status === 'pending' && (
                <span className="text-xs bg-gray-100 text-gray-600 px-2.5 py-1 rounded-full font-medium">Preparing</span>
              )}
            </div>

            {/* ETA */}
            {etaIso && !isDelivered && (
              <div className="bg-blue-50 rounded-xl px-4 py-3 mb-4">
                <p className="text-xs text-blue-500 font-medium uppercase tracking-wide mb-0.5">Estimated Arrival</p>
                <p className="text-base font-bold text-blue-800">{etaWindow(etaIso)}</p>
              </div>
            )}

            {/* Stops ahead indicator */}
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
          </div>
        )}

        {/* ── TIMELINE ── */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-4">Delivery Progress</p>
          <div className="relative">
            {/* Vertical connector line */}
            <div className="absolute left-[13px] top-3 bottom-3 w-[2px] bg-gray-100" />

            <div className="space-y-5">
              {TIMELINE_STEPS.map((step, i) => {
                const done    = i < activeStep;
                const active  = i === activeStep;
                const pending = i > activeStep;
                return (
                  <div key={step.key} className="flex items-center gap-3 relative">
                    {/* Step dot */}
                    <div className={`relative z-10 w-7 h-7 rounded-full flex items-center justify-center shrink-0 transition-all
                      ${done    ? 'bg-[#0F4C81]' : ''}
                      ${active  ? 'bg-[#0F4C81] pulse-dot' : ''}
                      ${pending ? 'bg-white border-2 border-gray-200' : ''}
                    `}>
                      {done && (
                        <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                      {active && <div className="w-2.5 h-2.5 bg-white rounded-full" />}
                    </div>
                    <p className={`text-sm ${done || active ? 'text-gray-800 font-semibold' : 'text-gray-400'}`}>
                      {step.label}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── DRIVER CARD (en_route / arrived) ── */}
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
                <p className="text-sm font-semibold text-gray-800">Your driver is on the way</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {stopsAhead === 0 ? 'Arriving at your address' : `${stopsAhead} stop${stopsAhead === 1 ? '' : 's'} before yours`}
                </p>
              </div>
            </div>

            {/* Static map if driver location available */}
            {mapUrl && (
              <div className="mt-4 rounded-xl overflow-hidden border border-gray-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={mapUrl}
                  alt="Driver location map"
                  className="w-full h-auto"
                  width={400}
                  height={160}
                />
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <p className="text-center text-xs text-gray-400 pt-2">
          Questions about your delivery? Contact your pharmacy directly.
        </p>
      </div>
    </div>
  );
}
