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
    };
    return () => ch.close();
  }, [router]);
  return null;
}
