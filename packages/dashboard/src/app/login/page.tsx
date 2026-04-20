'use client';
import { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { setSession } from '@/lib/auth';
import type { AuthTokens } from '@mydash-rx/shared';
import { startAuthentication } from '@simplewebauthn/browser';
import { collectFingerprint } from '@/lib/deviceFingerprint';

const IAB_RE = /FBAN|FBAV|Instagram|LinkedInApp|GSA/i;
function useIsInAppBrowser() {
  const [isIAB, setIsIAB] = useState(false);
  useEffect(() => { setIsIAB(IAB_RE.test(navigator.userAgent)); }, []);
  return isIAB;
}

// P-ML20: Provider detection
type EmailProvider = 'gmail' | 'outlook' | 'yahoo' | 'other';
const EMAIL_DEEPLINKS: Record<EmailProvider, { label: string; url: string } | null> = {
  gmail:   { label: 'Open Gmail', url: 'https://mail.google.com/mail/u/0/#inbox' },
  outlook: { label: 'Open Outlook', url: 'https://outlook.live.com/mail/inbox' },
  yahoo:   { label: 'Open Yahoo Mail', url: 'https://mail.yahoo.com/' },
  other:   null,
};
function getEmailProvider(email: string): EmailProvider {
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  if (domain === 'gmail.com' || domain === 'googlemail.com') return 'gmail';
  if (['outlook.com', 'hotmail.com', 'live.com', 'msn.com'].includes(domain)) return 'outlook';
  if (['yahoo.com', 'yahoo.co.uk', 'ymail.com'].includes(domain)) return 'yahoo';
  return 'other';
}
function ProviderHint({ email }: { email: string }) {
  const provider = getEmailProvider(email);
  const deeplink = EMAIL_DEEPLINKS[provider];
  if (provider === 'other' && !deeplink) return null;
  return (
    <div className={`rounded-lg px-3 py-2.5 text-xs mb-3 ${provider === 'outlook' ? 'bg-amber-50 border border-amber-200 text-amber-700' : 'bg-blue-50 border border-blue-200 text-blue-700'}`}>
      {provider === 'gmail' && <p>Check the <span className="font-semibold">Promotions tab</span> in Gmail — magic links sometimes land there.</p>}
      {provider === 'outlook' && <p><span className="font-semibold">Outlook email scanners</span> may consume your link before you click it. If the link doesn't work, request a new one.</p>}
      {provider === 'yahoo' && <p>Check your <span className="font-semibold">Spam folder</span> — Yahoo Mail sometimes filters login emails.</p>}
      {deeplink && (
        <a href={deeplink.url} target="_blank" rel="noopener noreferrer"
          className="inline-block mt-1.5 font-semibold underline underline-offset-2 hover:opacity-80">
          {deeplink.label} →
        </a>
      )}
    </div>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const prefill = params.get('prefill') ?? '';
  const reason = params.get('reason');
  const nextParam = params.get('next') ?? '';
  const isIAB = useIsInAppBrowser();

  const [email, setEmail] = useState(prefill);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(900);
  const [canResend, setCanResend] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendCount, setResendCount] = useState(0);
  const [resendCooldown, setResendCooldown] = useState(30);
  const [expiredNotice, setExpiredNotice] = useState(false);
  // P-DEL32: email forwarding detection — show inline OTP banner when detected
  const [forwardingRisk, setForwardingRisk] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpError, setOtpError] = useState('');

  // P-ML19: tab-ready indicator state
  const [tabVisible, setTabVisible] = useState(true);
  // P-ML19: warmup ping refs
  const warmupRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const warmupCountRef = useRef(0);

  const [showPassword, setShowPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [pwLoading, setPwLoading] = useState(false);

  // P-ML18: passkey-first login for enrolled users
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [passkeyError, setPasskeyError] = useState('');

  useEffect(() => {
    if (params.get('expired') === '1') setExpiredNotice(true);
    // P-CNV9: ?welcome=1 from approval email → store onboarding redirect
    if (params.get('welcome') === '1') {
      sessionStorage.setItem('postAuthRedirect', '/dashboard/onboarding');
    }
  }, []);

  // P-ML19: track tab visibility for tab-ready indicator
  useEffect(() => {
    const handler = () => setTabVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);

  useEffect(() => {
    if (!sent) return;
    const interval = setInterval(() => setCountdown(s => Math.max(0, s - 1)), 1000);
    const pwTimer = setTimeout(() => setShowPassword(true), 300_000);
    return () => { clearInterval(interval); clearTimeout(pwTimer); };
  }, [sent]);

  // Exponential cooldown: 30s → 60s → 120s
  useEffect(() => {
    if (!sent) return;
    const COOLDOWNS = [30, 60, 120];
    const secs = COOLDOWNS[Math.min(resendCount, COOLDOWNS.length - 1)];
    setResendCooldown(secs);
    setCanResend(false);
    const t = setTimeout(() => setCanResend(true), secs * 1000);
    return () => clearTimeout(t);
  }, [sent, resendCount]);

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  // P-ML18: passkey authentication flow
  const signInWithPasskey = async () => {
    if (!email) { setPasskeyError('Enter your email first'); return; }
    setPasskeyLoading(true);
    setPasskeyError('');
    try {
      const options = await api.post<any>('/auth/passkey/authenticate/options', { email });
      const authResponse = await startAuthentication({ optionsJSON: options });
      const tokens = await api.post<AuthTokens>('/auth/passkey/authenticate/verify', { email, response: authResponse });
      setSession(tokens);
      router.replace((tokens.user as any).mustChangePassword ? '/change-password' : '/dashboard');
    } catch (err: unknown) {
      const msg = (err as Error)?.message ?? '';
      if (msg.includes('cancelled') || msg.includes('abort') || msg.includes('NotAllowed')) {
        setPasskeyError('');
      } else {
        setPasskeyError('Passkey sign-in failed. Try your email link instead.');
      }
    } finally {
      setPasskeyLoading(false);
    }
  };

  const startWarmupPing = () => {
    // P-ML19: ping /health every 15s for 120s to keep Render warm during email-to-click window
    warmupCountRef.current = 0;
    if (warmupRef.current) clearInterval(warmupRef.current);
    const BACKEND = process.env.NEXT_PUBLIC_API_URL ?? 'https://mydashrx-backend.onrender.com';
    warmupRef.current = setInterval(() => {
      warmupCountRef.current += 1;
      if (warmupCountRef.current >= 8) { clearInterval(warmupRef.current!); warmupRef.current = null; return; }
      fetch(`${BACKEND}/health`, { mode: 'no-cors' }).catch(() => {});
    }, 15_000);
  };

  const requestMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      if (nextParam && nextParam.startsWith('/dashboard')) {
        sessionStorage.setItem('postAuthRedirect', nextParam);
      }
      const fp = collectFingerprint();
      const res = await api.post<{ message: string; requestId?: string; forwardingRisk?: boolean }>('/auth/magic-link/request', { email, fp });
      // P-ML26: store requestId for cross-device SSE polling on verify page
      if (res?.requestId) sessionStorage.setItem('mdrx_magic_request_id', res.requestId);
      // P-DEL32: show forwarding risk banner if detected
      if (res?.forwardingRisk) setForwardingRisk(true);
      setCountdown(900);
      setCanResend(false);
      setSent(true);
      startWarmupPing(); // P-ML19: keep Render warm during 90s email-to-click window
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const resendLink = async () => {
    setResending(true);
    try {
      const fp = collectFingerprint();
      await api.post('/auth/magic-link/request', { email, fp });
      setCountdown(900);
      setResendCount(c => c + 1);
      startWarmupPing(); // P-ML19: restart warmup after resend
    } catch { /* silent */ } finally {
      setResending(false);
    }
  };

  const resendCopy =
    resendCount === 0 ? 'Send again' :
    resendCount === 1 ? 'Still waiting? Send another link' :
    'Send one more link';

  // P-DEL32: OTP code submission for forwarding-risk users
  const submitOtpCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setOtpLoading(true);
    setOtpError('');
    try {
      const tokens = await api.post<any>('/auth/magic-link/verify-code', { email, code: otpCode.replace(/\s/g, '') });
      setSession(tokens);
      router.replace(tokens.user?.mustChangePassword ? '/change-password' : '/dashboard');
    } catch {
      setOtpError('Invalid or expired code. Check your email for the 6-digit code.');
    } finally {
      setOtpLoading(false);
    }
  };

  const signInWithPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwLoading(true);
    setError('');
    try {
      const tokens = await api.post<AuthTokens>('/auth/login', { email, password });
      setSession(tokens);
      router.replace((tokens.user as any).mustChangePassword ? '/change-password' : '/dashboard');
    } catch {
      setError('Invalid email or password.');
    } finally {
      setPwLoading(false);
    }
  };

  const reasonMsg =
    reason === 'idle' ? 'Your session expired after 30 minutes of inactivity.' :
    reason === 'auth_error' ? 'Your session expired. Please sign in again.' :
    null;

  if (sent) {
    return (
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
        <div className="w-12 h-12 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-6 h-6 text-[#0F4C81]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Check your email</h2>
        <p className="text-gray-500 text-sm mb-1">We sent a login link to</p>
        <p className="text-[#0F4C81] font-medium text-sm mb-3">{email}</p>
        {/* P-ML19: tab-ready indicator */}
        <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium mb-3 ${tabVisible ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
          <span className={`w-2 h-2 rounded-full ${tabVisible ? 'bg-green-500' : 'bg-amber-400'}`} />
          {tabVisible ? 'Tab ready — link will auto-verify when you return' : 'Switch back to this tab after clicking your link'}
        </div>
        {countdown > 0
          ? <p className="text-gray-400 text-xs mb-2">Link expires in <span className="font-mono">{fmt(countdown)}</span></p>
          : <p className="text-red-400 text-xs mb-2">Link expired — please request a new one.</p>
        }
        {/* P-DEL32: forwarding risk banner — shown when IT forwarder pattern detected */}
        {/* P-A11Y32: always-mounted OTP error live region — SR announces on content change */}
        <p
          id="otp-forwarding-error"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className={`text-red-500 text-xs mt-1 ${otpError ? '' : 'sr-only'}`}
        >{otpError}</p>
        {forwardingRisk && (
          <div
            className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-left"
            role="alert"
            aria-label="Email forwarding detected"
          >
            <p className="text-amber-800 text-xs font-semibold mb-1">Your email may be forwarded</p>
            <p className="text-amber-700 text-xs mb-2">IT email forwarders can consume magic links before you see them. Enter the 6-digit code from the email instead:</p>
            <form onSubmit={submitOtpCode} className="flex gap-2">
              <input
                id="otp-forwarding-code"
                type="text"
                aria-label="6-digit verification code"
                aria-describedby="otp-forwarding-error"
                aria-invalid={!!otpError || undefined}
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/[^0-9\s]/g, ''))}
                placeholder="123 456"
                maxLength={7}
                className="flex-1 border border-amber-300 rounded-lg px-3 py-2 text-sm font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-amber-300 text-center"
                inputMode="numeric"
                autoComplete="one-time-code"
              />
              <button
                type="submit"
                disabled={otpLoading || otpCode.replace(/\s/g, '').length < 6}
                aria-busy={otpLoading}
                className="bg-amber-600 text-white rounded-lg px-3 py-2 text-sm font-medium hover:bg-amber-700 disabled:opacity-50 transition-colors"
              >
                {otpLoading ? '…' : 'Verify'}
              </button>
            </form>
          </div>
        )}
        {/* P-ML20: provider-specific hint */}
        <div className="mb-2 text-left">
          <ProviderHint email={email} />
        </div>
        <div className="space-y-2">
          {canResend ? (
            <button
              onClick={resendLink}
              disabled={resending}
              className="block w-full text-sm text-[#0F4C81] hover:underline disabled:opacity-50"
            >
              {resending ? 'Resending…' : resendCopy}
            </button>
          ) : (
            <p className="text-xs text-gray-400">Send another link in {resendCooldown}s</p>
          )}
          <button
            onClick={() => { setSent(false); setEmail(''); setShowPassword(false); }}
            className="block w-full text-sm text-gray-400 hover:text-gray-600"
          >
            Use a different email
          </button>
        </div>
        {showPassword && (
          <div className="mt-5 pt-5 border-t border-gray-100">
            <p className="text-xs text-gray-500 mb-3">Didn't get it? Try signing in with your password instead.</p>
            <form onSubmit={signInWithPassword} className="space-y-3">
              <input
                id="login-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                required
                autoFocus
              />
              {error && <p className="text-red-500 text-sm">{error}</p>}
              <button
                type="submit"
                disabled={pwLoading}
                className="w-full bg-gray-700 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-gray-800 disabled:opacity-50 transition-colors"
              >
                {pwLoading ? 'Signing in…' : 'Sign in with password'}
              </button>
            </form>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
      <h1 className="text-2xl font-bold text-[#0F4C81] mb-1" style={{ fontFamily: 'var(--font-sora)' }}>
        MyDashRx
      </h1>
      <p className="text-gray-500 text-sm mb-6">Pharmacy Delivery Management</p>

      {isIAB && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 text-sm">
          <p className="font-semibold mb-0.5">Opening in an in-app browser</p>
          <p className="text-xs text-amber-600">Login links may not work here. Tap the <span className="font-medium">⋯</span> menu and choose <span className="font-medium">Open in Browser</span> for best results.</p>
        </div>
      )}
      {expiredNotice && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-sm">
          Your sign-in link expired. Enter your email below to get a fresh one.
        </div>
      )}
      {reasonMsg && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-100 rounded-lg text-amber-700 text-sm">
          {reasonMsg}
        </div>
      )}

      <form onSubmit={requestMagicLink} className="space-y-4">
        <div>
          <label htmlFor="login-email" className="block text-sm font-medium text-gray-700 mb-1">Email address</label>
          <input
            id="login-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@pharmacy.com"
            className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
            required
            autoFocus
          />
        </div>
        {error && !showPassword && <p className="text-red-500 text-sm">{error}</p>}
        {passkeyError && <p className="text-red-500 text-sm">{passkeyError}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-[#0F4C81] text-white rounded-lg py-2.5 text-sm font-medium hover:bg-[#0d3d69] disabled:opacity-50 transition-colors"
        >
          {loading ? 'Sending link…' : 'Send login link'}
        </button>
        {/* P-ML18: passkey-first button — shown only for enrolled users */}
        {typeof window !== 'undefined' && localStorage.getItem('mdrx_passkey_enrolled') === '1' && (
          <button
            type="button"
            onClick={signInWithPasskey}
            disabled={passkeyLoading || !email}
            className="w-full border border-[#0F4C81] text-[#0F4C81] rounded-lg py-2.5 text-sm font-medium hover:bg-blue-50 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            {passkeyLoading ? (
              <><span className="w-4 h-4 border-2 border-[#0F4C81] border-t-transparent rounded-full animate-spin" /> Verifying…</>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
                </svg>
                Sign in with Face ID / Touch ID
              </>
            )}
          </button>
        )}
      </form>

      <div className="mt-5 pt-5 border-t border-gray-100 text-center space-y-2">
        <p className="text-xs text-gray-400">
          New pharmacy?{' '}
          <a href="/signup/pharmacy" className="text-[#0F4C81] hover:underline font-medium">Apply for access</a>
        </p>
        <p className="text-xs text-gray-400">
          Driver?{' '}
          <a href="/signup/driver" className="text-[#0F4C81] hover:underline font-medium">Create driver account</a>
        </p>
      </div>

      <div className="mt-4 pt-4 border-t border-gray-100">
        <button
          onClick={() => { setShowPassword(p => !p); setError(''); }}
          className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
        >
          {showPassword ? 'Hide password sign in' : 'Sign in with password instead'}
        </button>
        {showPassword && (
          <form onSubmit={signInWithPassword} className="mt-4 space-y-3">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
              required
            />
            {error && showPassword && <p className="text-red-500 text-sm">{error}</p>}
            <button
              type="submit"
              disabled={pwLoading}
              className="w-full bg-gray-700 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-gray-800 disabled:opacity-50 transition-colors"
            >
              {pwLoading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function LoginPageInner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F7F8FC]">
      <Suspense fallback={<div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-gray-100 p-8 h-64" />}>
        <LoginForm />
      </Suspense>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginPageInner />
    </Suspense>
  );
}
