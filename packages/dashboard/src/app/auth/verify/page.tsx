'use client';
import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { setSession } from '@/lib/auth';
import type { AuthTokens } from '@mydash-rx/shared';

function VerifyContent() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token');
  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>('verifying');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!token) {
      setErrorMsg('No token found in this link.');
      setStatus('error');
      return;
    }

    api.get<AuthTokens>(`/auth/magic-link/verify?token=${encodeURIComponent(token)}`)
      .then((tokens) => {
        setSession(tokens);
        setStatus('success');
        router.replace((tokens.user as any).mustChangePassword ? '/change-password' : '/dashboard');
      })
      .catch((err: Error) => {
        const raw = err.message ?? '';
        const match = raw.match(/\{.*\}/);
        if (match) {
          try {
            const parsed = JSON.parse(match[0]);
            if (parsed.pendingApproval) { router.replace('/pending-approval'); return; }
            setErrorMsg(parsed.error ?? 'This link is invalid or has expired.');
          } catch { setErrorMsg('This link is invalid or has expired.'); }
        } else {
          setErrorMsg('This link is invalid or has expired.');
        }
        setStatus('error');
      });
  }, [token]);

  if (status === 'verifying') {
    return (
      <div className="text-center">
        <div className="w-10 h-10 border-2 border-[#0F4C81] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-gray-600 text-sm">Signing you in…</p>
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div className="text-center">
        <div className="w-12 h-12 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <p className="text-gray-600 text-sm">Signed in. Redirecting…</p>
      </div>
    );
  }

  return (
    <div className="text-center">
      <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
        <svg className="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </div>
      <h2 className="text-base font-semibold text-gray-900 mb-2">Link expired or invalid</h2>
      <p className="text-gray-500 text-sm mb-6">{errorMsg}</p>
      <a
        href="/login"
        className="inline-block bg-[#0F4C81] text-white rounded-lg px-5 py-2.5 text-sm font-medium hover:bg-[#0d3d69] transition-colors"
      >
        Request a new link
      </a>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F7F8FC]">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
        <h1 className="text-xl font-bold text-[#0F4C81] mb-6 text-center" style={{ fontFamily: 'var(--font-sora)' }}>
          MyDashRx
        </h1>
        <Suspense fallback={<div className="text-center"><div className="w-8 h-8 border-2 border-[#0F4C81] border-t-transparent rounded-full animate-spin mx-auto" /></div>}>
          <VerifyContent />
        </Suspense>
      </div>
    </div>
  );
}
