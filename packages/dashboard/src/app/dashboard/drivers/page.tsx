'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { Truck } from 'lucide-react';
import type { Driver } from '@mydash-rx/shared';

export default function DriversPage() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const user = getUser();

  useEffect(() => {
    if (!user) return;
    api.get<Driver[]>(`/orgs/${user.orgId}/drivers`)
      .then(setDrivers)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const statusColors: Record<string, string> = {
    available: 'bg-green-50 text-green-700',
    on_route: 'bg-teal-50 text-teal-700',
    offline: 'bg-gray-100 text-gray-500',
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-6" style={{ fontFamily: 'var(--font-sora)' }}>
        Drivers
      </h1>
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-16 bg-white rounded-xl border border-gray-100 animate-pulse" />)}
        </div>
      ) : drivers.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center">
          <Truck size={32} className="text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">No drivers added yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {drivers.map((driver) => (
            <div key={driver.id} className="flex items-center justify-between bg-white rounded-xl border border-gray-100 px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-blue-50 flex items-center justify-center text-[#0F4C81] font-semibold text-sm">
                  {driver.name[0]}
                </div>
                <div>
                  <div className="text-sm font-medium text-gray-900">{driver.name}</div>
                  <div className="text-xs text-gray-400">{driver.vehicleType} · {driver.phone}</div>
                </div>
              </div>
              <span className={`text-xs px-2 py-1 rounded-full font-medium ${statusColors[driver.status] ?? ''}`}>
                {driver.status.replace('_', ' ')}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
