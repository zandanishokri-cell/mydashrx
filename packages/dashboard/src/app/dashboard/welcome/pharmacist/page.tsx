'use client';
// P-ONB43: Pharmacist first-run orientation — 2-screen micro-onboarding
// Guard: localStorage 'mdrx_welcome_seen_pharmacist' — shown once
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getUser } from '@/lib/auth';
import { Stethoscope, LayoutGrid, ChevronRight, ClipboardList, Truck, MapPin } from 'lucide-react';

interface Callout { icon: React.ReactNode; label: string; path: string; }

const CALLOUTS: Callout[] = [
  { icon: <ClipboardList size={18} className="text-blue-500" />, label: 'Orders', path: '/dashboard/compliance' },
  { icon: <MapPin size={18} className="text-blue-500" />, label: 'Stops', path: '/dashboard/stops' },
  { icon: <Truck size={18} className="text-blue-500" />, label: 'Live Tracking', path: '/dashboard/map' },
];

const STORAGE_KEY = 'mdrx_welcome_seen_pharmacist';

export default function PharmacistWelcomePage() {
  const router = useRouter();
  const user = getUser();
  const [screen, setScreen] = useState(0);

  useEffect(() => {
    if (!user) { router.replace('/login'); return; }
    if (user.role !== 'pharmacist') { router.replace('/dashboard'); return; }
    if (typeof window !== 'undefined' && localStorage.getItem(STORAGE_KEY)) {
      router.replace('/pharmacist/queue');
    }
  }, [user, router]);

  if (!user || user.role !== 'pharmacist') return null;

  const orgName = (user as any).orgName ?? 'your pharmacy';

  const finish = () => {
    localStorage.setItem(STORAGE_KEY, '1');
    router.replace('/pharmacist/queue');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm max-w-md w-full p-10 text-center">
        {/* Step dots */}
        <div className="flex justify-center gap-1.5 mb-8">
          {[0, 1].map(i => (
            <div key={i} className={`w-2 h-2 rounded-full transition-colors ${i === screen ? 'bg-[#0F4C81]' : 'bg-gray-200'}`} />
          ))}
        </div>

        {screen === 0 ? (
          <>
            <div className="flex justify-center mb-5" aria-hidden>
              <Stethoscope size={48} className="text-blue-400" />
            </div>
            <h1 className="text-xl font-bold text-gray-900 mb-2" style={{ fontFamily: 'var(--font-sora)' }}>
              Welcome, {user.name?.split(' ')[0] ?? 'Pharmacist'}
            </h1>
            <p className="text-sm text-gray-500 mb-1">
              You're a <span className="font-medium text-gray-700">Pharmacist</span> at <span className="font-medium text-gray-700">{orgName}</span>.
            </p>
            <p className="text-sm text-gray-500 leading-relaxed mb-8">
              MyDashRx lets you view patient orders, track deliveries in real time, and update stop information — all from one place.
            </p>
            <button
              onClick={() => setScreen(1)}
              className="w-full flex items-center justify-center gap-2 px-5 py-3 bg-[#0F4C81] text-white text-sm font-medium rounded-xl hover:bg-[#0d3d69] transition-colors focus-visible:outline-2 focus-visible:outline-[#0F4C81] focus-visible:outline-offset-2"
            >
              See how it works <ChevronRight size={16} />
            </button>
            <button onClick={finish} className="mt-3 text-xs text-gray-400 hover:text-gray-600 transition-colors">
              Skip intro
            </button>
          </>
        ) : (
          <>
            <div className="flex justify-center mb-5" aria-hidden>
              <LayoutGrid size={48} className="text-blue-400" />
            </div>
            <h1 className="text-xl font-bold text-gray-900 mb-2" style={{ fontFamily: 'var(--font-sora)' }}>
              Your key surfaces
            </h1>
            <p className="text-sm text-gray-500 leading-relaxed mb-6">
              Here's where to find everything you need:
            </p>
            <ul className="space-y-3 mb-8 text-left">
              {CALLOUTS.map(({ icon, label, path }) => (
                <li key={label} className="flex items-center gap-3 bg-blue-50/60 rounded-lg px-4 py-3">
                  {icon}
                  <div>
                    <p className="text-sm font-semibold text-gray-800">{label}</p>
                    <p className="text-xs text-gray-400">{path}</p>
                  </div>
                </li>
              ))}
            </ul>
            <button
              onClick={finish}
              className="w-full flex items-center justify-center gap-2 px-5 py-3 bg-[#0F4C81] text-white text-sm font-medium rounded-xl hover:bg-[#0d3d69] transition-colors focus-visible:outline-2 focus-visible:outline-[#0F4C81] focus-visible:outline-offset-2"
            >
              Get started <ChevronRight size={16} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
