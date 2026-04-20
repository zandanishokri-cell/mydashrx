import { test, expect } from '@playwright/test';

// OPUS-AUDIT-5: api.ts decodeExp uses client Date.now() directly.
// Clock-skewed laptops trigger refresh storms (client clock ahead) or missed expiry (client behind).
// Fix: backend sends X-Server-Time header; frontend tracks skew and uses server-adjusted time in decodeExp comparisons.
// Also bump proactive grace buffer 60s → 120s for additional defence.
//
// Test strategy: client clock is 4min AHEAD of server. Token issued with exp=realNow+4min (server POV: 4min remaining).
//   - Bug (before fix): client sees exp - Date.now() = 0 → triggers a proactive refresh on the next request.
//     Result: bootstrap refresh (1) + proactive refresh (2) = 2 calls.
//   - Fix (after fix): client reads X-Server-Time from bootstrap response, computes skew=-4min,
//     serverAdjustedNow = Date.now() + skew = realNow, exp - adjusted = 4min > 120s buffer → no refresh.
//     Result: bootstrap refresh (1) = 1 call.

test('OPUS-AUDIT-5 — clock-skewed client uses X-Server-Time to avoid premature refresh', async ({ page }) => {
  let refreshCalls = 0;
  const SKEW_MS = 4 * 60 * 1000; // client is 4 minutes ahead of server

  // Shift client Date.now() forward by SKEW_MS before any app code runs.
  // decodeExp comparisons use Date.now() directly, so overriding the static method is sufficient.
  await page.addInitScript((skewMs) => {
    const origNow = Date.now.bind(Date);
    Date.now = () => origNow() + skewMs;
  }, SKEW_MS);

  await page.route('**/api/v1/auth/refresh', (route) => {
    refreshCalls += 1;
    const realNowSec = Math.floor((Date.now()) / 1000);
    const tokenExpSec = realNowSec + 4 * 60; // 4 minutes from server POV
    const at = makeJwt({
      sub: 'u1', email: 't@x.com', role: 'pharmacy_admin', orgId: 'o1',
      exp: tokenExpSec,
    });
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: {
        'X-Server-Time': String(Date.now()),
        'Access-Control-Expose-Headers': 'X-Server-Time',
        'Access-Control-Allow-Origin': 'http://localhost:3000',
        'Access-Control-Allow-Credentials': 'true',
      },
      body: JSON.stringify({ accessToken: at }),
    });
  });

  // Any dashboard data fetch returns empty success with X-Server-Time.
  await page.route('**/api/v1/**', (route) => {
    if (route.request().url().includes('/auth/refresh')) return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: {
        'X-Server-Time': String(Date.now()),
        'Access-Control-Expose-Headers': 'X-Server-Time',
        'Access-Control-Allow-Origin': 'http://localhost:3000',
        'Access-Control-Allow-Credentials': 'true',
      },
      body: '{}',
    });
  });

  await page.goto('/login');
  await page.evaluate(() => {
    localStorage.setItem('user', JSON.stringify({
      id: 'u1', email: 't@x.com', role: 'pharmacy_admin', orgId: 'o1', name: 'Test',
    }));
  });

  await page.goto('/dashboard');
  await page.waitForTimeout(1500); // allow bootstrap + any dashboard requests to settle

  // With fix: bootstrap establishes skew, subsequent requests see token as valid → <=1 refresh.
  expect(refreshCalls).toBeLessThanOrEqual(1);
});

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.`;
}
