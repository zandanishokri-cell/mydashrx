'use client';
import { useEffect } from 'react';

// OPUS-AUDIT-18: Next 14 App Router route-segment error boundary.
// Any uncaught render error inside a route subtree lands here instead of blanking the app.
// Keep this component dependency-free — it must render even if our shared UI imports are what crashed.

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface to browser console for local debugging; production log shipping happens via the platform.
    // eslint-disable-next-line no-console
    console.error('Route error:', error);
  }, [error]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-red-50 flex items-center justify-center">
          <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h1 className="text-lg font-semibold text-gray-900 mb-1">Something went wrong on this page</h1>
        <p className="text-sm text-gray-500 mb-6">
          The rest of MyDashRx is still running. Try again, or head back to the dashboard.
        </p>
        <div className="flex gap-2 justify-center">
          <button
            type="button"
            onClick={reset}
            className="px-4 py-2 rounded-md bg-[#0F4C81] text-white text-sm font-medium hover:bg-[#0c3e6a] focus:outline-none focus:ring-2 focus:ring-[#0F4C81] focus:ring-offset-2"
          >
            Try again
          </button>
          <a
            href="/dashboard"
            className="px-4 py-2 rounded-md border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-300"
          >
            Go to dashboard
          </a>
        </div>
        {error.digest && (
          <p className="mt-6 text-xs text-gray-400">Ref: {error.digest}</p>
        )}
      </div>
    </div>
  );
}
