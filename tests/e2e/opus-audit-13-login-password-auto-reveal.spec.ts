import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';

// OPUS-AUDIT-13: login/page.tsx had a setTimeout(..., 300_000) that auto-revealed the
// password form on the "Check your email" screen after 5 minutes. The input has
// autoFocus + autoComplete="current-password", so if the user left the tab open
// (or switched away and came back later) the browser could trigger password autofill
// against a context the user never actively opted into. Fix: drop the timed auto-reveal
// and require an explicit user action (the main-screen "Sign in with password instead"
// button is already there, plus we add a parallel button on the sent-screen).

const loginPath = join(process.cwd(), 'packages', 'dashboard', 'src', 'app', 'login', 'page.tsx');

test('OPUS-AUDIT-13 — no 5-minute setTimeout that auto-shows password form', () => {
  const src = readFileSync(loginPath, 'utf8');
  // The specific regression pattern: setTimeout → setShowPassword(true) with 300_000 / 300000 / 5 * 60 * 1000
  expect(
    /setTimeout\s*\(\s*\(\s*\)\s*=>\s*setShowPassword\s*\(\s*true\s*\)/.test(src),
    'login/page.tsx must not auto-reveal password form on a timer — require explicit user click',
  ).toBe(false);
  // Broader sanity: no 300_000 / 300000 literal tied to showPassword
  expect(
    /300[_]?000[\s\S]{0,80}setShowPassword/.test(src),
    'no 5-minute (300000 ms) timer should gate the password form reveal',
  ).toBe(false);
});

test('OPUS-AUDIT-13 — password form still reachable via explicit user action', () => {
  const src = readFileSync(loginPath, 'utf8');
  // User-initiated toggle must still exist
  expect(
    /setShowPassword\s*\(\s*p\s*=>\s*!p\s*\)|setShowPassword\s*\(\s*true\s*\)/.test(src),
    'login/page.tsx must keep an explicit user-triggered path to the password form',
  ).toBe(true);
  // The toggle should be wired to an onClick, not a timer
  expect(
    /onClick\s*=\s*\{\s*\(\s*\)\s*=>\s*\{[^}]*setShowPassword/.test(src),
    'showPassword must be toggled from an onClick handler, not setTimeout',
  ).toBe(true);
});
