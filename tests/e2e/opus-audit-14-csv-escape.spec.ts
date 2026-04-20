import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { csvEscape } from '../../packages/dashboard/src/lib/csvEscape';

// OPUS-AUDIT-14: drivers/page.tsx exportCsv does `r.join(',')` with no escaping —
// a driver named "Smith, Jr." or containing a quote corrupts every downstream row.
// stops/page.tsx got it right inline but the logic is duplicated + easy to re-get-wrong.
// Fix: extract `csvEscape` to a shared util and have both pages call it.

const srcDir = join(process.cwd(), 'packages', 'dashboard', 'src');
const utilPath = join(srcDir, 'lib', 'csvEscape.ts');
const driversPath = join(srcDir, 'app', 'dashboard', 'drivers', 'page.tsx');
const stopsPath = join(srcDir, 'app', 'dashboard', 'stops', 'page.tsx');

test('OPUS-AUDIT-14 — shared csvEscape util exists and handles RFC 4180 edge cases', () => {
  expect(existsSync(utilPath), 'lib/csvEscape.ts must exist as single source of truth').toBe(true);

  // Plain value — quoted (we always quote for predictability)
  expect(csvEscape('plain')).toBe('"plain"');
  // Embedded comma
  expect(csvEscape('Smith, Jr.')).toBe('"Smith, Jr."');
  // Embedded double-quote → doubled per RFC 4180
  expect(csvEscape('O"Brien')).toBe('"O""Brien"');
  // Embedded newline → stays inside quotes
  expect(csvEscape('line1\nline2')).toBe('"line1\nline2"');
  // Null/undefined → empty quoted cell
  expect(csvEscape(null)).toBe('""');
  expect(csvEscape(undefined)).toBe('""');
  // Number coerces via String()
  expect(csvEscape(42)).toBe('"42"');
});

test('OPUS-AUDIT-14 — drivers/page.tsx uses the shared csvEscape util (not raw join)', () => {
  const src = readFileSync(driversPath, 'utf8');
  expect(src, 'drivers page must import csvEscape from shared util').toMatch(
    /import[^;]*\bcsvEscape\b[^;]*from\s+['"]@\/lib\/csvEscape['"]/,
  );
  // Regression guard: forbid the old unescaped r.join(',') pattern in the export path
  expect(src, 'drivers/exportCsv must not use raw r.join(",") — breaks on commas/quotes in names').not.toMatch(
    /r\s*=>\s*r\.join\(\s*['"],['"]\s*\)/,
  );
});

test('OPUS-AUDIT-14 — stops/page.tsx uses the shared csvEscape util', () => {
  const src = readFileSync(stopsPath, 'utf8');
  expect(src, 'stops page must import csvEscape from shared util').toMatch(
    /import[^;]*\bcsvEscape\b[^;]*from\s+['"]@\/lib\/csvEscape['"]/,
  );
});
