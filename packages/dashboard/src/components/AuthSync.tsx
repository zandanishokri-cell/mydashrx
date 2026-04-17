'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export function AuthSync() {
  const router = useRouter();
  useEffect(() => {
    const ch = new BroadcastChannel('mydashrx_auth');
    ch.onmessage = (e) => {
      if (e.data?.type === 'logout') {
        ['accessToken', 'refreshToken', 'user'].forEach(k => localStorage.removeItem(k));
        router.replace('/login');
      }
      // P-SES8: sync refreshed tokens to prevent stale-RT replay across tabs
      if (e.data?.type === 'token_refreshed' && e.data.accessToken && e.data.refreshToken) {
        localStorage.setItem('accessToken', e.data.accessToken);
        localStorage.setItem('refreshToken', e.data.refreshToken);
      }
    };
    return () => ch.close();
  }, [router]);
  return null;
}
