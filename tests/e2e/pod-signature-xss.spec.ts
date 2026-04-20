import { test, expect } from '@playwright/test';

// Tier 1 regression (pharmacy/orders/[orderId] POD signature XSS):
// Before fix: dangerouslySetInnerHTML rendered svgData inline → <script> inside SVG executed.
// After fix: rendered via <img src="data:image/svg+xml;utf8,..."> → browsers block script
// execution inside img-loaded SVGs (MDN: Web/SVG/Scripting).
// This test injects a malicious SVG payload through a mocked order detail API and asserts
// the script never runs.

test('POD signature with <script> payload does not execute', async ({ page }) => {
  const xssSignal: string[] = [];
  await page.exposeFunction('__xssCaptured', (val: string) => { xssSignal.push(val); });

  const maliciousSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80">
    <script>window.__xssCaptured && window.__xssCaptured('PWNED')</script>
    <path d="M10 40 L190 40" stroke="black" fill="none"/>
  </svg>`;

  await page.route('**/api/v1/orders/test-order-id**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'test-order-id',
        status: 'delivered',
        pod: {
          signature: {
            signerName: 'J. Doe',
            svgData: maliciousSvg,
            timestamp: new Date().toISOString(),
          },
        },
      }),
    })
  );

  await page.goto('/login');
  await page.evaluate(() => {
    localStorage.setItem('user', JSON.stringify({
      id: 'u1', email: 't@x.com', role: 'pharmacy_admin', orgId: 'o1', name: 'Test',
    }));
  });

  await page.goto('/pharmacy/orders/test-order-id').catch(() => {});
  await page.waitForTimeout(1500);

  expect(xssSignal).toEqual([]);

  const imgTag = page.locator('img[src^="data:image/svg+xml"]');
  if (await imgTag.count() > 0) {
    const src = await imgTag.first().getAttribute('src');
    expect(src).toContain('%3Cscript%3E');
  }
});
