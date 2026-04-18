import type { User } from '@mydash-rx/shared';

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
  refreshToken: string;
  user: User;
}) {
  localStorage.setItem('accessToken', tokens.accessToken);
  localStorage.setItem('refreshToken', tokens.refreshToken);
  localStorage.setItem('user', JSON.stringify(tokens.user));
}

export function clearSession() {
  const rt = typeof window !== 'undefined' ? localStorage.getItem('refreshToken') : null;
  if (rt) {
    const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
    fetch(`${base}/api/v1/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: rt }),
    }).catch(() => {});
  }
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('user');
  authChannel?.postMessage({ type: 'logout' });
}

export function isAuthenticated(): boolean {
  if (typeof window === 'undefined') return false;
  return !!(getUser() && localStorage.getItem('accessToken'));
}

const ROLE_REDIRECTS: Record<string, string> = {
  super_admin: '/admin',
  pharmacy_admin: '/pharmacy/dashboard',
  dispatcher: '/dispatch/queue',
  driver: '/driver/routes',
};

const ALLOWED_PREFIXES = ['/dashboard', '/admin', '/pharmacy', '/dispatch', '/driver'];

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
