'use client';
import { useEffect, useState, useRef } from 'react';
import dynamic from 'next/dynamic';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { Badge } from '@/components/ui/Badge';
import { RefreshCw } from 'lucide-react';

const LiveMap = dynamic(() => import('@/components/LiveMap').then((m) => m.LiveMap), { ssr: false });

interface Driver {
  id: string; name: string; status: string;
  currentLat: number | null; currentLng: number | null; lastPingAt: string | null;
}

interface Stop {
  id: string; routeId: string; recipientName: string; address: string;
  status: string; lat: number; lng: number; sequenceNumber: number | null;
}

interface Route { id: string; driverId: string; status: string; }
interface Plan { id: string; date: string; status: string; routes: Route[]; }

export default function MapPage() {
  const user = getUser();
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [stops, setStops] = useState<Stop[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = async () => {
    if (!user) return;
    try {
      const today = new Date().toISOString().split('T')[0];
      const [driversData, plansData] = await Promise.all([
        api.get<Driver[]>(`/orgs/${user.orgId}/drivers`),
        api.get<Plan[]>(`/orgs/${user.orgId}/plans?date=${today}`),
      ]);
      setDrivers(driversData);
      setPlans(plansData);

      // Load stops for all active/distributed plans
      const allStops: Stop[] = [];
      for (const plan of plansData) {
        if (plan.status === 'distributed' || plan.status === 'optimized') {
          const routes = await api.get<Route[]>(`/plans/${plan.id}/routes`);
          for (const route of routes) {
            const routeStops = await api.get<Stop[]>(`/plans/${plan.id}/routes/${route.id}/stops`);
            allStops.push(...routeStops);
          }
        }
      }
      setStops(allStops);
      setLastRefresh(new Date());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    intervalRef.current = setInterval(load, 15000); // refresh every 15s
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const driverMarkers = drivers
    .filter((d) => d.currentLat && d.currentLng)
    .map((d) => ({ id: d.id, name: d.name, lat: d.currentLat!, lng: d.currentLng!, status: d.status }));

  const today = new Date().toISOString().split('T')[0];
  const todayPlans = plans.filter((p) => p.date === today);
  const activeDrivers = drivers.filter((d) => d.status === 'on_route').length;
  const completedStops = stops.filter((s) => s.status === 'completed').length;
  const pendingStops = stops.filter((s) => s.status === 'pending').length;

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 bg-white shrink-0">
        <div className="flex items-center gap-6">
          <h1 className="font-bold text-gray-900" style={{ fontFamily: 'var(--font-sora)' }}>Live Map</h1>
          <div className="flex items-center gap-4 text-sm text-gray-500">
            <span><strong className="text-[#0F4C81]">{activeDrivers}</strong> active drivers</span>
            <span><strong className="text-[#10b981]">{completedStops}</strong> completed</span>
            <span><strong className="text-gray-500">{pendingStops}</strong> pending</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">
            Updated {lastRefresh.toLocaleTimeString()}
          </span>
          <button onClick={load} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors" title="Refresh">
            <RefreshCw size={14} className="text-gray-500" />
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Map */}
        <div className="flex-1 relative">
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-50">
              <div className="text-gray-400 text-sm">Loading map…</div>
            </div>
          ) : (
            <LiveMap drivers={driverMarkers} stops={stops} />
          )}
        </div>

        {/* Sidebar */}
        <div className="w-64 border-l border-gray-100 bg-white overflow-y-auto shrink-0">
          {/* Drivers panel */}
          <div className="px-4 py-3 border-b border-gray-50">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Drivers</p>
            <div className="space-y-2">
              {drivers.map((driver) => (
                <div key={driver.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-blue-50 flex items-center justify-center text-[#0F4C81] font-semibold text-xs">
                      {driver.name[0]}
                    </div>
                    <div>
                      <p className="text-xs font-medium text-gray-900">{driver.name.split(' ')[0]}</p>
                      {driver.lastPingAt && (
                        <p className="text-xs text-gray-400">
                          {Math.floor((Date.now() - new Date(driver.lastPingAt).getTime()) / 60000)}m ago
                        </p>
                      )}
                    </div>
                  </div>
                  <Badge status={driver.status} />
                </div>
              ))}
              {drivers.length === 0 && <p className="text-xs text-gray-400">No drivers</p>}
            </div>
          </div>

          {/* Today's plans */}
          <div className="px-4 py-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Today&apos;s Plans</p>
            <div className="space-y-2">
              {todayPlans.map((plan) => (
                <a
                  key={plan.id}
                  href={`/dashboard/plans/${plan.id}`}
                  className="flex items-center justify-between hover:bg-gray-50 rounded-lg px-2 py-1.5 transition-colors"
                >
                  <span className="text-xs text-gray-700">{plan.date}</span>
                  <Badge status={plan.status} />
                </a>
              ))}
              {todayPlans.length === 0 && <p className="text-xs text-gray-400">No plans today</p>}
            </div>
          </div>

          {/* Legend */}
          <div className="px-4 py-3 border-t border-gray-50">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Legend</p>
            <div className="space-y-1.5">
              {[
                { color: '#94a3b8', label: 'Pending' },
                { color: '#f59e0b', label: 'Arrived' },
                { color: '#10b981', label: 'Completed' },
                { color: '#ef4444', label: 'Failed' },
              ].map(({ color, label }) => (
                <div key={label} className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ background: color }} />
                  <span className="text-xs text-gray-600">{label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
