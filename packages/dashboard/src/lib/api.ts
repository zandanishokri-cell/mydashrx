'use client';
import { clearSession } from './auth';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

let _isRefreshing = false;
let _refreshQueue: Array<(token: string | null) => void> = [];

function decodeExp(token: string): number {
  try { return (JSON.parse(atob(token.split('.')[1])) as { exp?: number }).exp ?? 0; }
  catch { return 0; }
}

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
    // P-SES8: broadcast new tokens to all other open tabs
    try {
      new BroadcastChannel('mydashrx_auth').postMessage({
        type: 'token_refreshed',
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
      });
    } catch { /* SSR/worker context */ }
    return data.accessToken;
  } catch { return null; }
}

// P-SES9: shared single-flight helper used by both request() and upload()
async function refreshAndRetry<T>(retryFn: (newToken: string) => Promise<T>): Promise<T> {
  if (_isRefreshing) {
    const newToken = await new Promise<string | null>(resolve => { _refreshQueue.push(resolve); });
    if (!newToken) { clearSession(); throw new Error('Session expired'); }
    return retryFn(newToken);
  }
  _isRefreshing = true;
  const newToken = await attemptSilentRefresh();
  _isRefreshing = false;
  _refreshQueue.forEach(cb => cb(newToken));
  _refreshQueue = [];
  if (!newToken) { clearSession(); window.location.replace('/login'); throw new Error('Session expired'); }
  return retryFn(newToken);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;

  // P-SES7: proactive refresh if AT expires within 60s
  if (token && !_isRefreshing) {
    const exp = decodeExp(token);
    if (exp && exp * 1000 - Date.now() < 60_000) {
      const fresh = await attemptSilentRefresh();
      if (fresh) token = fresh;
    }
  }

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
      return refreshAndRetry((newToken) =>
        request(path, { ...init, headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${newToken}` } })
      );
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
      if (res.status === 401 && typeof window !== 'undefined') {
        // P-SES9: upload now uses same single-flight guard as request()
        return refreshAndRetry(async (newToken) => {
          const retry = await fetch(`${BASE}/api/v1${path}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${newToken}` },
            body: formData,
          });
          if (!retry.ok) throw new Error(`Upload retry failed: ${retry.status}`);
          return retry.json() as Promise<T>;
        });
      }
      const text = await res.text();
      throw new Error(`API ${res.status}: ${text}`);
    }
    return res.json() as Promise<T>;
  },
};
