import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';

// OPUS-AUDIT-19: lib/auth.ts:76 creates a BroadcastChannel at module-eval time with only a
// `typeof window` guard. Safari <15.4 (still ~3% global share, higher on iPad enterprise
// fleets) does not implement BroadcastChannel — loading the app throws a ReferenceError
// before React even mounts = white screen, no recovery. Fix: gate every construction with
// `typeof BroadcastChannel !== 'undefined'`. This is a platform feature-detect, not a
// polyfill — on unsupported browsers we silently lose cross-tab sync, which is acceptable.

const srcDir = join(process.cwd(), 'packages', 'dashboard', 'src');
const CALL_SITES = ['lib/auth.ts', 'lib/api.ts', 'components/AuthSync.tsx'];

test('OPUS-AUDIT-19 — every `new BroadcastChannel(...)` is feature-detected', () => {
  for (const rel of CALL_SITES) {
    const src = readFileSync(join(srcDir, rel), 'utf8');
    const lines = src.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (!/new\s+BroadcastChannel\s*\(/.test(lines[i])) continue;
      // Guard must live on this line or within the 5 preceding lines (same expression or
      // enclosing if-block). 5 is enough for any reasonable code structure.
      const windowSrc = lines.slice(Math.max(0, i - 5), i + 1).join('\n');
      // Accept either "!== 'undefined'" (inline gate) or "=== 'undefined'" (early-return gate)
      // — both are valid feature-detects; what matters is the typeof check exists.
      expect(
        /typeof\s+BroadcastChannel\s*[!=]==?\s*['"]undefined['"]/.test(windowSrc),
        `${rel}:${i + 1} — new BroadcastChannel not preceded by typeof-BroadcastChannel guard. ` +
          `Safari <15.4 will throw ReferenceError and crash the app.`,
      ).toBe(true);
    }
  }
});
