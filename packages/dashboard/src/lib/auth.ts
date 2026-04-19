import type { User } from '@mydash-rx/shared';

// P-SEC28: AT in module-level variable (not localStorage) — invisible to XSS.
// RT is httpOnly cookie set by backend — never JS-accessible.
// Only non-sensitive user JSON remains in localStorage.
let _accessToken: string | null = null;
export function getAccessToken(): string | null { return _accessToken; }
export function setAccessToken(at: string | null) { _accessToken = at; }

export function getUser(): User | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('user');
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

const authChannel = typeof window !== 'undefined' ? new BroadcastChannel('mydashrx_auth') : null;

export function setSession(tokens: {
  accessToken: string;
  refreshToken?: string; // optional — RT is now httpOnly cookie, not stored in JS
  user: User;
}) {
  _accessToken = tokens.accessToken;
  localStorage.setItem('user', JSON.stringify(tokens.user));
  // Legacy cleanup: remove stale tokens from pre-SEC28 localStorage flow
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
}

export function clearSession() {
  _accessToken = null;
  const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
  // credentials:include sends RT cookie so backend can revoke + clear it
  fetch(`${base}/api/v1/auth/logout`, {
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

const ROLE_REDIRECTS: Record<string, string> = {
  super_admin: '/admin',
  pharmacy_admin: '/dashboard',
  dispatcher: '/dashboard',
  driver: '/driver/routes',
};

const ALLOWED_PREFIXES = ['/dashboard', '/admin', '/pharmacy', '/driver'];

export function getRoleRedirect(role?: string, pendingApproval?: boolean): string {
  if (pendingApproval) return '/onboarding/waiting';
  return ROLE_REDIRECTS[role ?? ''] ?? '/dashboard';
}

export function resolveNext(role?: string, pendingApproval?: boolean): string {
  if (typeof window === 'undefined') return getRoleRedirect(role, pendingApproval);
  const next = sessionStorage.getItem('postAuthRedirect');
  if (next) sessionStorage.removeItem('postAuthRedirect');
  if (next && ALLOWED_PREFIXES.some(p => next.startsWith(p))) return next;
  return getRoleRedirect(role, pendingApproval);
}
