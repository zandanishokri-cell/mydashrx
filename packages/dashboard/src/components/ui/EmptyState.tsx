import type { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  primaryLabel?: string;
  onPrimary?: () => void;
  secondaryLabel?: string;
  secondaryHref?: string;
  /** Onboarding highlight variant — blue border/bg instead of plain */
  highlight?: boolean;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  secondaryHref,
  highlight = false,
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center py-16 px-8 text-center rounded-xl ${
        highlight
          ? 'border-2 border-blue-300 bg-blue-50/30'
          : 'bg-white border border-gray-100'
      }`}
    >
      <Icon
        size={48}
        className={`mb-4 ${highlight ? 'text-blue-400' : 'text-gray-300'}`}
        aria-hidden
      />
      <p className={`font-semibold text-sm mb-1 ${highlight ? 'text-blue-800' : 'text-gray-800'}`}>
        {title}
      </p>
      <p className={`text-sm max-w-xs ${highlight ? 'text-blue-600' : 'text-gray-400'}`}>
        {description}
      </p>
      {primaryLabel && onPrimary && (
        <button
          onClick={onPrimary}
          className="mt-4 px-4 py-2 bg-[#0F4C81] text-white text-sm font-medium rounded-lg hover:bg-[#0d3d69] transition-colors focus-visible:outline-2 focus-visible:outline-[#0F4C81] focus-visible:outline-offset-2"
        >
          {primaryLabel}
        </button>
      )}
      {secondaryLabel && secondaryHref && (
        <a
          href={secondaryHref}
          className="mt-2 text-xs text-[#0F4C81] hover:underline"
        >
          {secondaryLabel}
        </a>
      )}
    </div>
  );
}
