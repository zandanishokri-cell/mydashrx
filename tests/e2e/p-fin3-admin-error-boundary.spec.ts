import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// P-FIN3: admin routes (/admin/approvals 1603 LOC, /admin/audit-log) have no local
// error boundary. Any render crash bubbles to the root error.tsx, which — while it
// catches the blank screen — loses all admin-specific context and, worse, if the crash
// fires during a request-with-auth-refresh window the global retry + reset dance can
// cascade into a 401 loop. A route-segment error.tsx at /admin scopes the blast radius:
// one admin subpage crashes, the user stays logged in, they click "Back to dashboard"
// and the super_admin sidebar (now the normal landing per USER-BUG-1 fix) stays alive.

const adminErrorPath = join(process.cwd(), 'packages', 'dashboard', 'src', 'app', 'admin', 'error.tsx');

test('P-FIN3 — app/admin/error.tsx exists as a client component with reset() recovery', () => {
  expect(existsSync(adminErrorPath), 'app/admin/error.tsx must exist to scope admin-route crashes').toBe(true);
  const src = readFileSync(adminErrorPath, 'utf8');
  expect(/^'use client'|^"use client"/m.test(src), 'error.tsx must declare "use client"').toBe(true);
  expect(/export\s+default\s+function/.test(src), 'error.tsx must export a default function component').toBe(true);
  // Must accept error + reset props per Next.js App Router contract
  expect(/reset\s*[:,)}]/.test(src), 'error.tsx must receive the reset callback').toBe(true);
  expect(/error\s*[:,)}]/.test(src), 'error.tsx must receive the error object').toBe(true);
  // Must offer a path out (to /dashboard — where super_admin now lands by default)
  expect(/\/dashboard/.test(src), 'admin error.tsx must give the user an escape hatch back to /dashboard').toBe(true);
});
