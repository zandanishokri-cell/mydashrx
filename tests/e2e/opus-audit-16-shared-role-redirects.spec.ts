import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { ROLE_REDIRECTS, getRoleRedirect } from '@mydash-rx/shared';

// OPUS-AUDIT-16: ROLE_REDIRECTS was authoritative client-side only. When the backend
// processes a post-login redirect (or any flow that routes a user by role), it had no
// shared map — so a demoted user could be bounced to a role-protected URL, or a
// user-supplied `next=/admin` param could land a non-admin on a dead page.
//
// Fix: move ROLE_REDIRECTS + getRoleRedirect to @mydash-rx/shared. Both frontend and
// backend import from the same map — one definition, one source of truth, one thing to
// keep in sync when a new role is added.

const sharedAuthPath = join(process.cwd(), 'packages', 'shared', 'src', 'types', 'auth.ts');
const frontendAuthPath = join(process.cwd(), 'packages', 'dashboard', 'src', 'lib', 'auth.ts');

test('OPUS-AUDIT-16 — @mydash-rx/shared exports ROLE_REDIRECTS as the canonical map', () => {
  expect(existsSync(sharedAuthPath), 'shared/src/types/auth.ts must exist').toBe(true);
  const src = readFileSync(sharedAuthPath, 'utf8');
  expect(
    /export\s+const\s+ROLE_REDIRECTS/.test(src),
    'shared/types/auth.ts must export ROLE_REDIRECTS so backend + frontend share one definition',
  ).toBe(true);
  expect(
    /export\s+function\s+getRoleRedirect/.test(src),
    'shared/types/auth.ts must export getRoleRedirect — both layers need the same resolution logic',
  ).toBe(true);
});

test('OPUS-AUDIT-16 — frontend auth.ts imports from shared (not a local duplicate)', () => {
  const src = readFileSync(frontendAuthPath, 'utf8');
  // Must import the shared names (directly or re-export) — not define its own ROLE_REDIRECTS object.
  expect(
    /from\s+['"]@mydash-rx\/shared['"]/.test(src),
    'frontend auth.ts must import from @mydash-rx/shared',
  ).toBe(true);
  // Must NOT declare a local `const ROLE_REDIRECTS` — that would defeat the whole point
  // of sharing the map and re-introduce drift.
  expect(
    /const\s+ROLE_REDIRECTS\s*:/.test(src),
    'frontend auth.ts must not keep a local ROLE_REDIRECTS object — import the shared one',
  ).toBe(false);
});

test('OPUS-AUDIT-16 — shared getRoleRedirect resolves all roles the way the frontend spec asserts', () => {
  expect(getRoleRedirect('super_admin')).toBe('/dashboard');
  expect(getRoleRedirect('pharmacy_admin')).toBe('/dashboard');
  expect(getRoleRedirect('dispatcher')).toBe('/dashboard');
  expect(getRoleRedirect('driver')).toBe('/driver/routes');
  expect(getRoleRedirect('pharmacist')).toBe('/dashboard/welcome/pharmacist');
  expect(getRoleRedirect('super_admin', true)).toBe('/onboarding/waiting');
  expect(ROLE_REDIRECTS.super_admin).toBe('/dashboard');
});
