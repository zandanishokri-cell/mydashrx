'use client';
import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { setSession, resolveNext } from '@/lib/auth';
import type { AuthTokens } from '@mydash-rx/shared';

function VerifyContent() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token');
  const [status, setStatus] = useState<'validating' | 'valid' | 'confirming' | 'success' | 'error'>('validating');
  const [errorMsg, setErrorMsg] = useState('');
  const [validatedEmail, setValidatedEmail] = useState('');
  const [showOtp, setShowOtp] = useState(!token);
  const [otpEmail, setOtpEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpError, setOtpError] = useState('');

  useEffect(() => {
    if (!token) { setStatus('error'); setErrorMsg('No sign-in token found. Please request a new link.'); return; }
    api.get<{ valid: boolean; email: string; token: string }>(`/auth/magic-link/verify?token=${encodeURIComponent(token)}`)
      .then((res) => { setValidatedEmail(res.email); setStatus('valid'); })
      .catch((err: Error) => {
        const raw = err.message ?? '';
        const match = raw.match(/\{.*\}/);
        let msg = 'This link is invalid or has expired.';
        if (match) {
          try { const p = JSON.parse(match[0]); msg = p.error ?? msg; } catch { /* ignore */ }
        }
        setErrorMsg(msg);
        setStatus('error');
      });
  }, [token]);

  function handleConfirm() {
    setStatus('confirming');
    api.post<AuthTokens>('/auth/magic-link/confirm', { token })
      .then((tokens) => {
        setSession(tokens);
        setStatus('success');
        const dest = resolveNext();
        router.replace((tokens.user as any).mustChangePassword ? '/change-password' : dest);
      })
      .catch((err: Error) => {
        const raw = err.message ?? '';
        const match = raw.match(/\{.*\}/);
        let msg = 'This link is invalid or has expired.';
        if (match) {
          try {
            const p = JSON.parse(match[0]);
            if (p.pendingApproval) { router.replace('/pending-approval'); return; }
            msg = p.error ?? msg;
          } catch { /* ignore */ }
        }
        setErrorMsg(msg);
        setStatus('error');
      });
  }

  async function handleOtpSubmit(e: React.FormEvent) {
    e.preventDefault();
    setOtpLoading(true);
    setOtpError('');
    try {
      const tokens = await api.post<AuthTokens>('/auth/magic-link/verify-code', { email: otpEmail, code: otpCode });
      setSession(tokens);
      const dest = resolveNext();
      router.replace((tokens.user as any).mustChangePassword ? '/change-password' : dest);
    } catch (err: Error | unknown) {
      const raw = (err as Error).message ?? '';
      const match = raw.match(/\{.*\}/);
      let msg = 'Invalid or expired code.';
      if (match) {
        try {
          const p = JSON.parse(match[0]);
          if (p.pendingApproval) { router.replace('/pending-approval'); return; }
          msg = p.error ?? msg;
        } catch { /* ignore */ }
      }
      setOtpError(msg);
    } finally {
      setOtpLoading(false);
    }
  }

  if (showOtp) {
    return (
      <div>
        <div className="text-center mb-5">
          <div className="w-12 h-12 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-[#0F4C81]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h2 className="text-base font-semibold text-gray-900 mb-1">Enter your verification code</h2>
          <p className="text-gray-500 text-sm">Enter the 6-digit code from your email.</p>
        </div>
        <form onSubmit={handleOtpSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Email address</label>
            <input
              type="email"
              value={otpEmail}
              onChange={e => setOtpEmail(e.target.value)}
              placeholder="you@pharmacy.com"
              required
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Verification code</label>
            <input
              type="text"
              inputMode="numeric"
              value={otpCode}
              onChange={e => setOtpCode(e.target.value.replace(/[^\d\s]/g, ''))}
              placeholder="123 456"
              maxLength={7}
              required
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm font-mono tracking-widest text-center focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>
          {otpError && <p className="text-red-500 text-sm">{otpError}</p>}
          <button
            type="submit"
            disabled={otpLoading}
            className="w-full bg-[#0F4C81] text-white rounded-lg px-5 py-3 text-sm font-semibold hover:bg-[#0d3d69] disabled:opacity-50 transition-colors"
          >
            {otpLoading ? 'Verifying…' : 'Verify code'}
          </button>
        </form>
        {token && (
          <button onClick={() => setShowOtp(false)} className="mt-4 w-full text-xs text-gray-400 hover:text-gray-600">
            Use sign-in link instead
          </button>
        )}
        <div className="mt-4 text-center">
          <a href="/login" className="text-xs text-gray-400 hover:text-[#0F4C81]">Request a new link</a>
        </div>
      </div>
    );
  }

  if (status === 'validating') {
    return (
      <div className="text-center">
        <div className="w-10 h-10 border-2 border-[#0F4C81] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-gray-600 text-sm">Verifying your link…</p>
      </div>
    );
  }

  if (status === 'valid') {
    return (
      <div className="text-center">
        <div className="w-12 h-12 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-6 h-6 text-[#0F4C81]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
          </svg>
        </div>
        <h2 className="text-base font-semibold text-gray-900 mb-2">Complete your sign in</h2>
        {validatedEmail && <p className="text-gray-500 text-sm mb-4">Signing in as <span className="font-medium text-gray-700">{validatedEmail}</span></p>}
        <p className="text-gray-500 text-sm mb-6">Click below to securely sign in to MyDashRx.</p>
        <button
          onClick={handleConfirm}
          className="w-full bg-[#0F4C81] text-white rounded-lg px-5 py-3 text-sm font-semibold hover:bg-[#0d3d69] transition-colors"
        >
          Sign in to MyDashRx
        </button>
        <p className="text-xs text-gray-400 mt-4">This link expires in 15 minutes and can only be used once.</p>
        <button onClick={() => setShowOtp(true)} className="mt-3 text-xs text-gray-400 hover:text-[#0F4C81] block w-full">
          Use verification code instead
        </button>
      </div>
    );
  }

  if (status === 'confirming') {
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
      <p className="text-gray-500 text-sm mb-4">{errorMsg}</p>
      <button onClick={() => setShowOtp(true)} className="w-full bg-[#0F4C81] text-white rounded-lg px-5 py-2.5 text-sm font-medium hover:bg-[#0d3d69] transition-colors mb-3">
        Enter verification code instead
      </button>
      <a href="/login" className="inline-block text-sm text-gray-400 hover:text-gray-600">
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
