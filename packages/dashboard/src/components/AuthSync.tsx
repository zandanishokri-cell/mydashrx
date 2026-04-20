'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { setAccessToken } from '@/lib/auth';

export function AuthSync() {
  const router = useRouter();
  useEffect(() => {
    // OPUS-AUDIT-19: feature-detect — Safari <15.4 lacks BroadcastChannel. Without the guard
    // the useEffect throws ReferenceError on mount and the whole app white-screens.
    if (typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel('mydashrx_auth');
    ch.onmessage = (e) => {
      if (e.data?.type === 'logout') {
        setAccessToken(null);
        ['accessToken', 'refreshToken', 'user'].forEach(k => localStorage.removeItem(k));
        router.replace('/login');
      }
      // P-SES8: P-SEC28: sync AT (in-memory) — RT stays in httpOnly cookie, no localStorage needed
      if (e.data?.type === 'token_refreshed' && e.data.accessToken) {
        setAccessToken(e.data.accessToken);
      }
    };
    return () => ch.close();
  }, [router]);
  return null;
}
