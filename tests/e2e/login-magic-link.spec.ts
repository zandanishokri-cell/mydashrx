import { test, expect } from '@playwright/test';

// OPUS-AUDIT-15 regression: magic-link login is the most fragile auth surface.
// Verify the golden path: request link → "sent" state renders with correct email + provider hint.
// Backend is mocked so this runs without a live server.

test.describe('login — magic-link golden path', () => {
  test('submit form → sent state shows email + Gmail provider hint', async ({ page }) => {
    await page.route('**/api/v1/auth/magic-link/request', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Link sent', requestId: 'req-test-123' }),
      })
    );

    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'MyDashRx' })).toBeVisible();

    await page.fill('#login-email', 'tester@gmail.com');
    await page.getByRole('button', { name: 'Send login link' }).click();

    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
    await expect(page.getByText('tester@gmail.com')).toBeVisible();
    await expect(page.getByText(/Promotions tab/)).toBeVisible();

    const requestId = await page.evaluate(() => sessionStorage.getItem('mdrx_magic_request_id'));
    expect(requestId).toBe('req-test-123');
  });

  test('Outlook emails show forwarding-scanner warning', async ({ page }) => {
    await page.route('**/api/v1/auth/magic-link/request', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Link sent', forwardingRisk: true }),
      })
    );

    await page.goto('/login');
    await page.fill('#login-email', 'user@outlook.com');
    await page.getByRole('button', { name: 'Send login link' }).click();

    await expect(page.getByText(/Outlook email scanners/)).toBeVisible();
    await expect(page.getByRole('alert', { name: 'Email forwarding detected' })).toBeVisible();
    await expect(page.getByLabel('6-digit verification code')).toBeVisible();
  });

  test('expired=1 query param surfaces expired-link notice', async ({ page }) => {
    await page.goto('/login?expired=1');
    await expect(page.getByText(/Your sign-in link expired/)).toBeVisible();
  });

  test('?reason=idle surfaces idle-timeout notice', async ({ page }) => {
    await page.goto('/login?reason=idle');
    await expect(page.getByText(/expired after 30 minutes of inactivity/)).toBeVisible();
  });
});
