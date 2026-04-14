import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

interface TrackingData {
  stopId: string;
  status: string;
  recipientName: string;
  stopsAhead: number;
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

const STATUS_INFO: Record<string, { label: string; colorClasses: string; desc: string }> = {
  pending: {
    label: 'Preparing',
    colorClasses: 'bg-gray-100 text-gray-600',
    desc: 'Your order is being prepared for dispatch.',
  },
  en_route: {
    label: 'On the Way',
    colorClasses: 'bg-teal-50 text-teal-700',
    desc: 'Your driver is heading your way.',
  },
  arrived: {
    label: 'Arrived',
    colorClasses: 'bg-blue-50 text-blue-700',
    desc: 'Your driver has arrived at your address.',
  },
  completed: {
    label: 'Delivered',
    colorClasses: 'bg-green-50 text-green-700',
    desc: 'Your prescription has been delivered.',
  },
  failed: {
    label: 'Attempted',
    colorClasses: 'bg-red-50 text-red-700',
    desc: "We attempted delivery but couldn't complete it. Please call your pharmacy.",
  },
  rescheduled: {
    label: 'Rescheduled',
    colorClasses: 'bg-amber-50 text-amber-700',
    desc: 'Your delivery has been rescheduled. Your pharmacy will be in touch.',
  },
};

export default async function TrackingPage({
  params,
}: {
  params: { token: string };
}) {
  const data = await getTrackingData(params.token);
  if (!data) notFound();

  const info = STATUS_INFO[data.status] ?? STATUS_INFO.pending;

  return (
    <div className="min-h-screen bg-[#F7F8FC] flex flex-col items-center py-10 px-4">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="text-center mb-8">
          <h1
            className="font-bold text-2xl text-[#0F4C81]"
            style={{ fontFamily: 'var(--font-sora)' }}
          >
            MyDashRx
          </h1>
          <p className="text-gray-400 text-sm mt-1">Prescription Delivery Tracker</p>
        </div>

        {/* Status Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-4">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-gray-500">Hi, {data.recipientName}</p>
            <span
              className={`text-xs px-2.5 py-1 rounded-full font-medium ${info.colorClasses}`}
            >
              {info.label}
            </span>
          </div>

          <p className="text-sm text-gray-700 mb-4">{info.desc}</p>

          {data.status === 'en_route' && data.stopsAhead > 0 && (
            <div className="bg-teal-50 rounded-lg px-3 py-2.5 mb-3">
              <p className="text-sm text-teal-700 font-medium">
                {data.stopsAhead === 1
                  ? "You're next!"
                  : `${data.stopsAhead} stops ahead of you`}
              </p>
            </div>
          )}

          {data.stopsAhead === 0 && data.status === 'en_route' && (
            <div className="bg-blue-50 rounded-lg px-3 py-2.5 mb-3">
              <p className="text-sm text-blue-700 font-medium">Your driver is on the way to you now!</p>
            </div>
          )}

          {data.completedAt && (
            <div className="text-xs text-gray-400 border-t border-gray-50 pt-3 mt-3">
              Delivered at{' '}
              {new Date(data.completedAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-gray-400">
          Questions about your delivery? Contact your pharmacy directly.
        </p>
      </div>
    </div>
  );
}
