'use client';
// P-ONB39: Step completion micro-celebration overlay
// 3.5s auto-dismiss, contextual "what's next" hint per step type
import { useEffect, useState } from 'react';
import { CheckCircle2, X } from 'lucide-react';

export type OnboardingStepType = 'driver' | 'route' | 'stop' | 'delivery';

interface StepConfig {
  title: string;
  subtitle: string;
  hint: string;
  hintHref: string;
  hintCta: string;
}

const STEP_CONFIGS: Record<OnboardingStepType, StepConfig> = {
  driver: {
    title: 'First driver added!',
    subtitle: 'Your driver will receive a magic-link invitation to join.',
    hint: 'Next: create your first delivery route.',
    hintHref: '/dashboard/plans',
    hintCta: 'Create route →',
  },
  route: {
    title: 'First route created!',
    subtitle: 'Your delivery plan is ready to be filled with stops.',
    hint: 'Next: add your first delivery stop.',
    hintHref: '/dashboard/stops',
    hintCta: 'Add stop →',
  },
  stop: {
    title: 'First stop added!',
    subtitle: 'Your delivery is queued and ready to dispatch.',
    hint: 'Next: dispatch the route to your driver.',
    hintHref: '/dashboard/plans',
    hintCta: 'Dispatch route →',
  },
  delivery: {
    title: 'First delivery complete!',
    subtitle: 'Your pharmacy is now fully operational on MyDashRx.',
    hint: 'Check your analytics to see delivery performance.',
    hintHref: '/dashboard/analytics',
    hintCta: 'View analytics →',
  },
};

interface StepCompleteModalProps {
  step: OnboardingStepType;
  onClose: () => void;
}

export function StepCompleteModal({ step, onClose }: StepCompleteModalProps) {
  const [visible, setVisible] = useState(true);
  const config = STEP_CONFIGS[step];

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(onClose, 300); // allow fade-out
    }, 3500);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0'}`}
      style={{ background: 'rgba(0,0,0,0.35)' }}
      onClick={() => { setVisible(false); setTimeout(onClose, 300); }}
    >
      <div
        className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 text-center"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={() => { setVisible(false); setTimeout(onClose, 300); }}
          className="absolute top-3 right-3 p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 transition-colors"
          style={{ position: 'absolute' }}
        >
          <X size={16} />
        </button>

        {/* Animated check icon */}
        <div className="flex justify-center mb-4">
          <div className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center animate-bounce-once">
            <CheckCircle2 size={36} className="text-emerald-500" />
          </div>
        </div>

        <h3 className="text-lg font-bold text-gray-900 mb-1">{config.title}</h3>
        <p className="text-sm text-gray-500 mb-4">{config.subtitle}</p>

        {/* What's next hint */}
        <div className="bg-blue-50 rounded-xl px-4 py-3 text-left">
          <p className="text-xs text-blue-700 font-medium mb-1">What's next</p>
          <p className="text-xs text-blue-600 mb-2">{config.hint}</p>
          <a
            href={config.hintHref}
            className="inline-flex items-center text-xs font-semibold text-[#0F4C81] hover:underline"
          >
            {config.hintCta}
          </a>
        </div>

        {/* Auto-dismiss progress bar */}
        <div className="mt-4 h-1 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-emerald-400 rounded-full"
            style={{ animation: 'progress-drain 3.5s linear forwards' }}
          />
        </div>
      </div>

      <style>{`
        @keyframes progress-drain {
          from { width: 100%; }
          to { width: 0%; }
        }
        @keyframes bounce-once {
          0%, 100% { transform: translateY(0); }
          40% { transform: translateY(-10px); }
          60% { transform: translateY(-5px); }
        }
        .animate-bounce-once { animation: bounce-once 0.6s ease-out; }
      `}</style>
    </div>
  );
}
