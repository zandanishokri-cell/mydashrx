import type { User } from '@mydash-rx/shared';
import { getRoleRedirect as sharedGetRoleRedirect } from '@mydash-rx/shared';
import { API_BASE } from './config';

// OPUS-AUDIT-16: re-export the shared map resolver so existing frontend imports keep
// working while the canonical definition now lives in @mydash-rx/shared (backend imports
// the same source).
export { ROLE_REDIRECTS } from '@mydash-rx/shared';
export const getRoleRedirect = sharedGetRoleRedirect;

// P-SEC28: AT in module-level variable (not localStorage) — invisible to XSS.
// RT is httpOnly cookie set by backend — never JS-accessible.
// Only non-sensitive user JSON remains in localStorage.
let _accessToken: string | null = null;
export function getAccessToken(): string | null { return _accessToken; }
export function setAccessToken(at: string | null) { _accessToken = at; }

// OPUS-AUDIT-5: clock-skew tracking. Backend emits X-Server-Time on every response so the
// frontend can detect and compensate for drifting laptop clocks. Shared between auth bootstrap
// and api.ts request pipeline — the first response that carries the header establishes skew.
let _clockSkewMs = 0;
export function updateSkewFromResponse(res: Response): void {
  const header = res.headers.get('X-Server-Time');
  if (!header) return;
  const serverMs = Number(header);
  if (Number.isFinite(serverMs)) _clockSkewMs = serverMs - Date.now();
}
export function serverAdjustedNow(): number { return Date.now() + _clockSkewMs; }

// P-SES23: Bootstrap hydration — on page reload _accessToken resets to null despite valid RT cookie.
// Call attemptSilentBootstrap() in protected layouts before checking isAuthenticated().
// Returns true if AT was restored (user stays), false if no valid RT (redirect to login).
let _bootstrapPromise: Promise<boolean> | null = null;
export function attemptSilentBootstrap(): Promise<boolean> {
  if (_bootstrapPromise) return _bootstrapPromise;
  if (typeof window === 'undefined') return Promise.resolve(false);
  if (_accessToken) return Promise.resolve(true);
  _bootstrapPromise = fetch(`${API_BASE}/api/v1/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  }).then(async res => {
    updateSkewFromResponse(res);
    if (!res.ok) return false;
    const data = await res.json();
    if (!data.accessToken) return false;
    _accessToken = data.accessToken;
    // Rebuild user from AT payload so localStorage stays fresh after silent refresh
    try {
      const payload = JSON.parse(atob(data.accessToken.split('.')[1])) as {
        sub: string; email: string; role: string; orgId: string;
        name?: string; mustChangePw?: boolean; depotIds?: string[];
      };
      const existing = (() => { try { return JSON.parse(localStorage.getItem('user') ?? 'null'); } catch { return null; } })();
      // Merge: preserve extra fields from localStorage; AT payload is authoritative for auth fields
      const merged = {
        ...(existing ?? {}),
        id: payload.sub,
        email: payload.email,
        role: payload.role,
        orgId: payload.orgId,
        name: payload.name ?? existing?.name ?? '',
        mustChangePassword: payload.mustChangePw ?? false,
        depotIds: payload.depotIds ?? existing?.depotIds ?? [],
      };
      localStorage.setItem('user', JSON.stringify(merged));
    } catch { /* AT decode failed — user in localStorage may be stale but still usable */ }
    return true;
  }).catch(() => false);
  return _bootstrapPromise;
}

export function getUser(): User | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('user');
    const stored = raw ? (JSON.parse(raw) as User) : null;
    if (!stored) return null;
    // OPUS-AUDIT-9: AT payload is authoritative for auth-critical fields. If a server-side
    // role change happened mid-session, the next refresh issues a new AT — but localStorage
    // still holds the pre-change user. Decoding on every getUser() call means all 22 RBAC
    // callers see the new role without needing a full page reload / bootstrap merge.
    if (_accessToken) {
      try {
        const payload = JSON.parse(atob(_accessToken.split('.')[1])) as {
          sub: string; email: string; role: User['role']; orgId: string;
        };
        return { ...stored, id: payload.sub, email: payload.email, role: payload.role, orgId: payload.orgId };
      } catch { /* AT malformed — fall through to stored */ }
    }
    return stored;
  } catch {
    return null;
  }
}

// OPUS-AUDIT-19: feature-detect BroadcastChannel — unsupported on Safari <15.4. Fall back to null.
const authChannel = typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined'
  ? new BroadcastChannel('mydashrx_auth')
  : null;

export function setSession(tokens: {
  accessToken: string;
  refreshToken?: string; // optional — RT is now httpOnly cookie, not stored in JS
  user: User;
}) {
  _accessToken = tokens.accessToken;
  // Reset bootstrap cache so a subsequent logout→login→reload doesn't serve a stale `false`
  _bootstrapPromise = null;
  localStorage.setItem('user', JSON.stringify(tokens.user));
  // Legacy cleanup: remove stale tokens from pre-SEC28 localStorage flow
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
}

export function clearSession() {
  _accessToken = null;
  // Reset bootstrap cache — prevents post-logout reload from returning a cached stale result
  _bootstrapPromise = null;
  // credentials:include sends RT cookie so backend can revoke + clear it
  fetch(`${API_BASE}/api/v1/auth/logout`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  }).catch(() => {});
  localStorage.removeItem('user');
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  authChannel?.postMessage({ type: 'logout' });
}

export function isAuthenticated(): boolean {
  if (typeof window === 'undefined') return false;
  return !!(_accessToken && getUser());
}

const ALLOWED_PREFIXES = ['/dashboard', '/admin', '/pharmacy', '/driver'];

export function resolveNext(role?: string, pendingApproval?: boolean): string {
  if (typeof window === 'undefined') return getRoleRedirect(role, pendingApproval);
  const next = sessionStorage.getItem('postAuthRedirect');
  if (next) sessionStorage.removeItem('postAuthRedirect');
  if (next && ALLOWED_PREFIXES.some(p => next.startsWith(p))) return next;
  return getRoleRedirect(role, pendingApproval);
}
