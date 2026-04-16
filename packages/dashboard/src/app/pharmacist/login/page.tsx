'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { setSession } from '@/lib/auth';
import type { AuthTokens } from '@mydash-rx/shared';
import { FlaskConical } from 'lucide-react';

export default function PharmacistLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const tokens = await api.post<AuthTokens>('/auth/login', { email, password });
      const user = tokens.user as { role: string };
      if (user.role !== 'pharmacist' && user.role !== 'pharmacy_admin' && user.role !== 'super_admin') {
        setError('Access restricted to pharmacist accounts');
        return;
      }
      setSession(tokens);
      if ((tokens.user as any).mustChangePassword) {
        router.replace('/change-password');
      } else {
        router.replace('/pharmacist/queue');
      }
    } catch {
      setError('Invalid email or password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F0FDF4]">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-emerald-100 p-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center">
            <FlaskConical size={20} className="text-emerald-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900" style={{ fontFamily: 'var(--font-sora)' }}>
              Pharmacist Login
            </h1>
            <p className="text-xs text-gray-500">MyDashRx · Dispensing Portal</p>
          </div>
        </div>

        <div className="h-px bg-emerald-50 my-6" />

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200"
              required
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200"
              required
            />
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-emerald-600 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Signing in…' : 'Sign in to Dispensing Portal'}
          </button>
        </form>

        <p className="text-xs text-center text-gray-400 mt-6">
          Staff login? <a href="/login" className="text-emerald-600 hover:underline">Dashboard →</a>
        </p>
      </div>
    </div>
  );
}
