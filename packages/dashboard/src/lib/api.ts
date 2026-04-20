'use client';
import { clearSession, getAccessToken, setAccessToken, serverAdjustedNow, updateSkewFromResponse } from './auth';
import { API_BASE as BASE } from './config';

// P-RBAC31: impersonation header — set by layout, injected into every request
let _impersonateOrgId: string | null = null;
export const setImpersonateOrgId = (orgId: string | null) => { _impersonateOrgId = orgId; };
export const getImpersonateOrgId = () => _impersonateOrgId;

let _isRefreshing = false;
let _refreshQueue: Array<(token: string | null) => void> = [];

function decodeExp(token: string): number {
  try { return (JSON.parse(atob(token.split('.')[1])) as { exp?: number }).exp ?? 0; }
  catch { return 0; }
}

// P-SEC28: AT refreshed from httpOnly RT cookie via credentials:include — no JS-readable RT needed
async function attemptSilentRefresh(): Promise<string | null> {
  try {
    const res = await fetch(`${BASE}/api/v1/auth/refresh`, {
      method: 'POST',
      credentials: 'include', // sends RT httpOnly cookie automatically
      headers: { 'Content-Type': 'application/json' },
      // No body — RT comes from httpOnly cookie (dual-read: backend also accepts body for legacy)
    });
    updateSkewFromResponse(res);
    if (!res.ok) return null;
    const data = await res.json();
    setAccessToken(data.accessToken ?? null);
    // P-SES8: broadcast new AT to all other open tabs
    try {
      new BroadcastChannel('mydashrx_auth').postMessage({
        type: 'token_refreshed',
        accessToken: data.accessToken,
      });
    } catch { /* SSR/worker context */ }
    return data.accessToken ?? null;
  } catch { return null; }
}

// P-SES9 / OPUS-AUDIT-4: shared single-flight refresh — dedupes parallel callers,
// used by BOTH proactive (pre-request) and reactive (401 retry) paths so N concurrent
// requests produce at most one /auth/refresh call.
async function singleFlightRefresh(): Promise<string | null> {
  if (_isRefreshing) {
    return new Promise<string | null>(resolve => { _refreshQueue.push(resolve); });
  }
  _isRefreshing = true;
  const newToken = await attemptSilentRefresh();
  _isRefreshing = false;
  _refreshQueue.forEach(cb => cb(newToken));
  _refreshQueue = [];
  return newToken;
}

function handleRefreshFailure(): never {
  clearSession();
  if (typeof window !== 'undefined') window.location.replace('/login');
  throw new Error('Session expired');
}

async function refreshAndRetry<T>(retryFn: (newToken: string) => Promise<T>): Promise<T> {
  const newToken = await singleFlightRefresh();
  if (!newToken) handleRefreshFailure();
  return retryFn(newToken);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // P-SEC28: read AT from in-memory variable (not localStorage)
  let token = getAccessToken();

  // P-SES7 / OPUS-AUDIT-4: proactive refresh if AT expires within 60s.
  // Uses singleFlightRefresh so N parallel callers collapse to one /auth/refresh hit.
  // On null return (RT invalid), skip the request — firing a dead AT guarantees 401
  // which would trigger a SECOND refresh via refreshAndRetry.
  if (token) {
    const exp = decodeExp(token);
    if (exp && exp * 1000 - serverAdjustedNow() < 120_000) {
      const fresh = await singleFlightRefresh();
      if (!fresh) handleRefreshFailure();
      token = fresh;
    }
  }

  const res = await fetch(`${BASE}/api/v1${path}`, {
    ...init,
    credentials: 'include', // P-SEC28: include RT cookie on all requests (needed for refresh)
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(_impersonateOrgId ? { 'X-Impersonate-Org': _impersonateOrgId } : {}),
      ...(init?.headers ?? {}),
    },
  });
  updateSkewFromResponse(res);
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
    // P-SES28 / OPUS-AUDIT-4: proactive pre-refresh via singleFlightRefresh (same guard as request()).
    let token = getAccessToken();
    if (token) {
      const exp = decodeExp(token);
      if (exp && exp * 1000 - serverAdjustedNow() < 120_000) {
        const fresh = await singleFlightRefresh();
        if (!fresh) handleRefreshFailure();
        token = fresh;
      }
    }
    const res = await fetch(`${BASE}/api/v1${path}`, {
      method: 'POST',
      credentials: 'include', // P-SEC28
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });
    updateSkewFromResponse(res);

    if (!res.ok) {
      if (res.status === 401 && typeof window !== 'undefined') {
        // P-SES9: upload uses same single-flight guard as request()
        return refreshAndRetry(async (newToken) => {
          const retry = await fetch(`${BASE}/api/v1${path}`, {
            method: 'POST',
            credentials: 'include',
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
