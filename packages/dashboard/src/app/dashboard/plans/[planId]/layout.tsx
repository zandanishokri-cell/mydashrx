'use client';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import type { ReactNode } from 'react';

// P-ROUTE1: error boundary prevents full-page crash on null prop access in plan/route/stop detail
export default function PlanDetailLayout({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      fallback={
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-8">
          <div className="text-center">
            <p className="text-gray-500 mb-2">Could not load plan details</p>
            <button
              onClick={() => window.location.reload()}
              className="text-sm text-[#0F4C81] underline mr-4"
            >
              Retry
            </button>
            <a href="/dashboard/plans" className="text-sm text-gray-400 underline">Back to plans</a>
          </div>
        </div>
      }
    >
      {children}
    </ErrorBoundary>
  );
}
