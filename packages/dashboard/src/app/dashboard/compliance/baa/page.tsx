'use client';
import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { Plus, Pencil, Trash2, X, Check, ChevronLeft, AlertCircle } from 'lucide-react';
import Link from 'next/link';

interface BaaEntry {
  id: string;
  vendorName: string;
  service: string;
  baaStatus: 'signed' | 'pending' | 'not_required' | 'expired';
  signedAt: string | null;
  expiresAt: string | null;
  documentUrl: string | null;
  notes: string | null;
  touchesPhi: boolean;
  createdAt: string;
  updatedAt: string;
}

type BaaStatus = 'signed' | 'pending' | 'not_required' | 'expired';

const STATUS_BADGE: Record<BaaStatus, string> = {
  signed: 'bg-emerald-100 text-emerald-700',
  pending: 'bg-amber-100 text-amber-700',
  not_required: 'bg-gray-100 text-gray-600',
  expired: 'bg-red-100 text-red-700',
};

const STATUS_LABEL: Record<BaaStatus, string> = {
  signed: 'Signed',
  pending: 'Pending',
  not_required: 'Not Required',
  expired: 'Expired',
};

const DEFAULT_VENDORS = [
  { vendorName: 'Render', service: 'Cloud Hosting', baaStatus: 'signed' as BaaStatus, touchesPhi: true, notes: 'BAA on file via Render HIPAA program' },
  { vendorName: 'Twilio', service: 'SMS / IVR', baaStatus: 'pending' as BaaStatus, touchesPhi: true, notes: 'BAA required — request via Twilio sales' },
  { vendorName: 'Cloudflare R2', service: 'File Storage', baaStatus: 'not_required' as BaaStatus, touchesPhi: false, notes: 'R2 has no BAA — do NOT store PHI here' },
  { vendorName: 'Stripe', service: 'Payments', baaStatus: 'not_required' as BaaStatus, touchesPhi: false, notes: 'Payment data only, no PHI processed' },
];

const emptyForm = () => ({
  vendorName: '', service: '', baaStatus: 'pending' as BaaStatus,
  signedAt: '', expiresAt: '', documentUrl: '', notes: '', touchesPhi: true,
});

export default function BaaPage() {
  const [user] = useState(getUser);
  const [entries, setEntries] = useState<BaaEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [confirmDeleteBaaId, setConfirmDeleteBaaId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true); setLoadError(false);
    try {
      const rows = await api.get<BaaEntry[]>(`/orgs/${user.orgId}/compliance/baa`);
      setEntries(rows);
    } catch { setEntries([]); setLoadError(true); }
    finally { setLoading(false); }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const openAdd = () => { setForm(emptyForm()); setEditId(null); setShowForm(true); };

  const openEdit = (e: BaaEntry) => {
    setForm({
      vendorName: e.vendorName,
      service: e.service,
      baaStatus: e.baaStatus,
      signedAt: e.signedAt ? e.signedAt.split('T')[0] : '',
      expiresAt: e.expiresAt ? e.expiresAt.split('T')[0] : '',
      documentUrl: e.documentUrl ?? '',
      notes: e.notes ?? '',
      touchesPhi: e.touchesPhi,
    });
    setEditId(e.id);
    setShowForm(true);
  };

  const save = async () => {
    if (!user || !form.vendorName || !form.service) return;
    setSaving(true);
    setSaveError('');
    try {
      const payload = {
        ...form,
        signedAt: form.signedAt || undefined,
        expiresAt: form.expiresAt || undefined,
        documentUrl: form.documentUrl || undefined,
        notes: form.notes || undefined,
      };
      if (editId) {
        await api.patch(`/orgs/${user.orgId}/compliance/baa/${editId}`, payload);
      } else {
        await api.post(`/orgs/${user.orgId}/compliance/baa`, payload);
      }
      setShowForm(false);
      await load();
    } catch (err: any) { setSaveError(err?.message ?? 'Save failed. Please try again.'); }
    finally { setSaving(false); }
  };

  const remove = async () => {
    if (!user || !confirmDeleteBaaId) return;
    const id = confirmDeleteBaaId;
    setConfirmDeleteBaaId(null);
    setDeletingId(id);
    setDeleteError('');
    try {
      await api.del(`/orgs/${user.orgId}/compliance/baa/${id}`);
      await load();
    } catch (err: any) { setDeleteError(err?.message ?? 'Delete failed. Please try again.'); }
    finally { setDeletingId(null); }
  };

  const seedDefaults = async () => {
    if (!user) return;
    setSaving(true); setSaveError('');
    try {
      await Promise.all(DEFAULT_VENDORS.map(v => api.post(`/orgs/${user.orgId}/compliance/baa`, v)));
      await load();
    } catch (err: any) { setSaveError(err?.message ?? 'Failed to seed defaults. Please try again.'); }
    finally { setSaving(false); }
  };

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/compliance" className="text-gray-400 hover:text-gray-600">
            <ChevronLeft size={18} />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-gray-900" style={{ fontFamily: 'var(--font-sora)' }}>
              BAA Registry
            </h1>
            <p className="text-xs text-gray-500">Business Associate Agreements with third-party vendors</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {entries.length === 0 && !loading && (
            <button
              onClick={seedDefaults}
              disabled={saving}
              className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600 disabled:opacity-50"
            >
              Seed defaults
            </button>
          )}
          <button
            onClick={openAdd}
            className="flex items-center gap-1.5 px-4 py-2 bg-[#0F4C81] text-white text-sm font-medium rounded-lg hover:bg-blue-900 transition-colors"
          >
            <Plus size={14} /> Add Vendor
          </button>
        </div>
      </div>

      {loadError && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          <span className="flex items-center gap-2"><AlertCircle size={14} />Failed to load BAA entries. Please try again.</span>
          <button onClick={load} className="text-red-600 font-medium hover:underline text-xs">Retry</button>
        </div>
      )}

      {confirmDeleteBaaId && (() => {
        const name = entries.find(e => e.id === confirmDeleteBaaId)?.vendorName ?? 'this entry';
        return (
          <div className="px-4 py-2.5 bg-amber-50 border border-amber-100 rounded-xl text-sm text-amber-800 flex items-center justify-between">
            <span>Delete <strong>{name}</strong> BAA entry? This cannot be undone.</span>
            <div className="flex items-center gap-2 ml-4 shrink-0">
              <button onClick={() => setConfirmDeleteBaaId(null)} className="text-xs text-gray-500 hover:text-gray-700">Cancel</button>
              <button onClick={remove} className="text-xs bg-red-500 text-white px-3 py-1 rounded-lg hover:bg-red-600">Delete</button>
            </div>
          </div>
        );
      })()}

      {deleteError && (
        <div className="px-4 py-2.5 bg-red-50 border border-red-100 rounded-xl text-sm text-red-600 flex items-center justify-between">
          {deleteError}
          <button onClick={() => setDeleteError('')} className="ml-2 text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      {/* Add/Edit form */}
      {showForm && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-800">{editId ? 'Edit Vendor' : 'Add Vendor'}</h2>
            <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600">
              <X size={16} />
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Vendor Name *</label>
              <input
                value={form.vendorName}
                onChange={e => setForm(f => ({ ...f, vendorName: e.target.value }))}
                placeholder="e.g. Twilio"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Service *</label>
              <input
                value={form.service}
                onChange={e => setForm(f => ({ ...f, service: e.target.value }))}
                placeholder="e.g. SMS / IVR"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">BAA Status</label>
              <select
                value={form.baaStatus}
                onChange={e => setForm(f => ({ ...f, baaStatus: e.target.value as BaaStatus }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
              >
                <option value="pending">Pending</option>
                <option value="signed">Signed</option>
                <option value="not_required">Not Required</option>
                <option value="expired">Expired</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Touches PHI</label>
              <select
                value={form.touchesPhi ? 'yes' : 'no'}
                onChange={e => setForm(f => ({ ...f, touchesPhi: e.target.value === 'yes' }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
              >
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Signed Date</label>
              <input
                type="date"
                value={form.signedAt}
                onChange={e => setForm(f => ({ ...f, signedAt: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Expiry Date</label>
              <input
                type="date"
                value={form.expiresAt}
                onChange={e => setForm(f => ({ ...f, expiresAt: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Document URL</label>
              <input
                value={form.documentUrl}
                onChange={e => setForm(f => ({ ...f, documentUrl: e.target.value }))}
                placeholder="https://..."
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
              <input
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Optional notes"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </div>
          </div>
          {saveError && <p className="text-red-500 text-xs mt-3">{saveError}</p>}
          <div className="flex items-center gap-2 mt-4">
            <button
              onClick={save}
              disabled={saving || !form.vendorName || !form.service}
              className="flex items-center gap-1.5 px-4 py-2 bg-[#0F4C81] text-white text-sm font-medium rounded-lg hover:bg-blue-900 disabled:opacity-50 transition-colors"
            >
              <Check size={14} /> {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={() => { setShowForm(false); setSaveError(''); }}
              className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm animate-pulse">Loading…</div>
        ) : entries.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-gray-400 text-sm mb-3">No BAA entries yet.</p>
            <p className="text-gray-400 text-xs">Click "Seed defaults" to add common vendors, or "Add Vendor" to add your own.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  {['Vendor', 'Service', 'Touches PHI', 'Status', 'Signed', 'Expires', 'Notes', ''].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {entries.map(e => (
                  <tr key={e.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{e.vendorName}</td>
                    <td className="px-4 py-3 text-gray-600">{e.service}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium ${e.touchesPhi ? 'text-amber-600' : 'text-gray-400'}`}>
                        {e.touchesPhi ? 'Yes' : 'No'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${STATUS_BADGE[e.baaStatus]}`}>
                        {STATUS_LABEL[e.baaStatus]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {e.signedAt ? new Date(e.signedAt).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {e.expiresAt ? (
                        <span className={new Date(e.expiresAt) < new Date() ? 'text-red-500' : 'text-gray-500'}>
                          {new Date(e.expiresAt).toLocaleDateString()}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs max-w-48 truncate">{e.notes ?? '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => openEdit(e)}
                          className="p-1.5 text-gray-400 hover:text-[#0F4C81] rounded hover:bg-blue-50 transition-colors"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={() => setConfirmDeleteBaaId(e.id)}
                          disabled={deletingId === e.id}
                          className="p-1.5 text-gray-400 hover:text-red-500 rounded hover:bg-red-50 transition-colors disabled:opacity-50"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
