'use client';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function AuthCallback() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === 'loading') return;
    if (status === 'unauthenticated') { router.replace('/login'); return; }
    const s = session as any;
    if (s?.accessToken && s?.myUser) {
      localStorage.setItem('accessToken', s.accessToken);
      localStorage.setItem('refreshToken', s.refreshToken ?? '');
      localStorage.setItem('user', JSON.stringify(s.myUser));
      router.replace(s.myUser.mustChangePassword ? '/change-password' : '/dashboard');
    }
  }, [session, status, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F7F8FC]">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-[#0F4C81] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm text-gray-500">Signing you in…</p>
      </div>
    </div>
  );
}
