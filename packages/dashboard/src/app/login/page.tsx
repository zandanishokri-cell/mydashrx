'use client';
import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { setSession } from '@/lib/auth';
import type { AuthTokens } from '@mydash-rx/shared';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Fallback email/password for existing admin accounts
  const [showPassword, setShowPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [pwLoading, setPwLoading] = useState(false);

  const requestMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await api.post('/auth/magic-link/request', { email });
      setSent(true);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
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
        <p className="text-[#0F4C81] font-medium text-sm mb-6">{email}</p>
        <p className="text-gray-400 text-xs mb-6">The link expires in 15 minutes. Check your spam folder if you don't see it.</p>
        <button
          onClick={() => { setSent(false); setEmail(''); }}
          className="text-sm text-[#0F4C81] hover:underline"
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
      <h1 className="text-2xl font-bold text-[#0F4C81] mb-1" style={{ fontFamily: 'var(--font-sora)' }}>
        MyDashRx
      </h1>
      <p className="text-gray-500 text-sm mb-8">Pharmacy Delivery Management</p>

      <form onSubmit={requestMagicLink} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Email address</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@pharmacy.com"
            className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
            required
            autoFocus
          />
        </div>
        {error && !showPassword && <p className="text-red-500 text-sm">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-[#0F4C81] text-white rounded-lg py-2.5 text-sm font-medium hover:bg-[#0d3d69] disabled:opacity-50 transition-colors"
        >
          {loading ? 'Sending link…' : 'Send login link'}
        </button>
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

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F7F8FC]">
      <Suspense fallback={<div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-gray-100 p-8 h-64" />}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
