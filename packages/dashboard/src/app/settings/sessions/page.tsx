'use client';
import { useEffect, useState } from 'react';
import { getAccessToken } from '@/lib/auth';

interface Session {
  jti: string;
  ip: string | null;
  userAgent: string | null;
  deviceName: string | null; // P-SES18: stable label from backend
  createdAt: string;
  lastUsedAt: string | null; // P-SES18
  expiresAt: string;
  isCurrent: boolean;
}

// P-SES18: relative time helper ("2m ago", "3h ago", "Yesterday")
function formatRelative(iso: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return day === 1 ? 'Yesterday' : `${day}d ago`;
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revokingAll, setRevokingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchSessions() {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/sessions`, {
      headers: { Authorization: `Bearer ${getAccessToken()}` },
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
      headers: { Authorization: `Bearer ${getAccessToken()}` },
    });
    setSessions(s => s.filter(x => x.jti !== jti));
    setRevoking(null);
  }

  // P-SES17: sign out all other devices
  async function revokeAll() {
    if (!confirm('Sign out all other devices? Your current session will stay active.')) return;
    setRevokingAll(true);
    await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/sessions/all`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${getAccessToken()}` },
    });
    setSessions(s => s.filter(x => x.isCurrent));
    setRevokingAll(false);
  }

  if (loading) return <div className="p-8 text-gray-500">Loading sessions…</div>;
  if (error) return <div className="p-8 text-red-600">{error}</div>;

  const others = sessions.filter(s => !s.isCurrent);

  return (
    <div className="max-w-2xl mx-auto p-8">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-semibold">Active Sessions</h1>
        {others.length > 0 && (
          <button
            onClick={revokeAll}
            disabled={revokingAll}
            className="text-sm text-red-600 hover:text-red-800 font-medium disabled:opacity-50"
          >
            {revokingAll ? 'Signing out…' : 'Sign out all other devices'}
          </button>
        )}
      </div>
      <p className="text-gray-500 text-sm mb-6">These devices are currently signed into your account. Revoke any session you don't recognize.</p>
      {sessions.length === 0 && <p className="text-gray-400">No active sessions found.</p>}
      <ul className="space-y-3">
        {sessions.map(s => {
          const label = s.deviceName ?? 'Unknown device'; // P-SES18: use stable backend label
          const signedIn = new Date(s.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
          const lastActive = formatRelative(s.lastUsedAt); // P-SES18
          return (
            <li key={s.jti} className={`rounded-lg border p-4 flex items-start justify-between gap-4 ${s.isCurrent ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-white'}`}>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{label}</span>
                  {s.isCurrent && <span className="text-xs bg-blue-100 text-blue-700 rounded px-2 py-0.5">This session</span>}
                </div>
                <div className="text-xs text-gray-400 mt-1">
                  {s.ip ?? 'Unknown IP'} · Signed in {signedIn}
                  {lastActive && ` · Last active ${lastActive}`}
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
