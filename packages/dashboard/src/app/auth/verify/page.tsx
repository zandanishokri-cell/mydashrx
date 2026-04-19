'use client';
import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { setSession, resolveNext } from '@/lib/auth';
import type { AuthTokens } from '@mydash-rx/shared';

const LINK_EXPIRY_SECS = 15 * 60;

function VerifyContent() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token');
  const hintEmail = params.get('email') ?? '';
  const [status, setStatus] = useState<'validating' | 'valid' | 'confirming' | 'success' | 'error'>('validating');
  const [errorMsg, setErrorMsg] = useState('');
  const [validatedEmail, setValidatedEmail] = useState('');
  const [resendEmail, setResendEmail] = useState(hintEmail);
  const [resendStatus, setResendStatus] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [showOtp, setShowOtp] = useState(!token);
  const [otpEmail, setOtpEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpError, setOtpError] = useState('');
  const [secsLeft, setSecsLeft] = useState(LINK_EXPIRY_SECS);
  // P-ML9: cancel + device context state
  const [cancelStatus, setCancelStatus] = useState<'idle' | 'cancelling' | 'cancelled'>('idle');
  const deviceLabel = typeof navigator !== 'undefined'
    ? (/mobile/i.test(navigator.userAgent) ? 'Mobile device' : /tablet|ipad/i.test(navigator.userAgent) ? 'Tablet' : 'Desktop / Laptop')
    : 'Unknown device';

  // Expiry countdown — runs while link is active
  useEffect(() => {
    if (status === 'confirming' || status === 'success' || status === 'error') return;
    const t = setInterval(() => setSecsLeft(s => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [status]);

  // Auto-redirect when countdown hits 0
  useEffect(() => {
    if (secsLeft === 0 && (status === 'validating' || status === 'valid')) {
      router.push('/login?expired=1');
    }
  }, [secsLeft, status]);

  const expiryMins = Math.floor(secsLeft / 60);
  const expirySecs = secsLeft % 60;
  const expiryStr = secsLeft > 60 ? `${expiryMins}m ${expirySecs}s` : `${secsLeft}s`;
  const expiryColor = secsLeft < 30 ? 'text-red-500' : secsLeft < 120 ? 'text-amber-500' : 'text-gray-400';

  useEffect(() => {
    if (!token) { setStatus('error'); setErrorMsg('No sign-in token found. Please request a new link.'); return; }
    const verifyUrl = `/auth/magic-link/verify?token=${encodeURIComponent(token)}`;
    const parseErr = (err: Error) => {
      const raw = err.message ?? '';
      const match = raw.match(/\{.*\}/s);
      let msg = 'This link is invalid or has expired.';
      if (match) { try { const p = JSON.parse(match[0]); msg = p.error ?? msg; } catch { /* ignore */ } }
      return msg;
    };
    api.get<{ valid: boolean; email: string; token: string }>(verifyUrl)
      .then((res) => { setValidatedEmail(res.email); setResendEmail(res.email); setStatus('valid'); })
      .catch(async (err: Error) => {
        const msg = parseErr(err);
        // If the error looks like a network/cold-start failure (not a specific API error),
        // wait 35s for Render to wake up and retry once.
        if (msg === 'This link is invalid or has expired.') {
          await new Promise(r => setTimeout(r, 35_000));
          try {
            const res = await api.get<{ valid: boolean; email: string; token: string }>(verifyUrl);
            setValidatedEmail(res.email); setStatus('valid'); return;
          } catch (retryErr: unknown) {
            setErrorMsg(parseErr(retryErr as Error));
            setStatus('error'); return;
          }
        }
        setErrorMsg(msg);
        setStatus('error');
      });
  }, [token]);

  async function handleCancel() {
    if (!token || cancelStatus !== 'idle') return;
    setCancelStatus('cancelling');
    try {
      await api.post('/auth/magic-link/cancel', { token });
      setCancelStatus('cancelled');
    } catch {
      setCancelStatus('idle'); // fail-open — don't block user
    }
  }

  function handleConfirm() {
    setStatus('confirming');
    api.post<AuthTokens>('/auth/magic-link/confirm', { token })
      .then((tokens) => {
        setSession(tokens);
        setStatus('success');
        const u = tokens.user as any;
        const dest = resolveNext(u.role, u.org?.pendingApproval);
        router.replace(u.mustChangePassword ? '/change-password' : dest);
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
      const u = tokens.user as any;
      const dest = resolveNext(u.role, u.org?.pendingApproval);
      router.replace(u.mustChangePassword ? '/change-password' : dest);
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
          <p id="otp-hint" className="text-gray-500 text-sm">Enter the 6-digit code from your email.</p>
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
              autoComplete="one-time-code"
              aria-label="6-digit verification code"
              aria-describedby="otp-hint"
              value={otpCode}
              onChange={e => setOtpCode(e.target.value.replace(/[^\d\s]/g, ''))}
              onPaste={e => {
                const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
                if (pasted) { e.preventDefault(); setOtpCode(pasted.slice(0,3) + (pasted.length > 3 ? ' ' + pasted.slice(3) : '')); }
              }}
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
        <p className="text-gray-600 text-sm mb-2">Verifying your link… (this may take up to 30 seconds)</p>
        <p className={`text-xs ${expiryColor}`}>
          {secsLeft > 0 ? `Link valid for ${expiryStr}` : 'Link may have expired — redirecting…'}
        </p>
      </div>
    );
  }

  if (status === 'valid') {
    if (cancelStatus === 'cancelled') {
      return (
        <div className="text-center">
          <div className="w-12 h-12 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-base font-semibold text-gray-900 mb-2">Sign-in link cancelled</h2>
          <p className="text-gray-500 text-sm mb-4">This link has been invalidated. Please request a new magic link from your intended device.</p>
          <a href="/login" className="w-full bg-[#0F4C81] text-white rounded-lg px-5 py-3 text-sm font-semibold hover:bg-[#0d3d69] transition-colors block">
            Request new link
          </a>
        </div>
      );
    }

    return (
      <div className="text-center">
        <div className="w-12 h-12 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-6 h-6 text-[#0F4C81]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
          </svg>
        </div>
        <h2 className="text-base font-semibold text-gray-900 mb-2">Complete your sign in</h2>
        {validatedEmail && <p className="text-gray-500 text-sm mb-3">Signing in as <span className="font-medium text-gray-700">{validatedEmail}</span></p>}

        {/* P-ML9: Device context panel — helps user detect shared-computer HIPAA risk */}
        <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 mb-5 text-left">
          <p className="text-xs text-gray-500 mb-1 font-medium">Signing in on</p>
          <p className="text-sm text-gray-800 font-medium">{deviceLabel}</p>
          <p className="text-xs text-gray-400 mt-1.5">Not the right device? <button onClick={handleCancel} disabled={cancelStatus === 'cancelling'} className="text-[#0F4C81] underline underline-offset-2 hover:text-[#0d3d69] disabled:opacity-50">{cancelStatus === 'cancelling' ? 'Cancelling…' : 'Cancel this link'}</button> and request a new one on your intended device.</p>
        </div>

        <button
          onClick={handleConfirm}
          className="w-full bg-[#0F4C81] text-white rounded-lg px-5 py-3 text-sm font-semibold hover:bg-[#0d3d69] transition-colors"
        >
          Sign in to MyDashRx
        </button>
        <p className={`text-xs mt-4 ${expiryColor}`}>
          {secsLeft > 0 ? `Link valid for ${expiryStr} · single use` : 'Link may have expired'}
        </p>
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

  // P-ML13: Expired/invalid link — inline one-click resend
  const handleResend = async () => {
    if (!resendEmail) return;
    setResendStatus('sending');
    try {
      await api.post('/auth/magic-link/request', { email: resendEmail });
      setResendStatus('sent');
    } catch {
      setResendStatus('idle');
    }
  };

  return (
    <div className="text-center">
      <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
        <svg className="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </div>
      <h2 className="text-base font-semibold text-gray-900 mb-2">Link expired or invalid</h2>
      <p className="text-gray-500 text-sm mb-4">{errorMsg}</p>

      {resendStatus === 'sent' ? (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-3">
          <p className="text-green-700 text-sm font-medium">New link sent — check your inbox.</p>
          <p className="text-green-600 text-xs mt-1">Check spam if you don't see it in 30 seconds.</p>
        </div>
      ) : (
        <div className="mb-3">
          {!resendEmail && (
            <input
              type="email"
              value={resendEmail}
              onChange={e => setResendEmail(e.target.value)}
              placeholder="your@email.com"
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          )}
          <button
            onClick={handleResend}
            disabled={resendStatus === 'sending' || !resendEmail}
            className="w-full bg-[#0F4C81] text-white rounded-lg px-5 py-2.5 text-sm font-semibold hover:bg-[#0d3d69] disabled:opacity-50 transition-colors"
          >
            {resendStatus === 'sending' ? 'Sending…' : resendEmail ? `Resend link to ${resendEmail}` : 'Send new link'}
          </button>
        </div>
      )}

      <button onClick={() => setShowOtp(true)} className="w-full border border-gray-200 text-gray-600 rounded-lg px-5 py-2.5 text-sm font-medium hover:bg-gray-50 transition-colors mb-2">
        Enter verification code instead
      </button>
      <a href="/login" className="inline-block text-xs text-gray-400 hover:text-gray-600">
        Back to sign in
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
