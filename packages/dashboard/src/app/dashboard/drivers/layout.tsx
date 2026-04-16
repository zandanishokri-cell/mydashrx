'use client';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import type { ReactNode } from 'react';

export default function DriversLayout({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      fallback={
        <div className="p-8 text-center">
          <p className="text-gray-700 font-medium mb-1">Something went wrong in the Drivers section.</p>
          <p className="text-gray-400 text-sm mb-4">Refresh the page to recover.</p>
          <button
            onClick={() => window.location.reload()}
            className="text-sm bg-[#0F4C81] text-white px-4 py-2 rounded-lg hover:bg-[#0a3d6b]"
          >
            Reload page
          </button>
        </div>
      }
    >
      {children}
    </ErrorBoundary>
  );
}
