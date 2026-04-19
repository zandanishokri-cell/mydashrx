'use client';
import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { useFirstVisit } from '@/hooks/useFirstVisit';
import { useFieldError } from '@/lib/useFieldError';
import {
  Building2, Users, Warehouse, Bell, Check, X, Copy,
  Plus, Trash2, Pencil, Loader2, ChevronDown, AlertCircle, ShieldCheck, FileText, Lock,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────
type Role = 'super_admin' | 'pharmacy_admin' | 'dispatcher' | 'driver' | 'pharmacist';

interface Org {
  id: string;
  name: string;
  timezone: string;
  hipaaBaaStatus: string;
  billingPlan: string;
}

interface OrgUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  depotIds: string[];
  createdAt: string;
}

interface Depot {
  id: string;
  name: string;
  address: string;
  phone: string | null;
  lat: number;
  lng: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const TIMEZONES = [
  'America/New_York', 'America/Chicago', 'America/Denver',
  'America/Los_Angeles', 'America/Phoenix', 'America/Anchorage',
  'America/Honolulu', 'America/Detroit', 'America/Indiana/Indianapolis',
];

const ROLES: Role[] = ['pharmacy_admin', 'dispatcher', 'pharmacist', 'driver'];

const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'Super Admin',
  pharmacy_admin: 'Admin',
  dispatcher: 'Dispatcher',
  driver: 'Driver',
  pharmacist: 'Pharmacist',
};

const ROLE_COLORS: Record<Role, string> = {
  super_admin: 'bg-purple-100 text-purple-700',
  pharmacy_admin: 'bg-blue-100 text-blue-700',
  dispatcher: 'bg-teal-100 text-teal-700',
  driver: 'bg-amber-100 text-amber-700',
  pharmacist: 'bg-green-100 text-green-700',
};

const SERVER_NOTIF_KEYS = [
  { key: 'route_completed', label: 'Route completed emails', desc: 'When all stops on a route are finished' },
  { key: 'stop_failed',     label: 'Failed delivery alerts', desc: 'When a stop is marked failed' },
  { key: 'stop_assigned',   label: 'New stop assignments',   desc: 'When a stop is assigned to a route' },
] as const;

type ServerNotifKey = typeof SERVER_NOTIF_KEYS[number]['key'];
type ServerPrefs = Record<ServerNotifKey, boolean>;

// ─── Sub-components ───────────────────────────────────────────────────────────
function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap ${
        active
          ? 'border-b-2 border-[#0F4C81] text-[#0F4C81]'
          : 'text-gray-500 hover:text-gray-700'
      }`}
    >
      {label}
    </button>
  );
}

function Badge({ role }: { role: Role }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${ROLE_COLORS[role]}`}>
      {ROLE_LABELS[role]}
    </span>
  );
}

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50 ${checked ? 'bg-[#0F4C81]' : 'bg-gray-200'}`}
    >
      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
    </button>
  );
}

// ─── Tab: Organization ────────────────────────────────────────────────────────
function OrgTab({ orgId }: { orgId: string }) {
  const [org, setOrg] = useState<Org | null>(null);
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<Org>(`/orgs/${orgId}`).then(o => {
      setOrg(o); setName(o.name); setTimezone(o.timezone);
    }).catch(() => setError('Failed to load organization'));
  }, [orgId]);

  const save = async () => {
    setSaving(true); setError(''); setSaved(false);
    try {
      const updated = await api.patch<Org>(`/orgs/${orgId}`, { name, timezone });
      setOrg(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch { setError('Failed to save changes'); }
    finally { setSaving(false); }
  };

  if (!org && error) return (
    <div className="flex flex-col items-center justify-center py-20 gap-3">
      <AlertCircle className="text-red-400" size={24} />
      <p className="text-sm text-gray-500">{error}</p>
    </div>
  );

  if (!org) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="animate-spin text-gray-400" size={24} />
    </div>
  );

  const baaColors: Record<string, string> = {
    signed: 'bg-green-100 text-green-700',
    pending: 'bg-amber-100 text-amber-700',
    not_required: 'bg-gray-100 text-gray-500',
    expired: 'bg-red-100 text-red-700',
  };

  return (
    <div className="max-w-xl space-y-6">
      <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
        <div className="px-5 py-4">
          <h3 className="text-sm font-semibold text-gray-800 mb-3">Organization Details</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Organization Name</label>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F4C81]/30 focus:border-[#0F4C81]"
              />
            </div>
            <div>
              <label htmlFor="settings-timezone" className="block text-xs font-medium text-gray-600 mb-1">Timezone</label>
              <div className="relative">
                <select
                  id="settings-timezone"
                  value={timezone}
                  onChange={e => setTimezone(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-[#0F4C81]/30 focus:border-[#0F4C81]"
                >
                  {TIMEZONES.map(tz => (
                    <option key={tz} value={tz}>{tz.replace('America/', '').replace(/_/g, ' ')}</option>
                  ))}
                </select>
                <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
            </div>
          </div>
        </div>

        <div className="px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-gray-600">HIPAA BAA Status</p>
            <span className={`mt-1 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${baaColors[org.hipaaBaaStatus] ?? 'bg-gray-100 text-gray-500'}`}>
              {org.hipaaBaaStatus.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
            </span>
          </div>
          <div className="text-right">
            <p className="text-xs font-medium text-gray-600">Billing Plan</p>
            <span className="mt-1 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700 capitalize">
              {org.billingPlan}
            </span>
          </div>
        </div>

        <div className="px-5 py-4 flex items-center justify-between">
          <a href="/dashboard/billing" className="text-sm text-[#0F4C81] hover:underline font-medium">
            Manage Billing →
          </a>
          <div className="flex items-center gap-3">
            {error && <p className="text-xs text-red-500 flex items-center gap-1"><AlertCircle size={12} />{error}</p>}
            {saved && <span className="text-xs text-green-600 flex items-center gap-1"><Check size={12} />Saved</span>}
            <button
              onClick={save}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 bg-[#0F4C81] text-white text-sm font-medium rounded-lg hover:bg-[#0d3d6b] transition-colors disabled:opacity-50"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : null}
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Tab: Team Members ────────────────────────────────────────────────────────
function TeamTab({ orgId, currentUserId }: { orgId: string; currentUserId: string }) {
  const [members, setMembers] = useState<OrgUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [tempPassInfo, setTempPassInfo] = useState<{ name: string; email: string; pass: string } | null>(null);
  const [removeTarget, setRemoveTarget] = useState<OrgUser | null>(null);
  const showMemberTip = useFirstVisit('mdrx_member_tip');
  const [copied, setCopied] = useState(false);

  const [invite, setInvite] = useState({ name: '', email: '', role: 'dispatcher' as Role, depotIds: [] as string[] });
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState('');
  // P-A11Y20: accessible invite error
  const inviteFE = useFieldError(inviteError);
  const [inviteDepots, setInviteDepots] = useState<Depot[]>([]);
  const [editingRoleFor, setEditingRoleFor] = useState<string | null>(null);
  const [editRoleValue, setEditRoleValue] = useState<Role>('dispatcher');
  const [savingRole, setSavingRole] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState('');
  const [saveRoleError, setSaveRoleError] = useState('');
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(() => {
    setLoading(true); setLoadError(false);
    api.get<OrgUser[]>(`/orgs/${orgId}/users`)
      .then(setMembers)
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, [orgId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get<Depot[]>(`/orgs/${orgId}/depots`).then(setInviteDepots).catch(() => {});
  }, [orgId]);

  const handleInvite = async () => {
    if (!invite.name || !invite.email) { setInviteError('Name and email are required'); return; }
    setInviting(true); setInviteError('');
    try {
      const res = await api.post<{ user: OrgUser; tempPassword: string }>(`/orgs/${orgId}/users/invite`, invite);
      setMembers(prev => [...prev, res.user]);
      setTempPassInfo({ name: res.user.name, email: res.user.email, pass: res.tempPassword });
      setShowInvite(false);
      setInvite({ name: '', email: '', role: 'dispatcher', depotIds: [] });
    } catch (e: any) {
      setInviteError(
        e.status === 409
          ? 'A user with this email already exists in this organization'
          : 'Failed to invite user. Please try again.'
      );
    } finally { setInviting(false); }
  };

  const handleRemove = async () => {
    if (!removeTarget || removing) return;
    setRemoving(true);
    try {
      await api.del(`/orgs/${orgId}/users/${removeTarget.id}`);
      setMembers(prev => prev.filter(m => m.id !== removeTarget.id));
      setRemoveTarget(null);
    } catch {
      setRemoveError('Failed to remove user. Please try again.');
      setRemoveTarget(null);
    } finally { setRemoving(false); }
  };

  const startEditRole = (m: OrgUser) => { setEditingRoleFor(m.id); setEditRoleValue(m.role); };
  const cancelEditRole = () => { setEditingRoleFor(null); setSavingRole(false); setSaveRoleError(''); };
  const saveEditRole = async (userId: string) => {
    setSavingRole(true); setSaveRoleError('');
    try {
      const updated = await api.patch<OrgUser>(`/orgs/${orgId}/users/${userId}`, { role: editRoleValue });
      setMembers(prev => prev.map(m => m.id === userId ? { ...m, role: updated.role } : m));
      setEditingRoleFor(null);
    } catch { setSaveRoleError('Failed to update role. Please try again.'); }
    finally { setSavingRole(false); }
  };

  const copyPass = () => {
    if (tempPassInfo) navigator.clipboard.writeText(tempPassInfo.pass).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="animate-spin text-gray-400" size={24} /></div>;

  if (loadError) return (
    <div className="flex flex-col items-center justify-center py-20 gap-3">
      <AlertCircle className="text-red-400" size={24} />
      <p className="text-sm text-gray-500">Failed to load team members</p>
      <button onClick={load} className="text-sm text-[#0F4C81] hover:underline">Retry</button>
    </div>
  );

  return (
    <div>
      {(removeError || saveRoleError) && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 mb-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          <span className="flex items-center gap-2"><AlertCircle size={14} />{removeError || saveRoleError}</span>
          <button onClick={() => { setRemoveError(''); setSaveRoleError(''); }} className="text-red-400 hover:text-red-600"><X size={14} /></button>
        </div>
      )}
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">{members.length} member{members.length !== 1 ? 's' : ''}</p>
        <div className="flex flex-col items-end gap-1">
          {showMemberTip && (
            <p className="text-xs text-blue-600 bg-blue-50 border border-blue-100 rounded-lg px-2.5 py-1.5 max-w-xs text-right">
              Invite dispatchers, pharmacists, and drivers to your team.
            </p>
          )}
          <button
            onClick={() => setShowInvite(true)}
            className="flex items-center gap-2 px-3 py-2 bg-[#0F4C81] text-white text-sm font-medium rounded-lg hover:bg-[#0d3d6b] transition-colors"
          >
            <Plus size={14} /> Invite Member
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Name</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Email</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Role</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Joined</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {members.map(m => (
              <tr key={m.id} className="hover:bg-gray-50/50">
                <td className="px-4 py-3 font-medium text-gray-800">
                  {m.name}
                  {m.id === currentUserId && <span className="ml-2 text-xs text-gray-400">(you)</span>}
                </td>
                <td className="px-4 py-3 text-gray-500">{m.email}</td>
                <td className="px-4 py-3">
                  {editingRoleFor === m.id ? (
                    <div className="flex items-center gap-1.5">
                      <select
                        aria-label="Edit member role"
                        value={editRoleValue}
                        onChange={e => setEditRoleValue(e.target.value as Role)}
                        className="rounded border border-gray-200 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#0F4C81]/30"
                        disabled={savingRole}
                      >
                        {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                      </select>
                      <button onClick={() => saveEditRole(m.id)} disabled={savingRole}
                        className="p-1 rounded text-[#0F4C81] hover:bg-blue-50 disabled:opacity-50">
                        {savingRole ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                      </button>
                      <button onClick={cancelEditRole} className="p-1 rounded text-gray-400 hover:bg-gray-100">
                        <X size={12} />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Badge role={m.role} />
                      {/* P-RBAC7: amber badge for zero-scope dispatchers/pharmacists */}
                      {(m.role === 'dispatcher' || m.role === 'pharmacist') &&
                        Array.isArray(m.depotIds) && m.depotIds.length === 0 && (
                        <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                          ⚠ No depot access
                        </span>
                      )}
                      {m.id !== currentUserId && m.role !== 'super_admin' && (
                        <button onClick={() => startEditRole(m)}
                          className="p-1 rounded text-gray-300 hover:text-gray-500 hover:bg-gray-100 transition-colors">
                          <Pencil size={11} />
                        </button>
                      )}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-400 text-xs">{new Date(m.createdAt).toLocaleDateString()}</td>
                <td className="px-4 py-3 text-right">
                  {m.id !== currentUserId && m.role !== 'super_admin' && editingRoleFor !== m.id && (
                    <button
                      onClick={() => setRemoveTarget(m)}
                      className="p-1.5 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {members.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-gray-400">No team members yet</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Invite Modal */}
      {showInvite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-semibold text-gray-800">Invite Team Member</h3>
              <button onClick={() => { setShowInvite(false); setInviteError(''); }} className="p-1 rounded-lg hover:bg-gray-100"><X size={16} /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Full Name</label>
                <input value={invite.name} onChange={e => setInvite(p => ({ ...p, name: e.target.value }))}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F4C81]/30 focus:border-[#0F4C81]"
                  placeholder="Jane Smith" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                <input type="email" value={invite.email} onChange={e => setInvite(p => ({ ...p, email: e.target.value }))}
                  {...inviteFE.inputProps}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F4C81]/30 focus:border-[#0F4C81]"
                  placeholder="jane@pharmacy.com" />
              </div>
              <div>
                <label htmlFor="invite-role" className="block text-xs font-medium text-gray-600 mb-1">Role</label>
                <div className="relative">
                  <select id="invite-role" value={invite.role} onChange={e => setInvite(p => ({ ...p, role: e.target.value as Role }))}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-[#0F4C81]/30 focus:border-[#0F4C81]">
                    {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                  </select>
                  <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                </div>
              </div>
              {/* P-RBAC3-UI: depot selector for roles that are scoped by depot */}
              {(invite.role === 'dispatcher' || invite.role === 'pharmacist') && inviteDepots.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Depot Access <span className="text-gray-400 font-normal">(select at least one)</span>
                  </label>
                  <div className="space-y-1 max-h-32 overflow-y-auto border border-gray-200 rounded-md p-2">
                    {inviteDepots.map(depot => (
                      <label key={depot.id} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer hover:bg-gray-50 px-1 py-0.5 rounded">
                        <input
                          type="checkbox"
                          checked={invite.depotIds.includes(depot.id)}
                          onChange={e => setInvite(p => ({
                            ...p,
                            depotIds: e.target.checked
                              ? [...p.depotIds, depot.id]
                              : p.depotIds.filter(id => id !== depot.id),
                          }))}
                          className="rounded border-gray-300"
                        />
                        {depot.name}
                      </label>
                    ))}
                  </div>
                  {invite.depotIds.length === 0 && (
                    <p className="text-xs text-amber-600 mt-1">⚠ No depots selected — this user will have no access to routes, plans, or stops.</p>
                  )}
                </div>
              )}
              {/* P-A11Y20: always-in-DOM error region for screen reader announcement */}
              <p {...inviteFE.errorProps} className={`text-xs flex items-center gap-1 transition-opacity ${inviteError ? 'text-red-500 opacity-100' : 'opacity-0 pointer-events-none select-none'}`}>
                {inviteError && <AlertCircle size={12} />}{inviteError}
              </p>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => { setShowInvite(false); setInviteError(''); }}
                className="flex-1 px-4 py-2 border border-gray-200 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors">
                Cancel
              </button>
              <button onClick={handleInvite} disabled={inviting}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-[#0F4C81] text-white text-sm font-medium rounded-lg hover:bg-[#0d3d6b] transition-colors disabled:opacity-50">
                {inviting ? <Loader2 size={14} className="animate-spin" /> : null}
                Send Invite
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Temp Password Modal */}
      {tempPassInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-800">User Created</h3>
              <button onClick={() => { setTempPassInfo(null); setCopied(false); }} className="p-1 rounded-lg hover:bg-gray-100"><X size={16} /></button>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              <strong>{tempPassInfo.name}</strong> ({tempPassInfo.email}) has been added. Share this temporary password with them — they should change it on first login.
            </p>
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-4 py-3">
              <code className="flex-1 font-mono text-base font-semibold text-gray-800 tracking-wider">{tempPassInfo.pass}</code>
              <button onClick={copyPass}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${copied ? 'bg-green-100 text-green-700' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                {copied ? <><Check size={12} />Copied</> : <><Copy size={12} />Copy</>}
              </button>
            </div>
            <button onClick={() => { setTempPassInfo(null); setCopied(false); }}
              className="w-full mt-4 px-4 py-2 bg-[#0F4C81] text-white text-sm font-medium rounded-lg hover:bg-[#0d3d6b] transition-colors">
              Done
            </button>
          </div>
        </div>
      )}

      {/* Remove Confirm Dialog */}
      {removeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <h3 className="font-semibold text-gray-800 mb-2">Remove Member</h3>
            <p className="text-sm text-gray-500 mb-5">
              Remove <strong>{removeTarget.name}</strong> from the organization? They will lose access immediately.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setRemoveTarget(null)}
                className="flex-1 px-4 py-2 border border-gray-200 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors">
                Cancel
              </button>
              <button onClick={handleRemove} disabled={removing}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-red-500 text-white text-sm font-medium rounded-lg hover:bg-red-600 transition-colors disabled:opacity-50">
                {removing ? <Loader2 size={14} className="animate-spin" /> : null}
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tab: Depots ──────────────────────────────────────────────────────────────
function DepotsTab({ orgId }: { orgId: string }) {
  const [depots, setDepots] = useState<Depot[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editTarget, setEditTarget] = useState<Depot | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Depot | null>(null);
  const showDepotTip = useFirstVisit('mdrx_depot_tip');
  const [form, setForm] = useState({ name: '', address: '', phone: '', lat: '', lng: '' });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [formError, setFormError] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(() => {
    setLoading(true); setLoadError(false);
    api.get<Depot[]>(`/orgs/${orgId}/depots`)
      .then(setDepots)
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  const openEdit = (d: Depot) => {
    setEditTarget(d);
    setForm({ name: d.name, address: d.address, phone: d.phone ?? '', lat: String(d.lat), lng: String(d.lng) });
    setFormError('');
  };

  const resetForm = () => { setForm({ name: '', address: '', phone: '', lat: '', lng: '' }); setFormError(''); };

  const handleSave = async () => {
    if (!form.name || !form.address) { setFormError('Name and address are required'); return; }
    setSaving(true); setFormError('');
    const payload = { name: form.name, address: form.address, phone: form.phone || undefined, lat: Number(form.lat) || 0, lng: Number(form.lng) || 0 };
    try {
      if (editTarget) {
        const updated = await api.put<Depot>(`/orgs/${orgId}/depots/${editTarget.id}`, payload);
        setDepots(prev => prev.map(d => d.id === updated.id ? updated : d));
        setEditTarget(null);
      } else {
        const created = await api.post<Depot>(`/orgs/${orgId}/depots`, payload);
        setDepots(prev => [...prev, created]);
        setShowAdd(false);
      }
      resetForm();
    } catch { setFormError('Failed to save depot'); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await api.del(`/orgs/${orgId}/depots/${deleteTarget.id}`);
      setDepots(prev => prev.filter(d => d.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch {
      setDeleteError('Failed to delete depot. Please try again.');
      setDeleteTarget(null);
    } finally { setDeleting(false); }
  };

  const DepotForm = ({ isEdit }: { isEdit?: boolean }) => (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">Depot Name</label>
          <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F4C81]/30 focus:border-[#0F4C81]"
            placeholder="Main Pharmacy" />
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">Address</label>
          <input value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F4C81]/30 focus:border-[#0F4C81]"
            placeholder="123 Main St, Detroit, MI 48201" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
          <input value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F4C81]/30 focus:border-[#0F4C81]"
            placeholder="(313) 555-0100" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Latitude</label>
            <input value={form.lat} onChange={e => setForm(p => ({ ...p, lat: e.target.value }))}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F4C81]/30 focus:border-[#0F4C81]"
              placeholder="42.33" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Longitude</label>
            <input value={form.lng} onChange={e => setForm(p => ({ ...p, lng: e.target.value }))}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F4C81]/30 focus:border-[#0F4C81]"
              placeholder="-83.04" />
          </div>
        </div>
      </div>
      {formError && <p className="text-xs text-red-500 flex items-center gap-1"><AlertCircle size={12} />{formError}</p>}
    </div>
  );

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="animate-spin text-gray-400" size={24} /></div>;

  if (loadError) return (
    <div className="flex flex-col items-center justify-center py-20 gap-3">
      <AlertCircle className="text-red-400" size={24} />
      <p className="text-sm text-gray-500">Failed to load depots</p>
      <button onClick={load} className="text-sm text-[#0F4C81] hover:underline">Retry</button>
    </div>
  );

  return (
    <div>
      {deleteError && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 mb-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          <span className="flex items-center gap-2"><AlertCircle size={14} />{deleteError}</span>
          <button onClick={() => setDeleteError('')} className="text-red-400 hover:text-red-600"><X size={14} /></button>
        </div>
      )}
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">{depots.length} depot{depots.length !== 1 ? 's' : ''}</p>
        <div className="flex flex-col items-end gap-1">
          {showDepotTip && (
            <p className="text-xs text-blue-600 bg-blue-50 border border-blue-100 rounded-lg px-2.5 py-1.5 max-w-xs text-right">
              Add a depot to enable route creation and driver assignments.
            </p>
          )}
          <button
            onClick={() => { resetForm(); setShowAdd(true); }}
            className="flex items-center gap-2 px-3 py-2 bg-[#0F4C81] text-white text-sm font-medium rounded-lg hover:bg-[#0d3d6b] transition-colors"
          >
            <Plus size={14} /> Add Depot
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {depots.map(d => (
          <div key={d.id} className="rounded-xl border border-gray-200 bg-white px-4 py-4 flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <p className="font-medium text-gray-800 text-sm">{d.name}</p>
                {d.lat === 0 && d.lng === 0 && (
                  <span className="px-1.5 py-0.5 text-xs font-medium rounded-full bg-amber-50 text-amber-700 border border-amber-200 whitespace-nowrap">
                    No coordinates
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-500 mt-0.5">{d.address}</p>
              {d.phone && <p className="text-xs text-gray-400 mt-0.5">{d.phone}</p>}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={() => openEdit(d)}
                className="p-1.5 rounded-lg text-gray-400 hover:bg-blue-50 hover:text-blue-500 transition-colors">
                <Pencil size={14} />
              </button>
              <button onClick={() => setDeleteTarget(d)}
                className="p-1.5 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors">
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
        {depots.length === 0 && (
          <div className="rounded-xl border border-dashed border-gray-200 bg-white py-10 text-center text-sm text-gray-400">
            No depots yet. Add your first depot to get started.
          </div>
        )}
      </div>

      {/* Add Modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-semibold text-gray-800">Add Depot</h3>
              <button onClick={() => { setShowAdd(false); resetForm(); }} className="p-1 rounded-lg hover:bg-gray-100"><X size={16} /></button>
            </div>
            <DepotForm />
            <div className="flex gap-3 mt-5">
              <button onClick={() => { setShowAdd(false); resetForm(); }}
                className="flex-1 px-4 py-2 border border-gray-200 text-sm font-medium rounded-lg hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-[#0F4C81] text-white text-sm font-medium rounded-lg hover:bg-[#0d3d6b] disabled:opacity-50">
                {saving ? <Loader2 size={14} className="animate-spin" /> : null} Add Depot
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-semibold text-gray-800">Edit Depot</h3>
              <button onClick={() => { setEditTarget(null); resetForm(); }} className="p-1 rounded-lg hover:bg-gray-100"><X size={16} /></button>
            </div>
            <DepotForm isEdit />
            <div className="flex gap-3 mt-5">
              <button onClick={() => { setEditTarget(null); resetForm(); }}
                className="flex-1 px-4 py-2 border border-gray-200 text-sm font-medium rounded-lg hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-[#0F4C81] text-white text-sm font-medium rounded-lg hover:bg-[#0d3d6b] disabled:opacity-50">
                {saving ? <Loader2 size={14} className="animate-spin" /> : null} Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <h3 className="font-semibold text-gray-800 mb-2">Delete Depot</h3>
            <p className="text-sm text-gray-500 mb-5">Delete <strong>{deleteTarget.name}</strong>? This cannot be undone.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteTarget(null)}
                className="flex-1 px-4 py-2 border border-gray-200 text-sm font-medium rounded-lg hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={handleDelete} disabled={deleting}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-red-500 text-white text-sm font-medium rounded-lg hover:bg-red-600 disabled:opacity-50">
                {deleting ? <Loader2 size={14} className="animate-spin" /> : null}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tab: Notifications ───────────────────────────────────────────────────────
const DEFAULT_SERVER_PREFS: ServerPrefs = { route_completed: true, stop_failed: true, stop_assigned: true };

function NotificationsTab({ orgId }: { orgId: string }) {
  const [prefs, setPrefs] = useState<ServerPrefs>(DEFAULT_SERVER_PREFS);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState('');

  const load = useCallback(() => {
    setLoading(true); setLoadError(false);
    api.get<ServerPrefs>(`/orgs/${orgId}/users/me/preferences`)
      .then(data => setPrefs({ ...DEFAULT_SERVER_PREFS, ...data }))
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  const [savingKeys, setSavingKeys] = useState<Set<ServerNotifKey>>(new Set());

  const toggle = async (key: ServerNotifKey) => {
    if (savingKeys.has(key)) return; // prevent concurrent in-flight for same key
    const prev = prefs[key];
    setSavingKeys(s => new Set([...s, key]));
    setPrefs(p => ({ ...p, [key]: !prev })); // optimistic
    setSaveError('');
    try {
      await api.patch<ServerPrefs>(`/orgs/${orgId}/users/me/preferences`, { [key]: !prev });
    } catch {
      setPrefs(p => ({ ...p, [key]: prev })); // rollback
      setSaveError('Failed to save preference — please try again');
    } finally {
      setSavingKeys(s => { const n = new Set(s); n.delete(key); return n; });
    }
  };

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="animate-spin text-gray-400" size={24} /></div>;

  if (loadError) return (
    <div className="flex flex-col items-center justify-center py-20 gap-3">
      <AlertCircle className="text-red-400" size={24} />
      <p className="text-sm text-gray-500">Failed to load notification preferences</p>
      <button onClick={load} className="text-sm text-[#0F4C81] hover:underline">Retry</button>
    </div>
  );

  return (
    <div className="max-w-xl">
      {saveError && (
        <div className="flex items-center gap-2 px-4 py-3 mb-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          <AlertCircle size={14} />{saveError}
        </div>
      )}
      <div className="rounded-xl border border-gray-200 bg-white divide-y divide-gray-100">
        {SERVER_NOTIF_KEYS.map(({ key, label, desc }) => (
          <div key={key} className="flex items-center justify-between px-5 py-4 gap-4">
            <div>
              <p className="text-sm text-gray-700 font-medium">{label}</p>
              <p className="text-xs text-gray-400 mt-0.5">{desc}</p>
            </div>
            <Toggle checked={prefs[key]} onChange={() => toggle(key)} disabled={savingKeys.has(key)} />
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs text-gray-400">
        These control email notifications sent to your account. Configure SMS/automation triggers in the <a href="/dashboard/automation" className="text-[#0F4C81] hover:underline">Automation</a> section.
      </p>
    </div>
  );
}

// ─── Tab: Compliance (P-COMP11) ───────────────────────────────────────────────
// BAA acceptance status + HIPAA controls checklist. Immutable once BAA is accepted.
interface BaaStatus {
  accepted: boolean;
  baaAcceptedAt: string | null;
  signerName: string | null;
  ipAddress: string | null;
  hipaaBaaStatus: string;
}

const HIPAA_CONTROLS = [
  { key: 'baa', label: 'Business Associate Agreement (BAA)', desc: 'Signed BAA on file with MyDashRx — required before handling ePHI.' },
  { key: 'phi_encryption', label: 'PHI Encrypted in Transit', desc: 'All data transmitted over HTTPS/TLS 1.2+.' },
  { key: 'access_control', label: 'Role-Based Access Control', desc: 'Staff access scoped to role and depot; minimum-necessary enforcement.' },
  { key: 'audit_log', label: 'HIPAA Audit Logging', desc: 'All PHI access events logged with user, timestamp, and IP.' },
  { key: 'idle_timeout', label: 'Automatic Session Timeout', desc: 'Sessions expire after 10 min idle for PHI-role users.' },
  { key: 'phi_purge', label: 'PHI Retention & Purge', desc: 'Proof-of-delivery PHI auto-purged after 7-year retention per HIPAA §164.310(d)(2)(i).' },
] as const;

function ComplianceTab({ orgId }: { orgId: string }) {
  const [status, setStatus] = useState<BaaStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState('');
  const [agreed, setAgreed] = useState(false);

  useEffect(() => {
    api.get<BaaStatus>(`/orgs/${orgId}/baa/status`)
      .then(s => setStatus(s))
      .catch(() => setError('Failed to load BAA status'))
      .finally(() => setLoading(false));
  }, [orgId]);

  const acceptBaa = async () => {
    if (!agreed) return;
    setAccepting(true); setError('');
    try {
      await api.post(`/orgs/${orgId}/baa-accept`, {});
      const s = await api.get<BaaStatus>(`/orgs/${orgId}/baa/status`);
      setStatus(s);
      setAccepted(true);
    } catch { setError('Failed to record BAA acceptance. Please contact support.'); }
    finally { setAccepting(false); }
  };

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="animate-spin text-gray-400" size={24} /></div>;

  return (
    <div className="max-w-2xl space-y-6">
      {/* BAA Section */}
      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
          <FileText size={16} className="text-[#0F4C81]" />
          <h3 className="text-sm font-semibold text-gray-800">Business Associate Agreement (BAA)</h3>
        </div>
        <div className="px-5 py-5">
          {status?.accepted ? (
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                <Check size={16} className="text-green-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-green-700">BAA Signed</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Accepted {status.baaAcceptedAt ? new Date(status.baaAcceptedAt).toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' }) : '—'}
                  {status.signerName ? ` by ${status.signerName}` : ''}
                </p>
                {status.ipAddress && <p className="text-xs text-gray-400 mt-0.5">IP: {status.ipAddress}</p>}
                <p className="text-xs text-amber-600 mt-2 bg-amber-50 px-2 py-1 rounded">This record is immutable — BAA acceptance cannot be undone.</p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <p className="text-sm font-semibold text-amber-800 mb-1">BAA Required Before Handling Patient Data</p>
                <p className="text-xs text-amber-700">HIPAA §164.308(b)(1) requires a signed BAA with any business associate that creates, receives, maintains, or transmits protected health information (PHI) on your behalf. By accepting, your organization enters into a legally binding BAA with MyDashRx Inc.</p>
              </div>
              <div className="text-sm text-gray-700 bg-gray-50 rounded-xl p-4 space-y-2 max-h-40 overflow-y-auto text-xs leading-relaxed">
                <p className="font-semibold">Summary of BAA Terms</p>
                <p>MyDashRx Inc. ("Business Associate") agrees to: (1) not use or disclose PHI except as permitted; (2) implement appropriate safeguards; (3) report any breaches; (4) ensure subcontractors agree to same obligations; (5) make PHI available per HIPAA rights; (6) return or destroy PHI on termination.</p>
                <p>This BAA is governed by HIPAA (45 CFR Parts 160 and 164) and is effective upon acceptance.</p>
              </div>
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} className="mt-0.5 accent-[#0F4C81]" />
                <span className="text-sm text-gray-700">I am authorized to enter into this BAA on behalf of my organization, and I accept the terms above.</span>
              </label>
              {accepted && <p className="text-sm text-green-600 flex items-center gap-1"><Check size={14} /> BAA accepted successfully</p>}
              {error && <p className="text-sm text-red-500 flex items-center gap-1"><AlertCircle size={13} />{error}</p>}
              <button
                onClick={acceptBaa}
                disabled={!agreed || accepting}
                className="flex items-center gap-2 px-5 py-2.5 bg-[#0F4C81] text-white rounded-xl text-sm font-semibold disabled:opacity-40 hover:bg-[#0d3d69] transition-colors"
              >
                <FileText size={14} /> {accepting ? 'Recording…' : 'Accept BAA'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* HIPAA Controls Checklist */}
      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
          <ShieldCheck size={16} className="text-emerald-600" />
          <h3 className="text-sm font-semibold text-gray-800">HIPAA Controls Checklist</h3>
        </div>
        <div className="divide-y divide-gray-50">
          {HIPAA_CONTROLS.map(c => {
            const on = c.key === 'baa' ? !!status?.accepted : true;
            return (
              <div key={c.key} className="px-5 py-3.5 flex items-start gap-3">
                <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${on ? 'bg-green-100' : 'bg-amber-100'}`}>
                  {on ? <Check size={11} className="text-green-600" /> : <AlertCircle size={11} className="text-amber-600" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800">{c.label}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{c.desc}</p>
                </div>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${on ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
                  {on ? 'Active' : 'Pending'}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
// ─── Tab: Permissions (P-RBAC36) ──────────────────────────────────────────────
// Pharmacy admin can view/edit org role templates within platform envelope
interface RoleTemplate { id: string; orgId: string | null; role: string; permissions: string[]; isDefault: boolean; }

const MANAGEABLE_ROLES = ['dispatcher', 'driver', 'pharmacist'] as const;

function PermissionsTab({ orgId }: { orgId: string }) {
  const [templates, setTemplates] = useState<RoleTemplate[]>([]);
  const [platformTemplates, setPlatformTemplates] = useState<RoleTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<{ templates: RoleTemplate[] }>('/pharmacy/role-templates')
      .then(({ templates: all }) => {
        setPlatformTemplates(all.filter(t => t.orgId === null));
        setTemplates(all.filter(t => t.orgId === orgId));
      })
      .catch(() => setError('Failed to load permissions'))
      .finally(() => setLoading(false));
  }, [orgId]);

  const getEffective = (role: string) =>
    templates.find(t => t.role === role)?.permissions
    ?? platformTemplates.find(t => t.role === role)?.permissions
    ?? [];

  const getPlatform = (role: string) =>
    platformTemplates.find(t => t.role === role)?.permissions ?? [];

  const togglePerm = (role: string, perm: string) => {
    const current = getEffective(role);
    const next = current.includes(perm) ? current.filter(p => p !== perm) : [...current, perm];
    setTemplates(prev => {
      const existing = prev.find(t => t.role === role);
      if (existing) return prev.map(t => t.role === role ? { ...t, permissions: next } : t);
      return [...prev, { id: '', orgId, role, permissions: next, isDefault: false }];
    });
    setSaved(prev => ({ ...prev, [role]: false }));
  };

  const saveRole = async (role: string) => {
    setSaving(prev => ({ ...prev, [role]: true }));
    setError('');
    try {
      await api.patch('/pharmacy/role-templates', { role, permissions: getEffective(role) });
      setSaved(prev => ({ ...prev, [role]: true }));
      setTimeout(() => setSaved(prev => ({ ...prev, [role]: false })), 2000);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to save';
      setError(msg);
    } finally {
      setSaving(prev => ({ ...prev, [role]: false }));
    }
  };

  if (loading) return <div className="animate-pulse h-32 bg-gray-50 rounded-xl" />;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Role Permissions</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Customize what each role can do within your organization. You cannot grant permissions beyond the platform defaults.
        </p>
      </div>
      {error && <div className="bg-red-50 text-red-700 text-sm px-4 py-2 rounded-lg">{error}</div>}
      {MANAGEABLE_ROLES.map(role => {
        const platformPerms = getPlatform(role);
        const effective = getEffective(role);
        return (
          <div key={role} className="bg-white border border-gray-100 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-800 capitalize">{role.replace('_', ' ')}</h3>
              <button
                onClick={() => saveRole(role)}
                disabled={saving[role]}
                className="text-xs bg-[#0F4C81] text-white px-3 py-1.5 rounded-lg hover:bg-[#0d3f6e] disabled:opacity-50 flex items-center gap-1"
              >
                {saving[role] ? <Loader2 size={11} className="animate-spin" /> : saved[role] ? <Check size={11} /> : null}
                {saved[role] ? 'Saved' : 'Save'}
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {platformPerms.map(perm => {
                const enabled = effective.includes(perm);
                return (
                  <label key={perm} className="flex items-center gap-2 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={() => togglePerm(role, perm)}
                      className="rounded border-gray-300 text-[#0F4C81] focus:ring-[#0F4C81]"
                      aria-label={perm}
                    />
                    <span className="text-xs text-gray-700 group-hover:text-gray-900 font-mono">{perm}</span>
                  </label>
                );
              })}
            </div>
            {platformPerms.length === 0 && (
              <p className="text-xs text-gray-400 flex items-center gap-1"><Lock size={11} /> No configurable permissions for this role</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Tab: Referral (P-CNV32) ─────────────────────────────────────────────────
function ReferralTab({ orgId }: { orgId: string }) {
  const [copied, setCopied] = useState(false);
  const refUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/signup/pharmacy?ref=${orgId}`
    : `https://mydashrx-dashboard-ai-receptionist-ivr-system.vercel.app/signup/pharmacy?ref=${orgId}`;

  const copy = () => {
    navigator.clipboard.writeText(refUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  return (
    <div className="max-w-xl space-y-6">
      <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-5">
        <p className="text-sm font-semibold text-gray-800 mb-1">Refer a pharmacy</p>
        <p className="text-xs text-gray-500 mb-4">
          Share MyDashRx with other Michigan pharmacies. We&apos;ll notify you when they&apos;re approved and live.
        </p>
        <div className="flex items-center gap-2 mb-3">
          <input
            readOnly
            value={refUrl}
            className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-700 bg-white focus:outline-none"
            onClick={e => (e.target as HTMLInputElement).select()}
          />
          <button
            onClick={copy}
            className="rounded-lg bg-indigo-600 text-white text-xs px-3 py-2 hover:bg-indigo-700 transition flex items-center gap-1.5 shrink-0"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
        <a
          href={`mailto:?subject=Try%20MyDashRx&body=I%20use%20MyDashRx%20for%20pharmacy%20delivery%20dispatching%20%E2%80%94%20you%20should%20check%20it%20out%3A%20${encodeURIComponent(refUrl)}`}
          className="text-xs text-indigo-600 hover:underline"
        >
          Email a colleague →
        </a>
      </div>
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <p className="text-sm font-semibold text-gray-800 mb-2">How it works</p>
        <ol className="space-y-2 text-xs text-gray-600 list-decimal list-inside">
          <li>Share your referral link with another pharmacy owner.</li>
          <li>They sign up using your link — their application is linked to your pharmacy.</li>
          <li>When they&apos;re approved, you&apos;ll receive an email notification.</li>
        </ol>
      </div>
    </div>
  );
}

const TABS = [
  { id: 'org', label: 'Organization', icon: Building2 },
  { id: 'team', label: 'Team Members', icon: Users },
  { id: 'depots', label: 'Depots', icon: Warehouse },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'compliance', label: 'Compliance', icon: ShieldCheck },
  { id: 'permissions', label: 'Permissions', icon: Lock },
  { id: 'referral', label: 'Refer a Pharmacy', icon: Copy },
] as const;

type TabId = typeof TABS[number]['id'];

export default function SettingsPage() {
  // P-CNV32: support ?tab=referral deep link from referral success email CTA
  const [tab, setTab] = useState<TabId>(() => {
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search).get('tab');
      if (p && TABS.some(t => t.id === p)) return p as TabId;
    }
    return 'org';
  });
  const user = getUser();
  const orgId = user?.orgId ?? '';
  const userId = user?.id ?? '';

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900" style={{ fontFamily: 'var(--font-sora)' }}>Settings</h1>
        <p className="text-sm text-gray-500 mt-0.5">Manage your organization, team, and preferences</p>
      </div>

      {/* Tab bar */}
      <div className="border-b border-gray-200 mb-6 -mx-0 flex gap-1">
        {TABS.map(({ id, label, icon: Icon }) => (
          <TabButton key={id} label={label} active={tab === id} onClick={() => setTab(id)} />
        ))}
      </div>

      {/* Tab content */}
      {tab === 'org' && <OrgTab orgId={orgId} />}
      {tab === 'team' && <TeamTab orgId={orgId} currentUserId={userId} />}
      {tab === 'depots' && <DepotsTab orgId={orgId} />}
      {tab === 'notifications' && <NotificationsTab orgId={orgId} />}
      {tab === 'compliance' && <ComplianceTab orgId={orgId} />}
      {tab === 'permissions' && (user?.role === 'pharmacy_admin' || user?.role === 'super_admin') && <PermissionsTab orgId={orgId} />}
      {tab === 'referral' && (user?.role === 'pharmacy_admin') && <ReferralTab orgId={orgId} />}
    </div>
  );
}
