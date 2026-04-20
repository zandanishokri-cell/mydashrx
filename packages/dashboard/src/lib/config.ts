// OPUS-AUDIT-7: single source of truth for the backend base URL.
// Prior to this consolidation, 14 files each carried their own fallback (mix of
// 'http://localhost:3001' and 'https://mydashrx-backend.onrender.com'), so a
// misconfigured NEXT_PUBLIC_API_URL could route different code paths to
// different backends. Import API_BASE from here — never hardcode.
export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'https://mydashrx-backend.onrender.com';
