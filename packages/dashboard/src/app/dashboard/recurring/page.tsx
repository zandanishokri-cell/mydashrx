'use client';
import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { RefreshCw, Plus, Trash2, Edit2, AlertCircle, Package, X, Check } from 'lucide-react';
import Link from 'next/link';

interface RecurringDelivery {
  id: string;
  recipientName: string;
  address: string;
  recipientPhone?: string;
  recipientEmail?: string;
  notes?: string;
  schedule: 'weekly' | 'biweekly' | 'monthly' | 'custom';
  dayOfWeek?: number;
  dayOfMonth?: number;
  nextDeliveryDate?: string;
  lastDeliveryDate?: string;
  rxNumber?: string;
  isControlled: boolean;
  enabled: boolean;
  depotId?: string;
  createdAt: string;
}

const SCHEDULE_BADGE: Record<string, { label: string; cls: string }> = {
  weekly: { label: 'Weekly', cls: 'bg-blue-50 text-blue-700' },
  biweekly: { label: 'Biweekly', cls: 'bg-purple-50 text-purple-700' },
  monthly: { label: 'Monthly', cls: 'bg-teal-50 text-teal-700' },
  custom: { label: 'Custom', cls: 'bg-gray-100 text-gray-600' },
};

const fmt = (d?: string) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const today = () => new Date().toISOString().split('T')[0];

interface FormState {
  recipientName: string; address: string; recipientPhone: string; recipientEmail: string;
  notes: string; schedule: 'weekly' | 'biweekly' | 'monthly' | 'custom';
  dayOfWeek: string; dayOfMonth: string; nextDeliveryDate: string;
  rxNumber: string; isControlled: boolean;
}

const emptyForm = (): FormState => ({
  recipientName: '', address: '', recipientPhone: '', recipientEmail: '',
  notes: '', schedule: 'weekly', dayOfWeek: '', dayOfMonth: '',
  nextDeliveryDate: today(), rxNumber: '', isControlled: false,
});

function PatientModal({ initial, onSave, onClose }: {
  initial?: RecurringDelivery;
  onSave: (data: FormState) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<FormState>(initial ? {
    recipientName: initial.recipientName,
    address: initial.address,
    recipientPhone: initial.recipientPhone ?? '',
    recipientEmail: initial.recipientEmail ?? '',
    notes: initial.notes ?? '',
    schedule: initial.schedule,
    dayOfWeek: initial.dayOfWeek?.toString() ?? '',
    dayOfMonth: initial.dayOfMonth?.toString() ?? '',
    nextDeliveryDate: initial.nextDeliveryDate ? initial.nextDeliveryDate.split('T')[0] : today(),
    rxNumber: initial.rxNumber ?? '',
    isControlled: initial.isControlled,
  } : emptyForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k: keyof FormState, v: string | boolean) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.recipientName.trim()) { setError('Patient name is required'); return; }
    if (!form.address.trim()) { setError('Address is required'); return; }
    setSaving(true);
    try { await onSave(form); } catch { setError('Save failed. Please try again.'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <h2 className="text-base font-semibold text-gray-900">{initial ? 'Edit Patient' : 'Add Recurring Patient'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X size={16} /></button>
        </div>

        <div className="overflow-y-auto flex-1 p-6 space-y-4">
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Patient Name *</label>
              <input value={form.recipientName} onChange={e => set('recipientName', e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-100" placeholder="Last, First" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Address *</label>
              <input value={form.address} onChange={e => set('address', e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-100" placeholder="123 Main St, Detroit, MI 48201" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
              <input value={form.recipientPhone} onChange={e => set('recipientPhone', e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-100" placeholder="313-555-0100" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
              <input value={form.recipientEmail} onChange={e => set('recipientEmail', e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-100" placeholder="patient@email.com" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Rx Number</label>
              <input value={form.rxNumber} onChange={e => set('rxNumber', e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-100" placeholder="RX-001" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Schedule</label>
              <select value={form.schedule} onChange={e => set('schedule', e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-100 bg-white">
                <option value="weekly">Weekly</option>
                <option value="biweekly">Biweekly</option>
                <option value="monthly">Monthly</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Next Delivery Date</label>
              <input type="date" value={form.nextDeliveryDate} onChange={e => set('nextDeliveryDate', e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-100" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Delivery Notes</label>
              <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-100 resize-none" placeholder="Ring doorbell, leave at door…" />
            </div>
            <div className="col-span-2 flex items-center gap-2">
              <input type="checkbox" id="isControlled" checked={form.isControlled} onChange={e => set('isControlled', e.target.checked)}
                className="rounded border-gray-300" />
              <label htmlFor="isControlled" className="text-sm text-gray-700">Controlled substance</label>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-100 shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 rounded-lg transition-colors">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-[#0F4C81] text-white rounded-lg hover:bg-[#0a3860] disabled:opacity-50 transition-colors">
            {saving ? <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Check size={13} />}
            {saving ? 'Saving…' : 'Save Patient'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function RecurringPage() {
  const [user] = useState(getUser);
  const [items, setItems] = useState<RecurringDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<RecurringDelivery | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genToast, setGenToast] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const data = await api.get<RecurringDelivery[]>(`/orgs/${user.orgId}/recurring`);
      setItems(data);
    } catch { setItems([]); }
    finally { setLoading(false); }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (form: FormState) => {
    if (!user) return;
    const payload = {
      recipientName: form.recipientName,
      address: form.address,
      recipientPhone: form.recipientPhone || undefined,
      recipientEmail: form.recipientEmail || undefined,
      notes: form.notes || undefined,
      schedule: form.schedule,
      dayOfWeek: form.dayOfWeek ? parseInt(form.dayOfWeek) : undefined,
      dayOfMonth: form.dayOfMonth ? parseInt(form.dayOfMonth) : undefined,
      nextDeliveryDate: form.nextDeliveryDate || undefined,
      rxNumber: form.rxNumber || undefined,
      isControlled: form.isControlled,
    };

    if (editing) {
      await api.patch(`/orgs/${user.orgId}/recurring/${editing.id}`, payload);
    } else {
      await api.post(`/orgs/${user.orgId}/recurring`, payload);
    }
    setModalOpen(false);
    setEditing(null);
    load();
  };

  const toggleEnabled = async (item: RecurringDelivery) => {
    if (!user) return;
    await api.patch(`/orgs/${user.orgId}/recurring/${item.id}`, { enabled: !item.enabled });
    load();
  };

  const handleDelete = async (id: string) => {
    if (!user) return;
    await api.del(`/orgs/${user.orgId}/recurring/${id}`);
    setDeleteConfirm(null);
    load();
  };

  const generateToday = async () => {
    if (!user) return;
    setGenerating(true);
    try {
      const res = await api.post<{ generated: number }>(`/orgs/${user.orgId}/recurring/generate`, { date: today() });
      setGenToast(res.generated > 0
        ? `${res.generated} stop${res.generated !== 1 ? 's' : ''} generated for today`
        : 'No deliveries due today');
      setTimeout(() => setGenToast(''), 3500);
      if (res.generated > 0) load();
    } catch { setGenToast('Failed to generate stops'); setTimeout(() => setGenToast(''), 3000); }
    finally { setGenerating(false); }
  };

  return (
    <div className="p-6">
      {/* Toast */}
      {genToast && (
        <div className="fixed bottom-4 right-4 z-50 bg-gray-900 text-white text-sm px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-2">
          <RefreshCw size={13} className="text-[#00B8A9]" /> {genToast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900" style={{ fontFamily: 'var(--font-sora)' }}>Recurring Deliveries</h1>
          <p className="text-sm text-gray-500 mt-0.5">Refill patients with automatic delivery schedules</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={generateToday}
            disabled={generating}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            <RefreshCw size={13} className={generating ? 'animate-spin' : ''} />
            {generating ? 'Generating…' : "Generate Today's Stops"}
          </button>
          <button
            onClick={() => { setEditing(null); setModalOpen(true); }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-[#0F4C81] text-white rounded-lg hover:bg-[#0a3860] transition-colors"
          >
            <Plus size={13} /> Add Patient
          </button>
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-24 bg-white rounded-xl border border-gray-100 animate-pulse" />)}
        </div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
          <RefreshCw size={32} className="text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500 font-medium text-sm mb-1">No recurring patients yet</p>
          <p className="text-gray-400 text-xs mb-4">Add refill patients to auto-generate their stops each cycle.</p>
          <div className="flex items-center justify-center gap-3">
            <button onClick={() => setModalOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2 text-sm bg-[#0F4C81] text-white rounded-lg hover:bg-[#0a3860] transition-colors">
              <Plus size={13} /> Add Patient
            </button>
            <Link href="/dashboard/stops" className="text-sm text-[#0F4C81] hover:underline">
              Or import from CSV →
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid gap-3">
          {items.map(item => {
            const badge = SCHEDULE_BADGE[item.schedule] ?? SCHEDULE_BADGE.custom;
            return (
              <div key={item.id} className={`bg-white rounded-xl border transition-all ${item.enabled ? 'border-gray-100 hover:shadow-sm' : 'border-gray-100 opacity-60'}`}>
                <div className="p-4 flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-semibold text-gray-900 text-sm">{item.recipientName}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.cls}`}>{badge.label}</span>
                      {item.isControlled && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 font-medium flex items-center gap-1">
                          <AlertCircle size={10} /> Controlled
                        </span>
                      )}
                      {item.rxNumber && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 flex items-center gap-1">
                          <Package size={10} /> {item.rxNumber}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 truncate">{item.address}</p>
                    <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                      <span>Next: <span className="text-gray-600 font-medium">{fmt(item.nextDeliveryDate)}</span></span>
                      {item.lastDeliveryDate && <span>Last: {fmt(item.lastDeliveryDate)}</span>}
                      {item.recipientPhone && <span>{item.recipientPhone}</span>}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {/* Enable/disable toggle */}
                    <button
                      onClick={() => toggleEnabled(item)}
                      title={item.enabled ? 'Disable' : 'Enable'}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${item.enabled ? 'bg-[#0F4C81]' : 'bg-gray-200'}`}
                    >
                      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${item.enabled ? 'translate-x-[18px]' : 'translate-x-[2px]'}`} />
                    </button>
                    <button
                      onClick={() => { setEditing(item); setModalOpen(true); }}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                    >
                      <Edit2 size={13} />
                    </button>
                    <button
                      onClick={() => setDeleteConfirm(item.id)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Patient modal */}
      {modalOpen && (
        <PatientModal
          initial={editing ?? undefined}
          onSave={handleSave}
          onClose={() => { setModalOpen(false); setEditing(null); }}
        />
      )}

      {/* Delete confirm */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm text-center">
            <Trash2 size={28} className="text-red-400 mx-auto mb-3" />
            <p className="text-sm font-semibold text-gray-900 mb-1">Remove patient?</p>
            <p className="text-xs text-gray-500 mb-4">This will stop future deliveries from being generated.</p>
            <div className="flex gap-2 justify-center">
              <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={() => handleDelete(deleteConfirm)} className="px-4 py-2 text-sm bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors">Remove</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
