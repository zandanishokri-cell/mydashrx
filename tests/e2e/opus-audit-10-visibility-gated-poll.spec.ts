import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';

// OPUS-AUDIT-10: dashboard/page.tsx fires setInterval(loadCombined, 30s) the moment it
// mounts and never stops when the tab is backgrounded. An operator who leaves the
// dashboard open overnight burns ~960 needless /summary + /drivers + /plans API
// calls across 8 hours (120 calls/hr × 8). Each call hits Render + Postgres and adds
// auth-refresh load. Fix: gate the poller on `document.visibilityState === 'visible'`
// — either pause the interval on `visibilitychange` or early-return from the
// interval callback when hidden. Both are acceptable; the test accepts either shape.

const dashboardPath = join(process.cwd(), 'packages', 'dashboard', 'src', 'app', 'dashboard', 'page.tsx');

test('OPUS-AUDIT-10 — dashboard poller respects tab visibility', () => {
  const src = readFileSync(dashboardPath, 'utf8');
  // Must mention visibility somewhere in the file — either the listener or the check
  const hasVisibilitySignal =
    /visibilitychange/.test(src) ||
    /document\.visibilityState/.test(src) ||
    /document\.hidden/.test(src);
  expect(
    hasVisibilitySignal,
    'dashboard/page.tsx must pause or skip the 30s poller when the tab is hidden — ' +
      'otherwise a backgrounded tab burns ~960 API calls over 8 hours',
  ).toBe(true);
});

test('OPUS-AUDIT-10 — 30s interval is still present (regression guard on the poller itself)', () => {
  const src = readFileSync(dashboardPath, 'utf8');
  expect(
    /setInterval[\s\S]{0,120}30[_]?000/.test(src),
    'the dashboard 30-second poller should still exist — this test guards the visibility gate, ' +
      'not the removal of polling',
  ).toBe(true);
});
