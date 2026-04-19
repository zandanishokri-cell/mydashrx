'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { setAccessToken } from '@/lib/auth';

export function AuthSync() {
  const router = useRouter();
  useEffect(() => {
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
