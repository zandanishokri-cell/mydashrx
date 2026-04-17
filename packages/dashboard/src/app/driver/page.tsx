'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { MapPin, Clock, ChevronRight, LogOut, CheckCircle2, Circle } from 'lucide-react';

interface MyRoute {
  id: string;
  planId: string;
  status: string;
  stopOrder: string[];
  estimatedDuration: number | null;
  totalDistance: number | null;
  planDate: string;
  depotName: string;
}

export default function DriverHomePage() {
  const router = useRouter();
  const [user] = useState(() => { try { return JSON.parse(localStorage.getItem('user') ?? 'null'); } catch { return null; } });
  const [routes, setRoutes] = useState<MyRoute[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [driverStatus, setDriverStatus] = useState<'available' | 'offline' | 'on_route'>('available');
  const [toggling, setToggling] = useState(false);
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<MyRoute[]>('/driver/me/routes'),
      api.get<{ status: 'available' | 'offline' | 'on_route' }>('/driver/me'),
    ]).then(([r, me]) => {
      setRoutes(r);
      setDriverStatus(me.status);
    }).catch(() => setError('Could not load your routes')).finally(() => setLoading(false));
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 4000);
  };

  const toggleStatus = async () => {
    if (toggling || driverStatus === 'on_route') return;
    const next = driverStatus === 'available' ? 'offline' : 'available';
    const prev = driverStatus;
    setDriverStatus(next);
    setToggling(true);
    try {
      await api.patch<{ status: string }>('/driver/me/status', { status: next });
    } catch {
      setDriverStatus(prev);
      showToast('Could not update status. Try again.');
    } finally {
      setToggling(false);
    }
  };

  const signOut = () => {
    localStorage.clear();
    router.replace('/driver/login');
  };

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-[#0F4C81] text-white px-5 pt-12 pb-7">
        <div className="flex items-start justify-between mb-1">
          <div>
            <p className="text-blue-300 text-sm font-medium">
              {new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 17 ? 'Good afternoon' : 'Good evening'},
            </p>
            <h1 className="text-2xl font-bold mt-0.5">{user?.name ?? 'Driver'}</h1>
          </div>
          <button
            onClick={signOut}
            className="p-2.5 bg-blue-700/60 rounded-xl hover:bg-blue-800 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
            aria-label="Sign out"
          >
            <LogOut size={18} />
          </button>
        </div>
        <p className="text-blue-300 text-sm mt-3">{today}</p>
        {/* Status toggle */}
        <button
          onClick={toggleStatus}
          disabled={toggling || driverStatus === 'on_route'}
          className="mt-4 flex items-center gap-2 px-3.5 py-2 rounded-xl bg-blue-700/50 hover:bg-blue-700/80 disabled:opacity-60 disabled:cursor-not-allowed transition-colors text-sm font-medium min-h-[40px]"
          aria-label="Toggle availability status"
        >
          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${driverStatus === 'available' ? 'bg-emerald-400' : driverStatus === 'on_route' ? 'bg-blue-300' : 'bg-gray-400'}`} />
          {driverStatus === 'available' ? 'Available' : driverStatus === 'on_route' ? 'On Route' : 'Offline'}
          {driverStatus !== 'on_route' && (
            <span className="text-blue-300 text-xs ml-1">
              {toggling ? '…' : `→ ${driverStatus === 'available' ? 'Go Offline' : 'Go Available'}`}
            </span>
          )}
        </button>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white text-sm px-4 py-2.5 rounded-xl shadow-lg">
          {toast}
        </div>
      )}

      <div className="px-4 py-5">
        {loading ? (
          <div className="space-y-3">
            {[1, 2].map(i => <div key={i} className="h-28 bg-white rounded-2xl animate-pulse" />)}
          </div>
        ) : error ? (
          <div className="bg-red-50 text-red-600 rounded-2xl p-4 text-sm text-center">{error}</div>
        ) : routes.length === 0 ? (
          <div className="bg-white rounded-2xl p-12 text-center shadow-sm">
            <CheckCircle2 size={44} className="text-gray-200 mx-auto mb-4" />
            <p className="font-bold text-gray-700 text-base">No routes today</p>
            <p className="text-gray-400 text-sm mt-1.5">Check back when your dispatcher assigns a route.</p>
          </div>
        ) : (
          <>
            <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">
              Today&apos;s Routes ({routes.length})
            </h2>
            <div className="space-y-3">
              {routes.map(route => (
                <button
                  key={route.id}
                  onClick={() => router.push(`/driver/routes/${route.id}`)}
                  className="w-full bg-white rounded-2xl p-4 shadow-sm text-left flex items-center justify-between active:scale-[0.99] transition-all min-h-[88px] hover:shadow-md"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                        route.status === 'active' ? 'bg-green-100 text-green-700' :
                        route.status === 'completed' ? 'bg-gray-100 text-gray-500' :
                        'bg-blue-50 text-[#0F4C81]'
                      }`}>
                        {route.status === 'pending' ? 'Ready to Start' : route.status === 'active' ? 'In Progress' : 'Completed'}
                      </span>
                    </div>
                    <p className="font-bold text-gray-900 text-base truncate">{route.depotName ?? 'Route'}</p>
                    <div className="flex items-center gap-3 mt-1.5 text-sm text-gray-500">
                      <span className="flex items-center gap-1.5">
                        <Circle size={13} /> {route.stopOrder?.length ?? 0} stops
                      </span>
                      {route.estimatedDuration && (
                        <span className="flex items-center gap-1.5">
                          <Clock size={13} /> {Math.round(route.estimatedDuration)} min
                        </span>
                      )}
                      {route.totalDistance && (
                        <span className="flex items-center gap-1.5">
                          <MapPin size={13} /> {route.totalDistance.toFixed(1)} km
                        </span>
                      )}
                    </div>
                  </div>
                  <ChevronRight size={22} className="text-gray-300 shrink-0 ml-2" />
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
