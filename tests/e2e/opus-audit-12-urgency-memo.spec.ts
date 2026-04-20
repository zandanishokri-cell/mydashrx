import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';

// OPUS-AUDIT-12: stops/page.tsx getUrgency() reads Date.now() inline on every call, and
// sortedStops re-computes on every render. A user switching tabs or typing in the filter
// triggers a re-sort even though the stop windows haven't changed — worst case, a stop's
// urgency can flip mid-scroll (overdue ↔ due-soon) because the two getUrgency() calls in
// the same compare() see slightly different `now` values. The badge flickers and rows
// reorder under the cursor.
//
// Fix: pass `now` into getUrgency (pure function), drive it from a useState tick that
// refreshes every 30s, and memoize sortedStops on [stops, sortKey, sortDir, now].

const stopsPath = join(process.cwd(), 'packages', 'dashboard', 'src', 'app', 'dashboard', 'stops', 'page.tsx');

test('OPUS-AUDIT-12 — getUrgency() is pure (takes `now`) and does not read Date.now() internally', () => {
  const src = readFileSync(stopsPath, 'utf8');
  const fnMatch = src.match(/function\s+getUrgency\s*\([\s\S]*?\n\}/);
  expect(fnMatch, 'getUrgency must exist in stops/page.tsx').not.toBeNull();
  const body = fnMatch![0];

  // Signature must accept a second arg (the `now` timestamp) — any identifier after the stop param.
  expect(
    /function\s+getUrgency\s*\(\s*\w+\s*:\s*\w+\s*,\s*\w+/.test(body),
    'getUrgency must take a `now` parameter so re-sorts are deterministic within one render',
  ).toBe(true);

  // Must NOT call Date.now() inside the body — caller provides `now`.
  expect(
    /Date\.now\s*\(/.test(body),
    'getUrgency must not read Date.now() internally — it makes the function non-pure and causes badge flicker',
  ).toBe(false);
});

test('OPUS-AUDIT-12 — sortedStops is memoized with a periodic `now` tick (useMemo + setInterval)', () => {
  const src = readFileSync(stopsPath, 'utf8');

  // Expect useMemo wrapping sortedStops (or an equivalent memo pattern that keys on now).
  expect(
    /const\s+sortedStops\s*=\s*useMemo\s*\(/.test(src),
    'sortedStops must be useMemo-wrapped so re-renders do not re-sort unnecessarily',
  ).toBe(true);

  // Expect a periodic "now" tick — some setInterval that updates state, separate from data polls.
  // Match a useEffect that calls setInterval with a ~30s-ish cadence — 30_000 is the audit-recommended value.
  expect(
    /setInterval[\s\S]{0,200}30[_]?000/.test(src),
    'must refresh `now` periodically (setInterval ~30s) so urgency can transition without a manual reload',
  ).toBe(true);
});
