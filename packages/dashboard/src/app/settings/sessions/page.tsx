'use client';
import { useEffect, useState } from 'react';

interface Session {
  jti: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
  isCurrent: boolean;
}

function parseDevice(ua: string | null): string {
  if (!ua) return 'Unknown device';
  if (/Mobile|Android|iPhone|iPad/i.test(ua)) {
    if (/iPhone/i.test(ua)) return 'iPhone';
    if (/iPad/i.test(ua)) return 'iPad';
    return 'Mobile device';
  }
  if (/Windows/i.test(ua)) return 'Windows PC';
  if (/Mac/i.test(ua)) return 'Mac';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Desktop browser';
}

function parseBrowser(ua: string | null): string {
  if (!ua) return '';
  if (/Chrome/i.test(ua) && !/Chromium|Edge/i.test(ua)) return 'Chrome';
  if (/Firefox/i.test(ua)) return 'Firefox';
  if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) return 'Safari';
  if (/Edge/i.test(ua)) return 'Edge';
  return '';
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function fetchSessions() {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/sessions`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` },
    });
    if (!res.ok) { setError('Failed to load sessions'); setLoading(false); return; }
    setSessions(await res.json());
    setLoading(false);
  }

  useEffect(() => { fetchSessions(); }, []);

  async function revoke(jti: string) {
    setRevoking(jti);
    await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/sessions/${jti}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` },
    });
    setSessions(s => s.filter(x => x.jti !== jti));
    setRevoking(null);
  }

  if (loading) return <div className="p-8 text-gray-500">Loading sessions…</div>;
  if (error) return <div className="p-8 text-red-600">{error}</div>;

  return (
    <div className="max-w-2xl mx-auto p-8">
      <h1 className="text-2xl font-semibold mb-2">Active Sessions</h1>
      <p className="text-gray-500 text-sm mb-6">These devices are currently signed into your account. Revoke any session you don't recognize.</p>
      {sessions.length === 0 && <p className="text-gray-400">No active sessions found.</p>}
      <ul className="space-y-3">
        {sessions.map(s => {
          const device = parseDevice(s.userAgent);
          const browser = parseBrowser(s.userAgent);
          const signedIn = new Date(s.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
          return (
            <li key={s.jti} className={`rounded-lg border p-4 flex items-start justify-between gap-4 ${s.isCurrent ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-white'}`}>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{device}{browser ? ` · ${browser}` : ''}</span>
                  {s.isCurrent && <span className="text-xs bg-blue-100 text-blue-700 rounded px-2 py-0.5">This session</span>}
                </div>
                <div className="text-xs text-gray-400 mt-1">
                  {s.ip ?? 'Unknown IP'} · Signed in {signedIn}
                </div>
              </div>
              {!s.isCurrent && (
                <button
                  onClick={() => revoke(s.jti)}
                  disabled={revoking === s.jti}
                  className="text-sm text-red-600 hover:text-red-800 font-medium disabled:opacity-50 whitespace-nowrap"
                >
                  {revoking === s.jti ? 'Revoking…' : 'Revoke'}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
