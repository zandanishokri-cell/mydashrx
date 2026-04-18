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

const ALLOWED_PREFIXES = ['/dashboard'];

export function resolveNext(): string {
  if (typeof window === 'undefined') return '/dashboard';
  const next = sessionStorage.getItem('postAuthRedirect');
  if (next) sessionStorage.removeItem('postAuthRedirect');
  if (next && ALLOWED_PREFIXES.some(p => next.startsWith(p))) return next;
  return '/dashboard';
}
