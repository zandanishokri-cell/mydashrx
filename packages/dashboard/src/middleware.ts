import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64');

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'", // Tailwind inlines styles — keep for styles only
    "img-src 'self' data: https:",
    "connect-src 'self' https://mydashrx-backend.onrender.com",
    "frame-ancestors 'none'",
  ].join('; ');

  const response = NextResponse.next({
    request: {
      headers: new Headers({
        ...Object.fromEntries(request.headers.entries()),
        'x-nonce': nonce,
      }),
    },
  });

  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  return response;
}

export const config = {
  // Run on all routes except static files and API
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
