'use client';
// P-A11Y7: WCAG 2.4.1 (Level A) — announce route changes to screen readers
import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

export function RouteAnnouncer() {
  const pathname = usePathname();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    // Derive page name from pathname for announcement
    const segment = pathname.split('/').filter(Boolean).pop() ?? 'home';
    const label = segment.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    ref.current.textContent = `Navigated to ${label}`;
    // Clear after announcement so re-navigating to same page re-announces
    const t = setTimeout(() => { if (ref.current) ref.current.textContent = ''; }, 500);
    return () => clearTimeout(t);
  }, [pathname]);

  return (
    <div
      ref={ref}
      aria-live="assertive"
      aria-atomic="true"
      className="sr-only"
    />
  );
}
