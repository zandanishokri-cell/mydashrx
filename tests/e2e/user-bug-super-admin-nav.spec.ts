import { test, expect } from '@playwright/test';
import { getRoleRedirect } from '../../packages/dashboard/src/lib/auth';

// USER-BUG (2026-04-20, reported by Zandani): signing in as super_admin redirected to
// /admin → which bounces to /admin/approvals → which has no layout, no sidebar, no nav.
// Super_admin was literally trapped on the approvals screen with no way to reach the
// rest of the dashboard unless they typed /dashboard into the address bar.
//
// Fix: redirect super_admin to /dashboard instead. /dashboard/layout.tsx already gates
// in a super_admin-only nav block (Platform Admin, Approvals, Audit Log) — so landing
// on /dashboard gives super_admin full navigation and Approvals is still one click away.

test('USER-BUG — super_admin redirects to /dashboard (which has nav), not /admin (which does not)', () => {
  expect(getRoleRedirect('super_admin')).toBe('/dashboard');
});

test('USER-BUG — pending-approval super_admin still goes to onboarding waiting (regression guard)', () => {
  expect(getRoleRedirect('super_admin', true)).toBe('/onboarding/waiting');
});

test('USER-BUG — other roles unchanged', () => {
  expect(getRoleRedirect('driver')).toBe('/driver');
  expect(getRoleRedirect('pharmacist')).toBe('/dashboard/welcome/pharmacist');
  expect(getRoleRedirect('pharmacy_admin')).toBe('/dashboard');
});
