import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// OPUS-AUDIT-18: ErrorBoundary.tsx exists as an orphan — it's defined but never wraps the root layout
// and the project lacks Next 14 App Router's `app/error.tsx` / `app/global-error.tsx` conventions.
// Result: any uncaught render error = blank white screen for the entire app, no recovery path.
// Fix: add both `app/error.tsx` (route-segment boundary) and `app/global-error.tsx` (root boundary)
// with user-facing fallback UI that exposes the reset() callback so users can recover without reload.

const appDir = join(process.cwd(), 'packages', 'dashboard', 'src', 'app');

test('OPUS-AUDIT-18 — app/error.tsx exists as a client component with reset() recovery', () => {
  const path = join(appDir, 'error.tsx');
  expect(existsSync(path), 'app/error.tsx is missing — route-segment errors will white-screen').toBe(true);
  const src = readFileSync(path, 'utf8');
  expect(src, 'app/error.tsx must be a client component').toMatch(/['"]use client['"]/);
  expect(src, 'must export a default error component').toMatch(/export\s+default\s+function/);
  expect(src, 'must accept the Next.js { error, reset } props').toMatch(/reset/);
});

test('OPUS-AUDIT-18 — app/global-error.tsx exists to catch root-layout crashes', () => {
  const path = join(appDir, 'global-error.tsx');
  expect(existsSync(path), 'app/global-error.tsx is missing — a crash in layout = unrecoverable blank screen').toBe(true);
  const src = readFileSync(path, 'utf8');
  expect(src, 'global-error.tsx must be a client component').toMatch(/['"]use client['"]/);
  expect(src, 'global-error.tsx must render its own <html>/<body> (Next.js requirement)').toMatch(/<html/);
  expect(src, 'global-error.tsx must render its own <html>/<body> (Next.js requirement)').toMatch(/<body/);
  expect(src, 'must accept the Next.js { error, reset } props').toMatch(/reset/);
});
