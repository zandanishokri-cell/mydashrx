'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { Building2 } from 'lucide-react';

export default function PharmacyLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await api.post<{ accessToken: string; refreshToken: string; user: any }>('/auth/login', { email, password });
      if (res.user.role !== 'pharmacist') {
        setError('This portal is for pharmacy staff only.');
        return;
      }
      localStorage.setItem('accessToken', res.accessToken);
      localStorage.setItem('refreshToken', res.refreshToken);
      localStorage.setItem('user', JSON.stringify(res.user));
      router.replace('/pharmacy');
    } catch {
      setError('Invalid email or password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 bg-[#f0f4f8]">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-[#0F4C81] rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Building2 size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Pharmacy Portal</h1>
          <p className="text-gray-500 text-sm mt-1">Submit and track delivery orders</p>
        </div>

        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-100"
                placeholder="you@pharmacy.com" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-100"
                placeholder="••••••••" />
            </div>
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <button type="submit" disabled={loading}
              className="w-full bg-[#0F4C81] text-white py-2.5 rounded-xl font-semibold text-sm mt-1 disabled:opacity-50 hover:bg-[#0d3d69] transition-colors">
              {loading ? '…' : 'Sign In'}
            </button>
          </form>
          <p className="text-center text-xs text-gray-400 mt-4">
            New to the pharmacy portal? Contact your pharmacy admin to get access.
          </p>
        </div>
      </div>
    </div>
  );
}
