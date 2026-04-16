'use client';
import { useEffect, useState, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { Badge } from '@/components/ui/Badge';
import { RefreshCw, AlertTriangle, Clock, WifiOff } from 'lucide-react';

const LiveMap = dynamic(() => import('@/components/LiveMap').then((m) => m.LiveMap), { ssr: false });

interface NextStop {
  stopId: string;
  address: string;
  recipientName: string;
  status: string;
}

interface RouteStopResponse {
  stopId: string;
  lat: number | null;
  lng: number | null;
  recipientName: string;
  address: string;
  status: string;
  sequenceNumber: number | null;
}

interface StopMarker {
  id: string;
  lat: number;
  lng: number;
  recipientName: string;
  address: string;
  status: string;
  sequenceNumber: number | null;
}

interface ActiveRoute {
  routeId: string;
  driverId: string;
  driverName: string;
  driverPhone: string;
  status: string;
  currentLat: number | null;
  currentLng: number | null;
  lastPingAt: string | null;
  stopsTotal: number;
  stopsCompleted: number;
  stopsPending: number;
  nextStop: NextStop | null;
  estimatedCompletion: string;
}

interface LiveData {
  activeRoutes: ActiveRoute[];
  summary: { activeDrivers: number; totalStopsRemaining: number; completedToday: number };
}

const timeAgo = (iso: string | null): string => {
  if (!iso) return 'never';
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
};

const isStale = (iso: string | null) =>
  iso ? Date.now() - new Date(iso).getTime() > 5 * 60 * 1000 : false;

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export default function MapPage() {
  const [user] = useState(getUser);
  const [liveData, setLiveData] = useState<LiveData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [secondsAgo, setSecondsAgo] = useState(0);
  const [highlightedDriverId, setHighlightedDriverId] = useState<string | null>(null);
  const [routeStops, setRouteStops] = useState<StopMarker[]>([]);
  const [stopsLoading, setStopsLoading] = useState(false);
  const [stopsError, setStopsError] = useState(false);
  const lastFetchedRouteIdRef = useRef<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const data = await api.get<LiveData>(`/orgs/${user.orgId}/tracking/live`);
      setLiveData(data);
      setError(false);
      setLastRefresh(new Date());
      setSecondsAgo(0);
    } catch (err) {
      console.error(err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    load();
    intervalRef.current = setInterval(load, 15000);
    tickRef.current = setInterval(() => setSecondsAgo((s) => s + 1), 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [load]);

  // Fetch stop pins only when the highlighted route actually changes — not on every 15s poll
  useEffect(() => {
    if (!highlightedDriverId || !user || !liveData) {
      setRouteStops([]); setStopsError(false); lastFetchedRouteIdRef.current = null; return;
    }
    const route = liveData.activeRoutes.find((r) => r.driverId === highlightedDriverId);
    if (!route) { setRouteStops([]); lastFetchedRouteIdRef.current = null; return; }
    // Skip re-fetch if same route — liveData updates every 15s, route stops rarely change
    if (lastFetchedRouteIdRef.current === route.routeId) return;
    lastFetchedRouteIdRef.current = route.routeId;
    setStopsLoading(true); setStopsError(false);
    api.get<{ stops: RouteStopResponse[] }>(`/orgs/${user.orgId}/tracking/route/${route.routeId}`)
      .then((data) => setRouteStops(
        data.stops
          .filter((s) => s.lat != null && s.lng != null)
          .map((s) => ({ id: s.stopId, lat: s.lat!, lng: s.lng!, recipientName: s.recipientName, address: s.address, status: s.status, sequenceNumber: s.sequenceNumber }))
      ))
      .catch(() => { setRouteStops([]); setStopsError(true); })
      .finally(() => setStopsLoading(false));
  }, [highlightedDriverId, liveData, user]);

  const driverMarkers = (liveData?.activeRoutes ?? [])
    .filter((r) => r.currentLat && r.currentLng)
    .map((r) => ({
      id: r.driverId,
      name: r.driverName,
      lat: r.currentLat!,
      lng: r.currentLng!,
      status: r.status,
    }));

  const { summary } = liveData ?? { summary: { activeDrivers: 0, totalStopsRemaining: 0, completedToday: 0 } };

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 bg-white shrink-0">
        <div className="flex items-center gap-6">
          <h1 className="font-bold text-gray-900" style={{ fontFamily: 'var(--font-sora)' }}>Live Map</h1>
          <div className="flex items-center gap-4 text-sm text-gray-500">
            <span><strong className="text-[#0F4C81]">{summary.activeDrivers}</strong> active drivers</span>
            <span><strong className="text-[#10b981]">{summary.completedToday}</strong> completed</span>
            <span><strong className="text-gray-500">{summary.totalStopsRemaining}</strong> remaining</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400 flex items-center gap-1">
            <Clock size={11} /> {secondsAgo < 5 ? 'Just updated' : `${secondsAgo}s ago`}
          </span>
          <button onClick={load} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors" title="Refresh">
            <RefreshCw size={14} className="text-gray-500" />
          </button>
        </div>
      </div>

      {/* Error banners — two states: no data yet (red) vs stale data (amber) */}
      {error && !liveData && (
        <div className="flex items-center gap-2 px-5 py-2.5 bg-red-50 border-b border-red-100 shrink-0">
          <WifiOff size={14} className="text-red-500 shrink-0" />
          <span className="text-sm text-red-700">Could not load live tracking data.</span>
          <button onClick={load} className="ml-auto text-xs font-medium text-red-600 hover:underline">Retry</button>
        </div>
      )}
      {error && liveData && (
        <div className="flex items-center gap-2 px-5 py-2.5 bg-amber-50 border-b border-amber-100 shrink-0">
          <AlertTriangle size={14} className="text-amber-500 shrink-0" />
          <span className="text-sm text-amber-700">Refresh failed — showing last known positions.</span>
          <button onClick={load} className="ml-auto text-xs font-medium text-amber-600 hover:underline">Retry</button>
        </div>
      )}

      <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
        {/* Map */}
        <div className="flex-1 relative min-h-[280px]">
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-50">
              <div className="text-gray-400 text-sm">Loading map…</div>
            </div>
          ) : (
            <LiveMap
              drivers={driverMarkers}
              stops={routeStops}
              highlightedDriverId={highlightedDriverId}
              onMarkerClick={(id) => setHighlightedDriverId((prev) => (prev === id ? null : id))}
            />
          )}
        </div>

        {/* Sidebar */}
        <div className="w-full md:w-72 bg-white border-t md:border-t-0 md:border-l border-gray-100 overflow-y-auto shrink-0 max-h-60 md:max-h-none">
          <div className="px-4 py-3 border-b border-gray-50 flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Active Routes</p>
            {stopsLoading && <span className="text-xs text-gray-400 animate-pulse">Loading stops…</span>}
            {stopsError && !stopsLoading && (
              <span className="text-xs text-amber-600 flex items-center gap-1">
                <AlertTriangle size={10} /> Stops unavailable
              </span>
            )}
          </div>

          {(liveData?.activeRoutes ?? []).length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-gray-400">No active routes</div>
          ) : (
            <div className="divide-y divide-gray-50">
              {(liveData?.activeRoutes ?? []).map((r) => {
                const stale = isStale(r.lastPingAt);
                const selected = highlightedDriverId === r.driverId;
                return (
                  <button
                    key={r.routeId}
                    onClick={() => setHighlightedDriverId((prev) => (prev === r.driverId ? null : r.driverId))}
                    className={`w-full text-left px-4 py-3 transition-colors hover:bg-gray-50 ${
                      selected ? 'bg-blue-50 border-l-2 border-[#0F4C81]' : ''
                    } ${stale ? 'border-l-2 border-amber-400' : ''}`}
                  >
                    {/* Driver header */}
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-7 h-7 rounded-full flex items-center justify-center text-white font-bold text-xs shrink-0"
                          style={{ background: selected ? '#0F4C81' : '#64748b' }}
                        >
                          {r.driverName.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase()}
                        </div>
                        <span className="text-xs font-semibold text-gray-900">{r.driverName}</span>
                      </div>
                      {stale && (
                        <span title="No ping in 5+ min">
                          <AlertTriangle size={13} className="text-amber-500" />
                        </span>
                      )}
                    </div>

                    {/* Progress */}
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                        <div
                          className="bg-[#0F4C81] h-1.5 rounded-full transition-all"
                          style={{ width: `${r.stopsTotal > 0 ? (r.stopsCompleted / r.stopsTotal) * 100 : 0}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-500 shrink-0">
                        {r.stopsCompleted}/{r.stopsTotal}
                      </span>
                    </div>

                    {/* Next stop */}
                    {r.nextStop && (
                      <p className="text-xs text-gray-500 truncate mb-1">
                        <span className="text-gray-400">Next:</span> {r.nextStop.address}
                      </p>
                    )}
                    {!r.nextStop && r.stopsPending === 0 && (
                      <p className="text-xs text-green-600 font-medium mb-1">All stops complete</p>
                    )}

                    {/* Footer */}
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-400">{timeAgo(r.lastPingAt)}</span>
                      <span className="text-xs text-gray-400">Est. {fmtTime(r.estimatedCompletion)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Legend */}
          <div className="px-4 py-3 border-t border-gray-50 mt-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Legend</p>
            <div className="space-y-1.5">
              {[
                { color: '#94a3b8', label: 'Pending stop' },
                { color: '#3b82f6', label: 'En route' },
                { color: '#f59e0b', label: 'Arrived' },
                { color: '#10b981', label: 'Completed' },
                { color: '#ef4444', label: 'Failed' },
              ].map(({ color, label }) => (
                <div key={label} className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ background: color }} />
                  <span className="text-xs text-gray-600">{label}</span>
                </div>
              ))}
              <div className="flex items-center gap-2 mt-1">
                <AlertTriangle size={12} className="text-amber-500 shrink-0" />
                <span className="text-xs text-gray-600">No ping &gt;5 min</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
