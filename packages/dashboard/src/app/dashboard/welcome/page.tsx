'use client';
// P-ONB35: Role-based first-run welcome fork
// Dispatcher and driver see this 2-screen micro-onboarding on first login.
// Gated by localStorage 'mdrx_welcome_seen_<role>' — shown once, never again.
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getUser } from '@/lib/auth';
import { Route, Users, CheckCircle, ChevronRight, Map } from 'lucide-react';

interface Step {
  title: string;
  body: string;
  icon: React.ReactNode;
  cta: string;
  href: string;
}

const DISPATCHER_STEPS: Step[] = [
  {
    title: 'Welcome, Dispatcher',
    body: "Your job is to turn a list of stops into optimized delivery routes. Start by reviewing today's unassigned stops, then create a plan and assign drivers.",
    icon: <Route size={48} className="text-blue-400" />,
    cta: "See today's stops",
    href: '/dashboard/stops',
  },
  {
    title: 'Build your first route',
    body: 'Head to Plans to create a delivery plan, add stops, and assign a driver. Once dispatched, you can track progress in real time on the map.',
    icon: <Map size={48} className="text-blue-400" />,
    cta: 'Go to plans',
    href: '/dashboard/plans',
  },
];

const DRIVER_STEPS: Step[] = [
  {
    title: 'Welcome, Driver',
    body: "Your assigned routes appear in My Routes. Tap a route to see your stops in order, then start navigating when you're ready to begin deliveries.",
    icon: <Users size={48} className="text-blue-400" />,
    cta: 'See my routes',
    href: '/dashboard/driver/me/routes',
  },
  {
    title: 'Complete a delivery',
    body: 'At each stop: mark Arrived, capture proof of delivery (photo or signature), then mark Completed. Exceptions like "Not Home" are logged automatically.',
    icon: <CheckCircle size={48} className="text-blue-400" />,
    cta: 'View my routes',
    href: '/dashboard/driver/me/routes',
  },
];

export default function WelcomePage() {
  const router = useRouter();
  const user = getUser();
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!user) { router.replace('/login'); return; }
    if (user.role !== 'dispatcher' && user.role !== 'driver') {
      router.replace('/dashboard');
      return;
    }
    const key = `mdrx_welcome_seen_${user.role}`;
    if (typeof window !== 'undefined' && localStorage.getItem(key)) {
      router.replace(user.role === 'driver' ? '/dashboard/driver/me/routes' : '/dashboard/stops');
    }
  }, [user, router]);

  if (!user || (user.role !== 'dispatcher' && user.role !== 'driver')) return null;

  const steps = user.role === 'dispatcher' ? DISPATCHER_STEPS : DRIVER_STEPS;
  const current = steps[step];
  const isLast = step === steps.length - 1;

  const proceed = () => {
    if (isLast) {
      const key = `mdrx_welcome_seen_${user.role}`;
      localStorage.setItem(key, '1');
      router.replace(current.href);
    } else {
      setStep(s => s + 1);
    }
  };

  const skip = () => {
    const key = `mdrx_welcome_seen_${user.role}`;
    localStorage.setItem(key, '1');
    router.replace(current.href);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm max-w-md w-full p-10 text-center">
        {/* Step dots */}
        <div className="flex justify-center gap-1.5 mb-8">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`w-2 h-2 rounded-full transition-colors ${i === step ? 'bg-[#0F4C81]' : 'bg-gray-200'}`}
            />
          ))}
        </div>

        <div className="flex justify-center mb-5" aria-hidden>
          {current.icon}
        </div>

        <h1 className="text-xl font-bold text-gray-900 mb-3" style={{ fontFamily: 'var(--font-sora)' }}>
          {current.title}
        </h1>
        <p className="text-gray-500 text-sm leading-relaxed mb-8">
          {current.body}
        </p>

        <button
          onClick={proceed}
          className="w-full flex items-center justify-center gap-2 px-5 py-3 bg-[#0F4C81] text-white text-sm font-medium rounded-xl hover:bg-[#0d3d69] transition-colors focus-visible:outline-2 focus-visible:outline-[#0F4C81] focus-visible:outline-offset-2"
        >
          {current.cta}
          <ChevronRight size={16} />
        </button>

        <button
          onClick={skip}
          className="mt-3 text-xs text-gray-400 hover:text-gray-600 transition-colors"
        >
          Skip intro
        </button>
      </div>
    </div>
  );
}
