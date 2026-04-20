'use client';
import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { setSession, getRoleRedirect } from '@/lib/auth';
import type { AuthTokens } from '@mydash-rx/shared';

function AcceptContent() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') ?? '';

  const [inviteInfo, setInviteInfo] = useState<{ email: string; role: string } | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) { setInvalid(true); setLoading(false); return; }
    api.get<{ email: string; role: string }>(`/signup/invite/validate?token=${encodeURIComponent(token)}`)
      .then(info => { setInviteInfo(info); setLoading(false); })
      .catch(() => { setInvalid(true); setLoading(false); });
  }, [token]);

  const accept = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const tokens = await api.post<AuthTokens & { role?: string }>('/signup/invite/accept', { token, name });
      setSession(tokens);
      const role = (tokens as any).role ?? tokens.user?.role;
      router.replace(getRoleRedirect(role));
    } catch (err: any) {
      const raw = (err as Error).message ?? '';
      const match = raw.match(/\{.*\}/);
      let msg = 'Something went wrong. Please try again.';
      if (match) { try { msg = JSON.parse(match[0]).error ?? msg; } catch { /* ignore */ } }
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return (
    <div className="text-center py-6">
      <div className="w-8 h-8 border-2 border-[#0F4C81] border-t-transparent rounded-full animate-spin mx-auto" />
    </div>
  );

  if (invalid) return (
    <div className="text-center py-4">
      <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-3">
        <svg className="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </div>
      <p className="text-gray-700 font-medium mb-1">Invalid invitation</p>
      <p className="text-gray-500 text-sm mb-4">This invitation link is expired or has already been used.</p>
      <a href="/login" className="text-sm text-[#0F4C81] hover:underline">Go to sign in</a>
    </div>
  );

  return (
    <div>
      <div className="bg-blue-50 rounded-xl p-4 mb-5 text-sm">
        <p className="text-gray-600">Invited as <span className="font-medium text-gray-900">{inviteInfo?.role}</span></p>
        <p className="text-gray-500 text-xs mt-0.5">{inviteInfo?.email}</p>
      </div>
      <form onSubmit={accept} className="space-y-4">
        <div>
          <label htmlFor="accept-name" className="block text-sm font-medium text-gray-700 mb-1">Your full name</label>
          <input
            id="accept-name"
            autoComplete="name"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Jane Smith"
            className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
            required
            autoFocus
          />
        </div>
        {error && <p className="text-red-500 text-sm">{error}</p>}
        <button
          type="submit"
          disabled={submitting || !name}
          className="w-full bg-[#0F4C81] text-white rounded-lg py-2.5 text-sm font-medium hover:bg-[#0d3d69] disabled:opacity-50 transition-colors"
        >
          {submitting ? 'Creating account…' : 'Accept & join'}
        </button>
      </form>
    </div>
  );
}

export default function AcceptInvitePage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F7F8FC]">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
        <h1 className="text-xl font-bold text-[#0F4C81] mb-1" style={{ fontFamily: 'var(--font-sora)' }}>
          MyDashRx
        </h1>
        <p className="text-gray-500 text-sm mb-6">You've been invited to join the team</p>
        <Suspense fallback={<div className="w-8 h-8 border-2 border-[#0F4C81] border-t-transparent rounded-full animate-spin mx-auto" />}>
          <AcceptContent />
        </Suspense>
      </div>
    </div>
  );
}
