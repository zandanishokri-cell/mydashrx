import { test, expect } from '@playwright/test';

// OPUS-AUDIT-4: api.ts:63-68 double-refresh race.
// Bug: when proactive refresh returns null (RT invalid), code continues with stale AT
// → request fires → 401 → refreshAndRetry triggers a SECOND refresh call.
// Fix: on proactive refresh null, immediately clearSession + redirect — skip the request.
//
// Test strategy: mount dashboard with a short-lived bootstrap AT. All /auth/refresh
// calls after the first return 401. All API endpoints return 401 to simulate a server
// rejecting the stale AT. Count /auth/refresh invocations.
//   - Bug (before fix): bootstrap(1) + proactive(2) + retry(3) = 3 refresh calls.
//   - Fix (after fix): bootstrap(1) + proactive(2, fails → clearSession) = 2 refresh calls.

test('OPUS-AUDIT-4 — proactive refresh failure does not trigger a second refresh', async ({ page }) => {
  let refreshCalls = 0;

  const nearExpiredAT = makeJwt({
    sub: 'u1',
    email: 't@x.com',
    role: 'pharmacy_admin',
    orgId: 'o1',
    exp: Math.floor(Date.now() / 1000) + 30, // 30s — under the 60s proactive threshold
  });

  await page.route('**/api/v1/auth/refresh', (route) => {
    refreshCalls += 1;
    if (refreshCalls === 1) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ accessToken: nearExpiredAT }),
      });
    }
    return route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
  });

  // All non-refresh API calls simulate a server rejecting the expired AT.
  await page.route('**/api/v1/**', (route) => {
    const url = route.request().url();
    if (url.includes('/auth/refresh')) return route.fallback();
    return route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"expired"}' });
  });

  await page.goto('/login');
  await page.evaluate(() => {
    localStorage.setItem('user', JSON.stringify({
      id: 'u1', email: 't@x.com', role: 'pharmacy_admin', orgId: 'o1', name: 'Test',
    }));
  });

  await page.goto('/dashboard');
  await page.waitForURL(/\/login/, { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(500);

  expect(refreshCalls).toBeLessThanOrEqual(2);
});

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.`;
}
