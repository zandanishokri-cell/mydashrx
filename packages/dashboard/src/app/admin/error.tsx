'use client';

// P-FIN3: route-segment error boundary for /admin/*. /admin has no layout of its own,
// so a render crash in /admin/approvals (1603 LOC) or /admin/audit-log would otherwise
// bubble up to the root error.tsx and risk a 401 refresh loop if the crash fires during
// an in-flight auth refresh. Scoping the boundary here keeps the user signed in and gives
// them an immediate path back to /dashboard, where the super_admin sidebar lives.

import { useEffect } from 'react';

export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[admin]', error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F7F8FC] px-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
        <div className="w-12 h-12 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-6 h-6 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h1 className="text-lg font-semibold text-gray-900 mb-1">Something went wrong on this admin page</h1>
        <p className="text-sm text-gray-500 mb-5">You're still signed in. Try again, or head back to the dashboard.</p>
        {error?.digest && (
          <p className="text-[11px] text-gray-400 font-mono mb-5">Ref: {error.digest}</p>
        )}
        <div className="space-y-2">
          <button
            onClick={reset}
            className="w-full bg-[#0F4C81] text-white rounded-lg py-2.5 text-sm font-medium hover:bg-[#0d3d69] transition-colors"
          >
            Try again
          </button>
          <a
            href="/dashboard"
            className="block w-full border border-gray-200 text-gray-700 rounded-lg py-2.5 text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            Back to dashboard
          </a>
        </div>
      </div>
    </div>
  );
}
