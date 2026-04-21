'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getUser, isAuthenticated, setSession } from '@/lib/auth';
import { api } from '@/lib/api';
import { Lock } from 'lucide-react';

export default function ChangePasswordPage() {
  const router = useRouter();
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  // Role-aware destination: drivers go back to /driver, everyone else to /dashboard.
  const destForRole = (role?: string) => role === 'driver' ? '/driver' : '/dashboard';

  useEffect(() => {
    if (!isAuthenticated()) { router.replace('/login'); return; }
    const user = getUser() as any;
    if (user && !user.mustChangePassword) { router.replace(destForRole(user?.role)); return; }
    setChecking(false);
  }, [router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) { setError('Password must be at least 8 characters'); return; }
    if (newPassword !== confirm) { setError('Passwords do not match'); return; }
    setLoading(true);
    setError('');
    try {
      // Backend issues fresh AT+RT (mustChangePw cleared). Persist them so the next API call
      // doesn't hit 403 with the stale token.
      const res = await api.post<{ accessToken?: string; refreshToken?: string; user: any }>(
        '/auth/change-password',
        { newPassword },
      );
      if (res.accessToken) {
        setSession({ accessToken: res.accessToken, refreshToken: res.refreshToken, user: { ...res.user, mustChangePassword: false } });
      } else {
        const stored = localStorage.getItem('user');
        if (stored) {
          const u = JSON.parse(stored);
          localStorage.setItem('user', JSON.stringify({ ...u, mustChangePassword: false }));
        }
      }
      router.replace(destForRole(res.user?.role));
    } catch (err: any) {
      setError(err?.message ?? 'Failed to update password');
    } finally {
      setLoading(false);
    }
  };

  if (checking) return null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F7F8FC]">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
            <Lock size={20} className="text-[#0F4C81]" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-[#0F4C81]" style={{ fontFamily: 'var(--font-sora)' }}>Set Your Password</h1>
            <p className="text-xs text-gray-500">You're signed in with a temporary password. Please create a new one.</p>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label htmlFor="cp-new-password" className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
            <input
              id="cp-new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
              placeholder="Min. 8 characters"
              required
              autoFocus
            />
          </div>
          <div>
            <label htmlFor="cp-confirm-password" className="block text-sm font-medium text-gray-700 mb-1">Confirm Password</label>
            <input
              id="cp-confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
              placeholder="Repeat your new password"
              required
            />
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#0F4C81] text-white rounded-lg py-2 text-sm font-medium hover:bg-[#0d3d69] disabled:opacity-50 transition-colors"
          >
            {loading ? 'Saving…' : 'Set Password & Continue'}
          </button>
        </form>
      </div>
    </div>
  );
}
