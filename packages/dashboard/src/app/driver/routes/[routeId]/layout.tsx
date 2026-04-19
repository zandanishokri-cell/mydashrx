'use client';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import type { ReactNode } from 'react';

export default function DriverRouteDetailLayout({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      fallback={
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-8">
          <div className="text-center">
            <p className="text-gray-500 mb-2">Could not load route details</p>
            <a href="/driver/routes" className="text-sm text-[#0F4C81] underline">Back to routes</a>
          </div>
        </div>
      }
    >
      {children}
    </ErrorBoundary>
  );
}
