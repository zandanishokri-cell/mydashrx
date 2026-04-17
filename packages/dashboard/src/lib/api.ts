import { clearSession } from './auth';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

let _isRefreshing = false;
let _refreshQueue: Array<(token: string | null) => void> = [];

async function attemptSilentRefresh(): Promise<string | null> {
  const rt = typeof window !== 'undefined' ? localStorage.getItem('refreshToken') : null;
  if (!rt) return null;
  try {
    const res = await fetch(`${BASE}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: rt }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    localStorage.setItem('accessToken', data.accessToken);
    if (data.refreshToken) localStorage.setItem('refreshToken', data.refreshToken);
    return data.accessToken;
  } catch { return null; }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token =
    typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  const res = await fetch(`${BASE}/api/v1${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 401 && typeof window !== 'undefined') {
      if (_isRefreshing) {
        const newToken = await new Promise<string | null>(resolve => { _refreshQueue.push(resolve); });
        if (!newToken) { clearSession(); throw new Error(`API 401: ${text}`); }
        return request(path, { ...init, headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${newToken}` } });
      }
      _isRefreshing = true;
      const newToken = await attemptSilentRefresh();
      _isRefreshing = false;
      _refreshQueue.forEach(cb => cb(newToken));
      _refreshQueue = [];
      if (newToken) {
        return request(path, { ...init, headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${newToken}` } });
      }
      clearSession();
      window.location.replace('/login');
    }
    throw new Error(`API ${res.status}: ${text}`);
  }
  if (res.status === 204 || res.headers.get('content-length') === '0') return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: async <T>(path: string, formData: FormData): Promise<T> => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
    const res = await fetch(`${BASE}/api/v1${path}`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });
    if (!res.ok) {
      const text = await res.text();
      if (res.status === 401 && typeof window !== 'undefined') {
        const newToken = await attemptSilentRefresh();
        if (newToken) {
          const retry = await fetch(`${BASE}/api/v1${path}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${newToken}` },
            body: formData,
          });
          if (retry.ok) return retry.json() as Promise<T>;
        }
        clearSession();
        window.location.replace('/login');
      }
      throw new Error(`API ${res.status}: ${text}`);
    }
    return res.json() as Promise<T>;
  },
};
