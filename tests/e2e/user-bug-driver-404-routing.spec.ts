import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { getRoleRedirect, ROLE_REDIRECTS } from '@mydash-rx/shared';

// USER-BUG (2026-04-20): user logged in as drv-me-t21@test.com and hit a 404.
// Same 404 after creating a fresh driver account. Root cause: ROLE_REDIRECTS.driver
// pointed at '/driver/routes' but that segment has no page.tsx — only a dynamic
// [routeId] child. Fix: point drivers at '/driver' (the DriverHomePage landing).

const driverLandingPath = join(
  process.cwd(),
  'packages', 'dashboard', 'src', 'app', 'driver', 'page.tsx',
);
const driverRoutesIndexPath = join(
  process.cwd(),
  'packages', 'dashboard', 'src', 'app', 'driver', 'routes', 'page.tsx',
);

test('USER-BUG — driver role redirect resolves to a real Next.js page', () => {
  const target = getRoleRedirect('driver');
  // Whatever path we redirect drivers to MUST have a matching page.tsx in the app
  // router tree — otherwise Next.js returns the generic 404 the user saw.
  const targetSegments = target.split('/').filter(Boolean);
  const pagePath = join(
    process.cwd(),
    'packages', 'dashboard', 'src', 'app', ...targetSegments, 'page.tsx',
  );
  expect(
    existsSync(pagePath),
    `getRoleRedirect('driver') returned ${target} but no page.tsx exists at ${pagePath}`,
  ).toBe(true);
});

test('USER-BUG — driver lands at /driver (the DriverHomePage), not /driver/routes', () => {
  expect(getRoleRedirect('driver')).toBe('/driver');
  expect(ROLE_REDIRECTS.driver).toBe('/driver');
});

test('USER-BUG — /driver/page.tsx is the authoritative driver landing', () => {
  expect(existsSync(driverLandingPath)).toBe(true);
  const src = readFileSync(driverLandingPath, 'utf8');
  // Guardrail: this is the page drivers land on. If someone deletes or renames the
  // default export, the role redirect breaks again. Assert the component is present.
  expect(/export\s+default\s+function\s+\w+/.test(src)).toBe(true);
});

test('USER-BUG — /driver/routes has NO bare index page (only a dynamic [routeId] child)', () => {
  // This asserts the SHAPE of the bug: /driver/routes was never a real landing page.
  // If someone later adds packages/dashboard/src/app/driver/routes/page.tsx, this
  // test becomes obsolete and should be deleted — but today it proves why the old
  // ROLE_REDIRECTS.driver value was broken from the start.
  expect(existsSync(driverRoutesIndexPath)).toBe(false);
});
