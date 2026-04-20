import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';

// OPUS-AUDIT-9: getUser() reads localStorage (potentially stale vs AT payload).
// If role is changed server-side mid-session, the refresh endpoint issues a new AT with
// the updated role, but localStorage still holds the old role — so RBAC-gated UI in 22+
// callers renders stale until a full page reload triggers attemptSilentBootstrap's merge.
//
// Fix: make getUser() itself authoritative by decoding _accessToken (when present) and
// letting the AT payload override auth-critical fields (id, email, role, orgId). This
// patches all 22 callers at once without touching any of them — the AT is the source of
// truth, so the accessor should reflect it.

const authPath = join(process.cwd(), 'packages', 'dashboard', 'src', 'lib', 'auth.ts');

test('OPUS-AUDIT-9 — getUser() decodes _accessToken so role/orgId come from the AT, not stale localStorage', () => {
  const src = readFileSync(authPath, 'utf8');

  // Isolate the getUser function body. It starts at `export function getUser` and ends at
  // the matching closing brace of its top-level block.
  const fnMatch = src.match(/export\s+function\s+getUser\s*\(\s*\)[\s\S]*?\n\}/);
  expect(fnMatch, 'getUser() must be findable as an exported function in auth.ts').not.toBeNull();
  const body = fnMatch![0];

  // The body must reference the module-level AT (either `_accessToken` directly or via
  // `getAccessToken()`) — otherwise it cannot know about the current AT payload.
  expect(
    /_accessToken|getAccessToken\s*\(/.test(body),
    'getUser() must reference the current access token so auth-critical fields stay fresh',
  ).toBe(true);

  // It must decode a JWT: look for the `.split('.')` + `atob` pattern (same shape used in
  // attemptSilentBootstrap). Without this, there is no AT payload to merge.
  expect(
    /split\s*\(\s*['"`]\.['"`]\s*\)/.test(body) && /atob\s*\(/.test(body),
    'getUser() must decode the AT payload (split(".") + atob) to extract fresh role/orgId',
  ).toBe(true);
});
