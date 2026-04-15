'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, CheckCircle, XCircle, Plus, Settings } from 'lucide-react';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';

type NotifEvent = {
  id: string;
  type: 'route_completed' | 'stop_failed' | 'stop_assigned';
  title: string;
  body: string;
  timestamp: string;
  link: string | null;
};

const eventIcon = (type: NotifEvent['type']) => {
  if (type === 'route_completed') return <CheckCircle size={14} className="text-emerald-500 shrink-0 mt-0.5" />;
  if (type === 'stop_failed') return <XCircle size={14} className="text-red-500 shrink-0 mt-0.5" />;
  return <Plus size={14} className="text-blue-500 shrink-0 mt-0.5" />;
};

function timeSince(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export default function NotificationPanel() {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<NotifEvent[]>([]);
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const [showSettings, setShowSettings] = useState(false);
  const [prefs, setPrefs] = useState<Record<string, boolean>>({ route_completed: true, stop_failed: true, stop_assigned: true });
  const [prefsLoading, setPrefsLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const user = getUser();

  const orgId = user?.orgId;

  const load = useCallback(() => {
    if (!orgId) return;
    let cancelled = false;
    api.get<{ events: NotifEvent[]; total: number }>(`/orgs/${orgId}/notifications`)
      .then(res => { if (!cancelled) setEvents(res.events); })
      .catch(() => { /* non-blocking */ });
    return () => { cancelled = true; };
  }, [orgId]);

  const loadPrefs = useCallback(() => {
    if (!orgId) return;
    api.get<Record<string, boolean>>(`/orgs/${orgId}/users/me/preferences`)
      .then(p => setPrefs(p))
      .catch(() => {});
  }, [orgId]);

  // Initial load + 60s polling
  useEffect(() => {
    let cancelCurrent = load();
    const interval = setInterval(() => { cancelCurrent?.(); cancelCurrent = load(); }, 60_000);
    return () => { clearInterval(interval); cancelCurrent?.(); };
  }, [load]);

  useEffect(() => { loadPrefs(); }, [loadPrefs]);
  useEffect(() => { if (showSettings) loadPrefs(); }, [showSettings]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const unread = events.filter(e => !seen.has(e.id)).length;

  const handleOpen = () => {
    setOpen(v => !v);
    if (!open) setSeen(new Set(events.map(e => e.id)));
  };

  const handleClick = (e: NotifEvent) => {
    if (e.link) { router.push(e.link); setOpen(false); }
  };

  const togglePref = (key: string) => {
    if (prefsLoading) return;
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    setPrefsLoading(true);
    api.patch<Record<string, boolean>>(`/orgs/${orgId}/users/me/preferences`, { [key]: !prefs[key] })
      .then(updated => setPrefs(updated))
      .catch(() => setPrefs(prefs))
      .finally(() => setPrefsLoading(false));
  };

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={handleOpen}
        className="relative p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
        aria-label="Notifications"
      >
        <Bell size={16} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-3.5 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-0.5">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-xl border border-gray-100 shadow-xl z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-700">Notifications</span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">Last 24h</span>
              <button
                onClick={() => setShowSettings(v => !v)}
                className={`p-1 rounded-md transition-colors ${showSettings ? 'bg-gray-100 text-gray-700' : 'text-gray-400 hover:text-gray-600'}`}
                title="Notification settings"
              >
                <Settings size={12} />
              </button>
            </div>
          </div>

          {showSettings ? (
            <div className="px-4 py-3 space-y-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Show notifications for</p>
              {([
                { key: 'route_completed', label: 'Route completed', icon: <CheckCircle size={13} className="text-emerald-500" /> },
                { key: 'stop_failed', label: 'Stop failed', icon: <XCircle size={13} className="text-red-500" /> },
                { key: 'stop_assigned', label: 'New stop assigned', icon: <Plus size={13} className="text-blue-500" /> },
              ] as const).map(({ key, label, icon }) => (
                <button
                  key={key}
                  onClick={() => togglePref(key)}
                  disabled={prefsLoading}
                  className="w-full flex items-center justify-between text-left hover:bg-gray-50 rounded-lg px-2 py-1.5 transition-colors disabled:opacity-60"
                >
                  <span className="flex items-center gap-2 text-xs text-gray-700">
                    {icon}{label}
                  </span>
                  <span className={`w-8 h-4 rounded-full transition-colors flex items-center ${prefs[key] !== false ? 'bg-[#00B8A9]' : 'bg-gray-200'}`}>
                    <span className={`w-3 h-3 bg-white rounded-full shadow transition-transform mx-0.5 ${prefs[key] !== false ? 'translate-x-4' : 'translate-x-0'}`} />
                  </span>
                </button>
              ))}
            </div>
          ) : (
            events.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <Bell size={20} className="text-gray-300 mx-auto mb-2" />
                <p className="text-xs text-gray-400">No events in the last 24 hours</p>
              </div>
            ) : (
              <ul className="max-h-80 overflow-y-auto divide-y divide-gray-50">
                {events.map(e => (
                  <li
                    key={e.id}
                    onClick={() => handleClick(e)}
                    className={`flex gap-2.5 px-4 py-3 ${e.link ? 'cursor-pointer hover:bg-gray-50' : ''} transition-colors`}
                  >
                    {eventIcon(e.type)}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-gray-800 truncate">{e.title}</p>
                      <p className="text-xs text-gray-500 truncate">{e.body}</p>
                    </div>
                    <span className="text-[10px] text-gray-400 shrink-0 mt-0.5">{timeSince(e.timestamp)}</span>
                  </li>
                ))}
              </ul>
            )
          )}
        </div>
      )}
    </div>
  );
}
