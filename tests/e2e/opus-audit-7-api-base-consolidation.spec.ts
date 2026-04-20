import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

// OPUS-AUDIT-7: backend URL fallback was duplicated across 14+ files with inconsistent defaults
// (some 'http://localhost:3001', some 'https://mydashrx-backend.onrender.com', some including /api/v1).
// A misconfigured env could route requests to different backends from different files.
// Fix: a single lib/config.ts owns the fallback. All call sites import API_BASE from there.

function walkTs(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) walkTs(p, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(p);
  }
  return out;
}

test('OPUS-AUDIT-7 — backend URL fallback lives in exactly one config file', () => {
  const srcDir = join(process.cwd(), 'packages', 'dashboard', 'src');
  const offenders: string[] = [];
  for (const file of walkTs(srcDir)) {
    const content = readFileSync(file, 'utf8');
    if (/(localhost:3001|mydashrx-backend\.onrender\.com)/.test(content)) {
      offenders.push(file.replace(srcDir, '').replace(/\\/g, '/'));
    }
  }
  expect(offenders, `Fallback URL must live in lib/config.ts only. Found in: ${offenders.join(', ')}`).toEqual([
    '/lib/config.ts',
  ]);
});
