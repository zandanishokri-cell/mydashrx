'use client';
import { useEffect } from 'react';

// OPUS-AUDIT-18: Next 14 App Router global error boundary — replaces the root layout when
// the crash is in layout.tsx itself (font loader, providers, etc). Must render its own
// <html>/<body> because root layout is unavailable at this point.

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('Global error:', error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{
        margin: 0,
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
        background: '#F7F8FC',
        color: '#111827',
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}>
        <div style={{ maxWidth: 420, width: '100%', textAlign: 'center' }}>
          <div style={{
            width: 48,
            height: 48,
            margin: '0 auto 16px',
            borderRadius: '9999px',
            background: '#FEE2E2',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 24,
            color: '#DC2626',
          }} aria-hidden="true">!</div>
          <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>MyDashRx hit an unexpected error</h1>
          <p style={{ fontSize: 14, color: '#6B7280', marginBottom: 24 }}>
            We&apos;ve logged it. Try again, or reload the page.
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button
              type="button"
              onClick={reset}
              style={{
                padding: '8px 16px',
                borderRadius: 6,
                background: '#0F4C81',
                color: 'white',
                fontSize: 14,
                fontWeight: 500,
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
            <a
              href="/"
              style={{
                padding: '8px 16px',
                borderRadius: 6,
                background: 'white',
                color: '#374151',
                fontSize: 14,
                fontWeight: 500,
                border: '1px solid #E5E7EB',
                textDecoration: 'none',
                display: 'inline-block',
              }}
            >
              Reload home
            </a>
          </div>
          {error.digest && (
            <p style={{ marginTop: 24, fontSize: 12, color: '#9CA3AF' }}>Ref: {error.digest}</p>
          )}
        </div>
      </body>
    </html>
  );
}
