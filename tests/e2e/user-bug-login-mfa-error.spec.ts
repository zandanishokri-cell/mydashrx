import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';

// USER-BUG (2026-04-20, reported by Zandani): tried to sign in with password as
// super_admin. Backend returned 403 `mfa_enrollment_required` (auth.ts:262 hard-blocks
// super_admin without MFA on the password path). Frontend login/page.tsx:226 caught
// every error into a single hardcoded "Invalid email or password." — so super_admin
// without MFA saw "Invalid email or password" instead of "MFA setup required," with
// no path forward to enroll. This is the classic swallow-the-error bug.
//
// Fix: inspect the thrown error (api.ts throws `API ${status}: ${body}`) and surface
// the real backend message for non-401 cases. 401 stays as "Invalid email or password"
// (that IS an invalid credentials case). 403/429/etc surface the actual reason.

const loginPath = join(process.cwd(), 'packages', 'dashboard', 'src', 'app', 'login', 'page.tsx');

test('USER-BUG — signInWithPassword inspects the caught error instead of hardcoding one string', () => {
  const src = readFileSync(loginPath, 'utf8');
  // The catch for signInWithPassword must actually destructure/reference the error,
  // not be a bare `catch {` with a hardcoded message.
  // Old pattern we want gone: `catch { setError('Invalid email or password.'); }`
  // Match the signInWithPassword function body + find the catch
  const fnMatch = src.match(/signInWithPassword\s*=\s*async[\s\S]*?\n\s*\};?\s*\n/);
  expect(fnMatch, 'signInWithPassword must be findable in login/page.tsx').not.toBeNull();
  const fnBody = fnMatch![0];
  // Catch must reference the error variable (not `catch {`)
  expect(
    /catch\s*\(\s*\w+[^)]*\)/.test(fnBody),
    'signInWithPassword catch must capture the error so it can inspect it',
  ).toBe(true);
});

test('USER-BUG — login surfaces MFA enrollment message (and directs to setup) when backend returns 403', () => {
  const src = readFileSync(loginPath, 'utf8');
  // We need the login flow to recognize the mfa_enrollment_required error code from the backend
  expect(
    /mfa_enrollment_required|mfa.{0,3}enrollment|MFA.*required|mfa\/setup/i.test(src),
    'login/page.tsx must handle the mfa_enrollment_required 403 case explicitly — ' +
      'super_admin without MFA was seeing "Invalid email or password" and had no path to enroll',
  ).toBe(true);
});
