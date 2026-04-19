'use client';
import { useEffect, useState, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { Badge } from '@/components/ui/Badge';
import { RefreshCw, AlertTriangle, Clock, WifiOff, Crosshair } from 'lucide-react';

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

const fmtTime = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

export default function MapPage() {
  const [user] = useState(getUser);
  const [liveData, setLiveData] = useState<LiveData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [secondsAgo, setSecondsAgo] = useState(0);
  const [highlightedDriverId, setHighlightedDriverId] = useState<string | null>(null);
  const handleMarkerClick = useCallback(
    (id: string) => setHighlightedDriverId((prev) => (prev === id ? null : id)),
    [],
  );
  const [routeStops, setRouteStops] = useState<StopMarker[]>([]);
  const [stopsLoading, setStopsLoading] = useState(false);
  const [stopsError, setStopsError] = useState(false);
  const [staleTick, setStaleTick] = useState(0);
  const [fitToDriver, setFitToDriver] = useState<string | null>(null);
  const lastFetchedRouteIdRef = useRef<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const staleCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

    // Pause polling when tab is hidden — resume + refresh immediately on return
    const handleVisibility = () => {
      if (document.hidden) {
        if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      } else {
        load();
        intervalRef.current = setInterval(load, 15000);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (tickRef.current) clearInterval(tickRef.current);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [load]);

  // Force re-render every 60s to catch stale-ping threshold crossings between data polls
  useEffect(() => {
    staleCheckRef.current = setInterval(() => setStaleTick((t) => t + 1), 60000);
    return () => { if (staleCheckRef.current) clearInterval(staleCheckRef.current); };
  }, []);

  // Reset fitToDriver after one frame so the effect fires once per click
  useEffect(() => {
    if (!fitToDriver) return;
    const id = setTimeout(() => setFitToDriver(null), 0);
    return () => clearTimeout(id);
  }, [fitToDriver]);

  // Fetch stop pins only when the highlighted route actually changes — not on every 15s poll
  useEffect(() => {
    if (!highlightedDriverId || !user || !liveData) {
      setRouteStops([]); setStopsError(false); lastFetchedRouteIdRef.current = null; return;
    }
    const route = liveData.activeRoutes.find((r) => r.driverId === highlightedDriverId);
    if (!route) { setRouteStops([]); lastFetchedRouteIdRef.current = null; return; }
    // Cache key: routeId + stopsCompleted — re-fetch when a stop is delivered (pin color changes)
    // but skip on pure liveData polls where nothing changed
    const cacheKey = `${route.routeId}:${route.stopsCompleted}`;
    if (lastFetchedRouteIdRef.current === cacheKey) return;
    lastFetchedRouteIdRef.current = cacheKey;
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
    .filter((r) => r.currentLat != null && r.currentLng != null)
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

      {/* Error banners — always-mounted live regions (WCAG 4.1.3 Level AA) */}
      {/* Critical: no data at all — role=alert fires immediately */}
      <div
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
        className={`flex items-center gap-2 px-5 py-2.5 bg-red-50 border-b border-red-100 shrink-0 transition-opacity duration-150 ${error && !liveData ? 'opacity-100' : 'opacity-0 pointer-events-none h-0 py-0 overflow-hidden'}`}
      >
        <WifiOff size={14} className="text-red-500 shrink-0" />
        <span className="text-sm text-red-700">Could not load live tracking data.</span>
        <button onClick={load} className="ml-auto text-xs font-medium text-red-600 hover:underline">Retry</button>
      </div>
      {/* Stale: has data but refresh failed — role=status is polite */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className={`flex items-center gap-2 px-5 py-2.5 bg-amber-50 border-b border-amber-100 shrink-0 transition-opacity duration-150 ${error && liveData ? 'opacity-100' : 'opacity-0 pointer-events-none h-0 py-0 overflow-hidden'}`}
      >
        <AlertTriangle size={14} className="text-amber-500 shrink-0" />
        <span className="text-sm text-amber-700">Refresh failed — showing last known positions.</span>
        <button onClick={load} className="ml-auto text-xs font-medium text-amber-600 hover:underline">Retry</button>
      </div>

      <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
        {/* Skip link — lets keyboard/SR users jump past map to route list (WCAG 2.4.1) */}
        <a
          href="#route-list"
          className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2 focus:px-3 focus:py-1.5 focus:text-xs focus:font-medium focus:bg-white focus:border focus:border-gray-300 focus:rounded-lg focus:shadow"
        >
          Skip to route list
        </a>

        {/* Map */}
        <div className="flex-1 relative min-h-[280px]">
          {/* Always-mounted live region — announces loading → loaded → error (WCAG 4.1.3 Level AA) */}
          <div
            role="status"
            aria-live="polite"
            aria-atomic="true"
            aria-label={loading ? 'Loading map' : error ? 'Map data unavailable' : 'Map loaded'}
            className="sr-only"
          >
            {loading ? 'Loading map…' : error && !liveData ? 'Map data unavailable.' : ''}
          </div>
          {/* Visual loading overlay — aria-hidden so screen readers use the live region above */}
          <div
            aria-hidden="true"
            className={`absolute inset-0 flex items-center justify-center bg-gray-50 transition-opacity duration-200 z-10 ${loading ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
          >
            <div className="text-gray-400 text-sm">Loading map…</div>
          </div>
          <LiveMap
            drivers={driverMarkers}
            stops={routeStops}
            highlightedDriverId={highlightedDriverId}
            depotLatLng={null}
            onMarkerClick={handleMarkerClick}
            fitToDriver={fitToDriver}
            accessibleLabel={`Live map — ${summary.activeDrivers} driver${summary.activeDrivers !== 1 ? 's' : ''}, ${summary.totalStopsRemaining} stop${summary.totalStopsRemaining !== 1 ? 's' : ''} remaining`}
          />
        </div>

        {/* Sidebar */}
        <div id="route-list" aria-label="Active delivery routes" className="w-full md:w-72 bg-white border-t md:border-t-0 md:border-l border-gray-100 overflow-y-auto shrink-0 max-h-60 md:max-h-none">
          <div className="px-4 py-3 border-b border-gray-50 flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Active Routes</p>
            {/* Always-mounted status spans — opacity-toggle avoids DOM-mount announcement gap (WCAG 4.1.3) */}
            <span
              role="status"
              aria-live="polite"
              aria-atomic="true"
              className={`text-xs text-gray-400 animate-pulse transition-opacity duration-150 ${stopsLoading ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
            >
              Loading stops…
            </span>
            <span
              role="status"
              aria-live="polite"
              aria-atomic="true"
              className={`text-xs text-amber-600 flex items-center gap-1 transition-opacity duration-150 ${stopsError && !stopsLoading ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
            >
              <AlertTriangle size={10} aria-hidden="true" /> Stops unavailable
            </span>
          </div>

          {(liveData?.activeRoutes ?? []).length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-gray-400">No active routes</div>
          ) : (
            <div className="divide-y divide-gray-50">
              {(liveData?.activeRoutes ?? []).map((r) => {
                void staleTick; // dependency — ensures re-eval every 60s for stale threshold
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
                    {selected && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setFitToDriver(r.driverId); }}
                        className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 px-2 py-1 mt-1.5 rounded hover:bg-blue-50 transition-colors"
                        title="Fit map to route"
                      >
                        <Crosshair size={12} /> Fit to route
                      </button>
                    )}
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
