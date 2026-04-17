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
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('user');
  authChannel?.postMessage({ type: 'logout' });
}

export function isAuthenticated(): boolean {
  if (typeof window === 'undefined') return false;
  return !!(getUser() && localStorage.getItem('accessToken'));
}
