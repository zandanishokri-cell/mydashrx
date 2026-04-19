'use client';
import Link from 'next/link';

interface EmptyStateActivationProps {
  title: string;
  description: string;
  ctaLabel: string;
  /** Navigate to a route — use either ctaHref or ctaOnClick */
  ctaHref?: string;
  /** Trigger a modal or inline action instead of navigation */
  ctaOnClick?: () => void;
  timeEstimate: string;
  placeholderRows?: number;
}

function GhostRow() {
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-50 last:border-0">
      <div className="w-8 h-8 rounded-full bg-gray-100 animate-pulse shrink-0" />
      <div className="flex-1 space-y-1.5">
        <div className="h-3 bg-gray-100 rounded animate-pulse w-2/5" />
        <div className="h-2.5 bg-gray-100 rounded animate-pulse w-3/5" />
      </div>
      <div className="h-5 w-16 bg-gray-100 rounded-full animate-pulse shrink-0" />
    </div>
  );
}

export function EmptyStateActivation({
  title,
  description,
  ctaLabel,
  ctaHref,
  ctaOnClick,
  timeEstimate,
  placeholderRows = 3,
}: EmptyStateActivationProps) {
  return (
    <div className="rounded-xl border-2 border-dashed border-gray-200 bg-white overflow-hidden">
      {/* Ghost preview rows */}
      <div className="opacity-40 pointer-events-none select-none" aria-hidden>
        {Array.from({ length: placeholderRows }).map((_, i) => (
          <GhostRow key={i} />
        ))}
      </div>

      {/* CTA overlay */}
      <div className="border-t border-gray-100 bg-gradient-to-b from-white/80 to-white px-6 py-6 text-center">
        <p className="font-semibold text-gray-900 text-sm mb-1">{title}</p>
        <p className="text-gray-400 text-xs max-w-xs mx-auto mb-4">{description}</p>
        <div className="flex items-center justify-center gap-3 flex-wrap">
          {ctaOnClick ? (
            <button
              onClick={ctaOnClick}
              className="inline-flex items-center gap-1.5 bg-[#0F4C81] text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-[#0d3d69] transition-colors focus-visible:outline-2 focus-visible:outline-[#0F4C81] focus-visible:outline-offset-2"
            >
              {ctaLabel}
            </button>
          ) : (
            <Link
              href={ctaHref ?? '#'}
              className="inline-flex items-center gap-1.5 bg-[#0F4C81] text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-[#0d3d69] transition-colors focus-visible:outline-2 focus-visible:outline-[#0F4C81] focus-visible:outline-offset-2"
            >
              {ctaLabel}
            </Link>
          )}
          <span className="inline-flex items-center gap-1 text-xs text-gray-400 bg-gray-50 px-2.5 py-1 rounded-full border border-gray-100">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {timeEstimate}
          </span>
        </div>
      </div>
    </div>
  );
}
