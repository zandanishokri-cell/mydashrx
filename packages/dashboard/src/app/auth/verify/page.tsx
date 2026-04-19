'use client';
import { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { setSession, resolveNext } from '@/lib/auth';
import type { AuthTokens } from '@mydash-rx/shared';
import { PasskeyEnrollModal } from '@/components/PasskeyEnrollModal';
import { collectFingerprint } from '@/lib/deviceFingerprint';

const LINK_EXPIRY_SECS = 15 * 60;

function VerifyContent() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token');
  const isProtected = params.get('protected') === '1';
  const hintEmail = params.get('email') ?? '';
  // P-ML22: protected mode — show human-confirmation buffer before proceeding
  const [protectedReady, setProtectedReady] = useState(!isProtected);
  const [status, setStatus] = useState<'validating' | 'valid' | 'confirming' | 'success' | 'error'>('validating');
  const [errorMsg, setErrorMsg] = useState('');
  const [isOutlookHint, setIsOutlookHint] = useState(false);
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
  // P-SES22: Trust device prompt shown after successful confirm
  const [showTrustPrompt, setShowTrustPrompt] = useState(false);
  // P-ML19: pending retry on tab-return — if user was on another tab while validating
  const pendingRetryRef = useRef(false);
  // P-ML18: passkey enrollment modal shown after verify + trust prompt
  const [showPasskeyModal, setShowPasskeyModal] = useState(false);
  const [trustDestination, setTrustDestination] = useState('');
  // P-ML24: step-up OTP required (geo anomaly)
  const [stepUpRequired, setStepUpRequired] = useState(false);
  const [stepUpOtp, setStepUpOtp] = useState('');
  const [stepUpLoading, setStepUpLoading] = useState(false);
  const [stepUpError, setStepUpError] = useState('');
  // P-ML26: cross-device auth resolution
  const [crossDeviceCode, setCrossDeviceCode] = useState('');
  const [crossDevicePrompt, setCrossDevicePrompt] = useState(false);
  const [crossDeviceLoading, setCrossDeviceLoading] = useState(false);
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

  // P-ML26: SSE cross-device polling — when device B confirms, device A gets notified
  useEffect(() => {
    const requestId = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('mdrx_magic_request_id') : null;
    if (!requestId || status === 'success' || status === 'confirming') return;
    const API = process.env.NEXT_PUBLIC_API_URL ?? 'https://mydashrx-backend.onrender.com';
    const evtSource = new EventSource(`${API}/api/v1/auth/magic-link/status/${requestId}`);
    evtSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data as string) as { status: string; crossDeviceCode?: string };
        if (data.status === 'completed_cross_device' && data.crossDeviceCode) {
          evtSource.close();
          setCrossDeviceCode(data.crossDeviceCode);
          setCrossDevicePrompt(true);
        }
        if (data.status === 'expired' || data.status === 'timeout' || data.status === 'not_found') {
          evtSource.close();
        }
      } catch { /* ignore parse errors */ }
    };
    evtSource.onerror = () => evtSource.close();
    return () => evtSource.close();
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  // P-ML19: Page Visibility API — when user returns to this tab, re-trigger verify if not yet confirmed
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === 'visible' && pendingRetryRef.current) {
        pendingRetryRef.current = false;
        if (status === 'valid' || status === 'validating') {
          // Force re-attempt by re-running the verify effect — handled via status reset
          // Actually: just trigger confirm if we're in 'valid' state (user clicked link, returned)
          if (status === 'valid') handleConfirm();
        }
      } else if (document.visibilityState === 'hidden') {
        pendingRetryRef.current = true;
      }
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // P-ML22: don't verify until human has clicked through the protected buffer page
    if (!protectedReady) return;
    if (!token) { setStatus('error'); setErrorMsg('No sign-in token found. Please request a new link.'); return; }
    const verifyUrl = `/auth/magic-link/verify?token=${encodeURIComponent(token)}`;
    const parseErr = (err: Error) => {
      const raw = err.message ?? '';
      const match = raw.match(/\{.*\}/s);
      let msg = 'This link is invalid or has expired.';
      if (match) {
        try {
          const p = JSON.parse(match[0]);
          // P-ML22: Outlook scanner consumed token — show resend hint
          if (p.alreadyUsed && p.isOutlook) setIsOutlookHint(true);
          msg = p.error ?? msg;
        } catch { /* ignore */ }
      }
      return msg;
    };
    api.get<{ valid?: boolean; status?: string; email?: string; token?: string }>(verifyUrl)
      .then((res) => {
        // P-ML22: scanner detected by backend — stay in validating until human confirms
        if (res.status === 'valid' && !res.email) {
          // Re-poll after 1s — the human is expected to navigate here manually
          setTimeout(() => {
            api.get<{ valid?: boolean; status?: string; email?: string; token?: string }>(verifyUrl)
              .then((r2) => {
                if (r2.email) { setValidatedEmail(r2.email); setResendEmail(r2.email); setStatus('valid'); }
              }).catch(() => {});
          }, 1000);
          return;
        }
        if (res.email) { setValidatedEmail(res.email); setResendEmail(res.email); setStatus('valid'); }
      })
      .catch(async (err: Error) => {
        const msg = parseErr(err);
        if (msg === 'This link is invalid or has expired.') {
          await new Promise(r => setTimeout(r, 35_000));
          try {
            const res = await api.get<{ valid?: boolean; email?: string }>(verifyUrl);
            if (res.email) { setValidatedEmail(res.email); setStatus('valid'); }
            return;
          } catch (retryErr: unknown) {
            setErrorMsg(parseErr(retryErr as Error));
            setStatus('error'); return;
          }
        }
        setErrorMsg(msg);
        setStatus('error');
      });
  }, [token, protectedReady]); // eslint-disable-line react-hooks/exhaustive-deps

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
    const fp = collectFingerprint();
    // P-ML26: raw fetch to handle 202 (step_up_required) — api.post throws on non-2xx
    const API = process.env.NEXT_PUBLIC_API_URL ?? 'https://mydashrx-backend.onrender.com';
    fetch(`${API}/api/v1/auth/magic-link/confirm`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, fp }),
    })
      .then(async (res) => {
        // P-ML24: geo anomaly step-up required
        if (res.status === 202) {
          setStatus('valid'); // return to valid state so user can interact
          setStepUpRequired(true);
          return;
        }
        if (!res.ok) {
          const data = await res.json().catch(() => ({})) as { error?: string; pendingApproval?: boolean };
          if (data.pendingApproval) { router.replace('/pending-approval'); return; }
          setErrorMsg(data.error ?? 'This link is invalid or has expired.');
          setStatus('error');
          return;
        }
        const tokens = await res.json() as AuthTokens;
        setSession(tokens);
        setStatus('success');
        const u = tokens.user as { role?: string; org?: { pendingApproval?: boolean }; mustChangePassword?: boolean };
        const dest = resolveNext(u.role ?? '', u.org?.pendingApproval);
        const finalDest = u.mustChangePassword ? '/change-password' : dest;
        // P-SES22: Show trust prompt before redirecting (skip for pending approval / password change)
        if (!u.mustChangePassword && !u.org?.pendingApproval) {
          setTrustDestination(finalDest);
          setShowTrustPrompt(true);
        } else {
          router.replace(finalDest);
        }
      })
      .catch(() => {
        setErrorMsg('This link is invalid or has expired.');
        setStatus('error');
      });
  }

  // P-ML26: device A claims session after device B confirmed via SSE code
  const handleCrossDeviceClaim = async () => {
    const requestId = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('mdrx_magic_request_id') : null;
    if (!requestId || !crossDeviceCode) return;
    setCrossDeviceLoading(true);
    try {
      const tokens = await api.post<AuthTokens>('/auth/magic-link/claim-cross-device', { requestId, code: crossDeviceCode });
      sessionStorage.removeItem('mdrx_magic_request_id');
      setSession(tokens);
      setStatus('success');
      const u = tokens.user as { role?: string; org?: { pendingApproval?: boolean }; mustChangePassword?: boolean };
      const dest = resolveNext(u.role ?? '', u.org?.pendingApproval);
      router.replace(u.mustChangePassword ? '/change-password' : dest);
    } catch {
      setCrossDevicePrompt(false);
      setErrorMsg('The cross-device code expired or is invalid. Please request a new sign-in link.');
      setStatus('error');
    } finally {
      setCrossDeviceLoading(false);
    }
  };

  // P-ML24: submit step-up OTP after geo anomaly
  const handleStepUpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStepUpLoading(true);
    setStepUpError('');
    try {
      const tokens = await api.post<AuthTokens>('/auth/magic-link/verify-code', { email: validatedEmail, code: stepUpOtp });
      setSession(tokens);
      setStatus('success');
      const u = tokens.user as { role?: string; org?: { pendingApproval?: boolean }; mustChangePassword?: boolean };
      const dest = resolveNext(u.role ?? '', u.org?.pendingApproval);
      router.replace(u.mustChangePassword ? '/change-password' : dest);
    } catch {
      setStepUpError('Invalid or expired code. Please check your email and try again.');
    } finally {
      setStepUpLoading(false);
    }
  };

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

  // P-ML18: passkey enrollment modal — shown after trust decision if not already enrolled
  const proceedAfterTrust = (dest: string) => {
    const alreadyEnrolled = localStorage.getItem('mdrx_passkey_enrolled') === '1';
    const alreadyPrompted = localStorage.getItem('mdrx_passkey_prompt_shown') === '1';
    if (!alreadyEnrolled && !alreadyPrompted) {
      setTrustDestination(dest);
      setShowTrustPrompt(false);
      setShowPasskeyModal(true);
    } else {
      router.replace(dest);
    }
  };

  // P-ML22: Protected buffer page — defeats email scanner pre-click by requiring human interaction
  if (!protectedReady) {
    return (
      <div className="text-center">
        <div className="w-12 h-12 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-6 h-6 text-[#0F4C81]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
        </div>
        <h2 className="text-base font-semibold text-gray-900 mb-2">One more step</h2>
        <p className="text-gray-500 text-sm mb-5">
          Click below to complete your sign-in. This extra step ensures your email scanner doesn't accidentally consume your link.
        </p>
        <button
          onClick={() => setProtectedReady(true)}
          className="w-full bg-[#0F4C81] text-white rounded-lg px-5 py-3 text-sm font-semibold hover:bg-[#0d3d69] transition-colors"
        >
          Continue to sign in
        </button>
        <p className="text-xs text-gray-400 mt-3">This protected link requires manual confirmation to prevent scanner interference.</p>
      </div>
    );
  }

  // P-ML26: Cross-device confirmation prompt
  if (crossDevicePrompt) {
    return (
      <div className="text-center">
        <div className="w-12 h-12 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-6 h-6 text-[#0F4C81]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>
        <h2 className="text-base font-semibold text-gray-900 mb-2">Link opened on another device</h2>
        <p className="text-gray-500 text-sm mb-5">Your sign-in link was clicked on another device. Did you do this? You can sign in here too.</p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={handleCrossDeviceClaim}
            disabled={crossDeviceLoading}
            className="px-5 py-2.5 bg-[#0F4C81] text-white rounded-lg text-sm font-semibold hover:bg-[#0d3d69] disabled:opacity-50"
          >
            {crossDeviceLoading ? 'Signing in…' : 'Yes, sign me in here'}
          </button>
          <button
            onClick={() => { setCrossDevicePrompt(false); router.push('/login'); }}
            className="px-5 py-2.5 bg-gray-100 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-200"
          >
            No, cancel
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-4">This option expires in 5 minutes.</p>
      </div>
    );
  }

  // P-ML24: Geo anomaly step-up OTP challenge
  if (stepUpRequired) {
    return (
      <div>
        <div className="text-center mb-5">
          <div className="w-12 h-12 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
          </div>
          <h2 className="text-base font-semibold text-gray-900 mb-1">Security check required</h2>
          <p className="text-gray-500 text-sm">We detected an unusual sign-in location. Enter the 6-digit code we just sent to <span className="font-medium text-gray-700">{validatedEmail}</span> to confirm it&apos;s you.</p>
        </div>
        <form onSubmit={handleStepUpSubmit} className="space-y-3">
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            aria-label="6-digit security code"
            value={stepUpOtp}
            onChange={e => setStepUpOtp(e.target.value.replace(/[^\d\s]/g, ''))}
            placeholder="123 456"
            maxLength={7}
            required
            autoFocus
            className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm font-mono tracking-widest text-center focus:outline-none focus:ring-2 focus:ring-amber-300"
          />
          {stepUpError && <p className="text-red-500 text-sm">{stepUpError}</p>}
          <button
            type="submit"
            disabled={stepUpLoading}
            className="w-full bg-[#0F4C81] text-white rounded-lg px-5 py-3 text-sm font-semibold hover:bg-[#0d3d69] disabled:opacity-50 transition-colors"
          >
            {stepUpLoading ? 'Verifying…' : 'Confirm identity'}
          </button>
        </form>
        <p className="text-xs text-gray-400 mt-3 text-center">Code expires in 10 minutes. Didn&apos;t get it? <a href="/login" className="text-[#0F4C81] hover:underline">Request a new link</a>.</p>
      </div>
    );
  }

  if (showPasskeyModal) {
    return (
      <>
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-[#0F4C81] border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-gray-500 text-sm mt-3">Signed in…</p>
        </div>
        <PasskeyEnrollModal onDone={() => { setShowPasskeyModal(false); router.replace(trustDestination); }} />
      </>
    );
  }

  // P-SES22: Trust device prompt after successful verify
  if (showTrustPrompt) {
    const API = process.env.NEXT_PUBLIC_API_URL ?? 'https://mydashrx-backend.onrender.com';
    const trustDevice = async () => {
      try {
        const { getAccessToken } = await import('@/lib/auth');
        await fetch(`${API}/api/v1/auth/trust-device`, {
          method: 'POST', credentials: 'include',
          headers: { Authorization: `Bearer ${getAccessToken()}` },
        });
      } catch { /* non-fatal */ }
      proceedAfterTrust(trustDestination);
    };
    return (
      <div className="text-center">
        <div className="w-12 h-12 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h2 className="text-base font-semibold text-gray-900 mb-1">Signed in!</h2>
        <p className="text-gray-500 text-sm mb-5">Trust this device for 30 days? You won&apos;t need a link next time.</p>
        <div className="flex gap-3 justify-center">
          <button onClick={trustDevice} className="px-5 py-2.5 bg-[#0F4C81] text-white rounded-lg text-sm font-semibold hover:bg-[#0d3d69]">Yes, trust it</button>
          <button onClick={() => proceedAfterTrust(trustDestination)} className="px-5 py-2.5 bg-gray-100 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-200">No thanks</button>
        </div>
      </div>
    );
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

      {/* P-ML22: Outlook scanner consumed link — show specific guidance */}
      {isOutlookHint && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-4 text-left">
          <p className="text-amber-800 text-sm font-medium mb-1">Outlook may have scanned your link</p>
          <p className="text-amber-700 text-xs">Your email scanner may have automatically clicked this link before you could. Request a new link — it will include a scanner-safe version that requires one manual click.</p>
        </div>
      )}

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
