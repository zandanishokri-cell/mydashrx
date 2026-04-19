'use client';

interface Props {
  countdown: number;
  onExtend: () => void;
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function IdleWarningModal({ countdown, onExtend }: Props) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[200] p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="idle-warning-title"
        aria-describedby="idle-warning-desc"
        className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl text-center"
      >
        <div className="w-12 h-12 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-6 h-6 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h3 id="idle-warning-title" className="text-lg font-semibold text-gray-900 mb-2">⚠ Still there?</h3>
        <p id="idle-warning-desc" className="text-gray-500 text-sm mb-4">
          You'll be signed out in{' '}
          <span
            aria-live="assertive"
            aria-atomic="true"
            className="font-mono font-semibold text-gray-900"
          >
            {fmt(countdown)}
          </span>{' '}
          due to inactivity.
        </p>
        <button
          onClick={onExtend}
          autoFocus
          className="w-full bg-[#0F4C81] text-white rounded-lg py-2.5 text-sm font-medium hover:bg-[#0d3d69] transition-colors"
        >
          Stay signed in
        </button>
      </div>
    </div>
  );
}
