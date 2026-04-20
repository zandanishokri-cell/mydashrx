'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { setSession } from '@/lib/auth';
import { Truck } from 'lucide-react';

export default function DriverLoginPage() {
  const router = useRouter();
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const endpoint = tab === 'login' ? '/auth/login' : '/auth/register';
      const body = tab === 'login' ? { email, password } : { name, email, password, role: 'driver' };
      const res = await api.post<{ accessToken: string; refreshToken: string; user: any }>(endpoint, body);
      if (res.user.role !== 'driver') {
        setError('This portal is for drivers only.');
        return;
      }
      setSession(res); // P-SEC28: AT in-memory, RT in httpOnly cookie
      router.replace('/driver');
    } catch (err: any) {
      setError(err?.message ?? 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 bg-[#0F4C81]">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Truck size={32} className="text-[#0F4C81]" />
          </div>
          <h1 className="text-2xl font-bold text-white">Driver App</h1>
          <p className="text-blue-200 text-sm mt-1">MyDashRx</p>
        </div>

        <div className="bg-white rounded-2xl p-6 shadow-xl">
          <div className="flex bg-gray-100 rounded-lg p-1 mb-5">
            {(['login', 'register'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${tab === t ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>
                {t === 'login' ? 'Sign In' : 'Create Account'}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-3">
            {tab === 'register' && (
              <div>
                <label htmlFor="driver-name" className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                <input id="driver-name" autoComplete="name" value={name} onChange={e => setName(e.target.value)} required
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                  placeholder="John Smith" />
              </div>
            )}
            <div>
              <label htmlFor="driver-email" className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input id="driver-email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                placeholder="driver@example.com" />
            </div>
            <div>
              <label htmlFor="driver-password" className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input id="driver-password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                placeholder={tab === 'register' ? 'Min. 8 characters' : '••••••••'} />
            </div>
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <button type="submit" disabled={loading}
              className="w-full bg-[#0F4C81] text-white py-3 rounded-xl font-semibold text-sm mt-2 disabled:opacity-50 hover:bg-[#0d3d69] transition-colors">
              {loading ? '...' : tab === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
