'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { X, AlertCircle } from 'lucide-react';
import { AddressAutocomplete } from './AddressAutocomplete';

interface Props {
  orgId: string;
  onClose: () => void;
  onSuccess: () => void;
}

interface FormState {
  recipientName: string;
  recipientPhone: string;
  recipientEmail: string;
  address: string;
  unit: string;
  rxNumbers: string;
  packageCount: string;
  windowStart: string;
  windowEnd: string;
  deliveryNotes: string;
  requiresRefrigeration: boolean;
  controlledSubstance: boolean;
  requiresSignature: boolean;
  requiresAgeVerification: boolean;
  requiresPhoto: boolean;
  priority: string;
}

const DEFAULTS: FormState = {
  recipientName: '', recipientPhone: '', recipientEmail: '', address: '', unit: '',
  rxNumbers: '', packageCount: '1', windowStart: '', windowEnd: '',
  deliveryNotes: '', requiresRefrigeration: false, controlledSubstance: false,
  requiresSignature: true, requiresAgeVerification: false, requiresPhoto: false,
  priority: 'normal',
};

export function NewStopModal({ orgId, onClose, onSuccess }: Props) {
  const [form, setForm] = useState<FormState>(DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showUpgradeCta, setShowUpgradeCta] = useState(false);

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.recipientName.trim()) { setError('Recipient name is required'); return; }
    if (!form.address.trim()) { setError('Address is required'); return; }
    setSaving(true); setError(''); setShowUpgradeCta(false);
    try {
      await api.post(`/orgs/${orgId}/stops`, {
        recipientName: form.recipientName.trim(),
        recipientPhone: form.recipientPhone.trim() || undefined,
        recipientEmail: form.recipientEmail.trim() || undefined,
        address: form.address.trim(),
        unit: form.unit.trim() || undefined,
        rxNumbers: form.rxNumbers ? form.rxNumbers.split(',').map(s => s.trim()).filter(Boolean) : [],
        packageCount: Math.max(1, parseInt(form.packageCount) || 1),
        windowStart: form.windowStart || undefined,
        windowEnd: form.windowEnd || undefined,
        deliveryNotes: form.deliveryNotes.trim() || undefined,
        requiresRefrigeration: form.requiresRefrigeration,
        controlledSubstance: form.controlledSubstance,
        requiresSignature: form.requiresSignature,
        requiresAgeVerification: form.requiresAgeVerification,
        requiresPhoto: form.requiresPhoto,
        priority: form.priority,
      });
      onSuccess();
    } catch (e: unknown) {
      const isLimit = e instanceof Error && e.message.includes('402');
      setError(isLimit ? 'Monthly stop limit reached for your plan.' : 'Failed to create stop. Please try again.');
      setShowUpgradeCta(isLimit);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <h2 className="text-base font-semibold text-gray-900">New Stop</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="overflow-y-auto flex-1">
          <div className="p-6 space-y-4">
            {/* Required fields */}
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-500 mb-1">Recipient Name <span className="text-red-400">*</span></label>
                <input
                  value={form.recipientName} onChange={set('recipientName')}
                  placeholder="Jane Smith"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F4C81]/20"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Phone</label>
                <input
                  type="tel" value={form.recipientPhone} onChange={set('recipientPhone')}
                  placeholder="313-555-0100"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F4C81]/20"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Email</label>
                <input
                  type="email" value={form.recipientEmail} onChange={set('recipientEmail')}
                  placeholder="patient@example.com"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F4C81]/20"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Packages</label>
                <input
                  type="number" min="1" value={form.packageCount} onChange={set('packageCount')}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F4C81]/20"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-500 mb-1">Address <span className="text-red-400">*</span></label>
                <AddressAutocomplete
                  value={form.address}
                  onChange={v => setForm(f => ({ ...f, address: v }))}
                  placeholder="Start typing — 123 Main St…"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F4C81]/20"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Unit / Apt</label>
                <input
                  value={form.unit} onChange={set('unit')}
                  placeholder="4B"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F4C81]/20"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Rx Numbers</label>
                <input
                  value={form.rxNumbers} onChange={set('rxNumbers')}
                  placeholder="RX-001, RX-002"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F4C81]/20"
                />
              </div>
            </div>

            {/* Delivery window */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Window Start</label>
                <input
                  type="datetime-local" value={form.windowStart} onChange={set('windowStart')}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F4C81]/20"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Window End</label>
                <input
                  type="datetime-local" value={form.windowEnd} onChange={set('windowEnd')}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F4C81]/20"
                />
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Delivery Notes</label>
              <textarea
                value={form.deliveryNotes} onChange={set('deliveryNotes')}
                rows={2} placeholder="Ring doorbell, leave at door, etc."
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#0F4C81]/20"
              />
            </div>

            {/* Priority */}
            <div>
              <label htmlFor="stop-priority" className="block text-xs font-medium text-gray-600 mb-1">Priority</label>
              <select
                id="stop-priority"
                value={form.priority}
                onChange={e => setForm(p => ({ ...p, priority: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F4C81]/30 focus:border-[#0F4C81]"
              >
                <option value="normal">Normal</option>
                <option value="high">High — time-sensitive</option>
                <option value="urgent">Urgent — deliver ASAP</option>
              </select>
            </div>

            {/* Flags */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-gray-500">Special Requirements</p>
              {([
                ['requiresRefrigeration', 'Requires refrigeration'],
                ['controlledSubstance', 'Controlled substance'],
                ['requiresSignature', 'Signature required'],
                ['requiresAgeVerification', 'Age verification (18+)'],
                ['requiresPhoto', 'Delivery photo required'],
              ] as [keyof FormState, string][]).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={form[key] as boolean}
                    onChange={set(key)}
                    className="w-4 h-4 rounded border-gray-300 text-[#0F4C81] focus:ring-[#0F4C81]/20"
                  />
                  <span className="text-sm text-gray-700 group-hover:text-gray-900">{label}</span>
                </label>
              ))}
            </div>

            {error && (
              <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                <AlertCircle size={14} className="text-red-500 shrink-0" />
                <div>
                  <p className="text-sm text-red-700">{error}</p>
                  {showUpgradeCta && (
                    <a href="/dashboard/billing" className="text-xs text-amber-600 font-medium hover:underline">
                      Upgrade your plan to add more stops →
                    </a>
                  )}
                </div>
              </div>
            )}
          </div>
        </form>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-100 shrink-0">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 rounded-lg transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-[#0F4C81] text-white rounded-lg hover:bg-[#0a3860] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? (
              <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Creating…</>
            ) : 'Create Stop'}
          </button>
        </div>
      </div>
    </div>
  );
}
