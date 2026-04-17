'use client';
import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { api } from '@/lib/api';
import { setSession } from '@/lib/auth';
import type { AuthTokens } from '@mydash-rx/shared';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const authError = params.get('error');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const handleGoogle = async () => {
    setGoogleLoading(true);
    await signIn('google', { callbackUrl: '/auth/callback' });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const tokens = await api.post<AuthTokens>('/auth/login', { email, password });
      setSession(tokens);
      if ((tokens.user as any).mustChangePassword) {
        router.replace('/change-password');
      } else {
        router.replace('/dashboard');
      }
    } catch {
      setError('Invalid email or password');
    } finally {
      setLoading(false);
    }
  };

  const errorMsg =
    authError === 'NoAccount' ? 'No account found for that Google address. Contact your admin.' :
    authError === 'ServerError' ? 'Server error. Please try again.' :
    authError ? 'Sign-in failed. Please try again.' : '';

  return (
    <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
      <h1 className="text-2xl font-bold text-[#0F4C81] mb-1" style={{ fontFamily: 'var(--font-sora)' }}>
        MyDashRx
      </h1>
      <p className="text-gray-500 text-sm mb-8">Pharmacy Delivery Management</p>

      <button
        onClick={handleGoogle}
        disabled={googleLoading}
        className="w-full flex items-center justify-center gap-3 border border-gray-200 rounded-lg py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors mb-4"
      >
        <svg width="18" height="18" viewBox="0 0 48 48">
          <path fill="#4285F4" d="M44.5 20H24v8.5h11.8C34.7 33.9 30.1 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 5.1 29.6 3 24 37 3 12.4 3 24s9.4 21 21 21c10.5 0 20-7.6 20-21 0-1.3-.2-2.7-.5-4z"/>
          <path fill="#34A853" d="M6.3 14.7l7 5.1C15.1 16.2 19.2 13 24 13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 5.1 29.6 3 24 3c-7.8 0-14.5 4.5-17.7 11.7z"/>
          <path fill="#FBBC05" d="M24 45c5.8 0 10.7-1.9 14.3-5.2l-6.6-5.4C29.7 36.1 27 37 24 37c-6.1 0-10.7-3.1-11.8-7.5l-7 5.4C8.1 40.8 15.5 45 24 45z"/>
          <path fill="#EA4335" d="M44.5 20H24v8.5h11.8c-.6 2.3-2 4.3-3.8 5.8l6.6 5.4C42.5 36.2 45 30.7 45 24c0-1.3-.2-2.7-.5-4z"/>
        </svg>
        {googleLoading ? 'Redirecting…' : 'Sign in with Google'}
      </button>

      <div className="flex items-center gap-3 mb-4">
        <div className="flex-1 h-px bg-gray-200" />
        <span className="text-xs text-gray-400">or</span>
        <div className="flex-1 h-px bg-gray-200" />
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
            required
            autoFocus
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
            required
          />
        </div>
        {(error || errorMsg) && <p className="text-red-500 text-sm">{error || errorMsg}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-[#0F4C81] text-white rounded-lg py-2 text-sm font-medium hover:bg-[#0d3d69] disabled:opacity-50 transition-colors"
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F7F8FC]">
      <Suspense fallback={<div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-gray-100 p-8 h-96" />}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
