'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { CheckCircle2, Package, Loader2 } from 'lucide-react';

async function geocode(address: string): Promise<{ lat: number; lng: number }> {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?${new URLSearchParams({ q: address, format: 'json', limit: '1' })}`,
    { headers: { 'User-Agent': 'MyDashRx/1.0' } },
  );
  const data = await res.json() as Array<{ lat: string; lon: string }>;
  if (!data.length) throw new Error(`Could not find address: "${address}"`);
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
}

const inputCls = 'w-full border border-gray-200 rounded-xl px-4 py-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 transition-colors bg-white';
const labelCls = 'block text-xs font-semibold text-gray-600 mb-1.5';

export default function PharmacySubmitPage() {
  const [form, setForm] = useState({
    recipientName: '', recipientPhone: '', address: '',
    rxNumbers: '', packageCount: '1', deliveryNotes: '',
    requiresRefrigeration: false, controlledSubstance: false,
    requiresSignature: true, codAmount: '', deliveryDate: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [lastOrder, setLastOrder] = useState<{ recipientName: string; address: string; planDate: string } | null>(null);

  const set = (k: string, v: string | boolean) => setForm(f => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const coords = await geocode(form.address);
      const order = await api.post<any>('/pharmacy/orders', {
        recipientName: form.recipientName,
        recipientPhone: form.recipientPhone,
        address: form.address,
        lat: coords.lat,
        lng: coords.lng,
        rxNumbers: form.rxNumbers ? form.rxNumbers.split(',').map(s => s.trim()).filter(Boolean) : [],
        packageCount: parseInt(form.packageCount) || 1,
        requiresRefrigeration: form.requiresRefrigeration,
        controlledSubstance: form.controlledSubstance,
        requiresSignature: form.requiresSignature,
        codAmount: form.codAmount ? parseFloat(form.codAmount) : undefined,
        deliveryNotes: form.deliveryNotes || undefined,
        deliveryDate: form.deliveryDate || undefined,
      });
      setLastOrder({ recipientName: form.recipientName, address: form.address, planDate: order.planDate });
      setSuccess(true);
      setForm({ recipientName: '', recipientPhone: '', address: '', rxNumbers: '', packageCount: '1', deliveryNotes: '', requiresRefrigeration: false, controlledSubstance: false, requiresSignature: true, codAmount: '', deliveryDate: '' });
    } catch (err: any) {
      setError(err?.message ?? 'Failed to submit order');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 md:p-5">
      {/* Page header */}
      <div className="flex items-center gap-3 mb-5">
        <div className="w-11 h-11 bg-blue-50 rounded-2xl flex items-center justify-center shrink-0">
          <Package size={20} className="text-[#0F4C81]" />
        </div>
        <div>
          <h1 className="font-bold text-gray-900 text-base" style={{ fontFamily: 'var(--font-sora)' }}>Submit Delivery Order</h1>
          <p className="text-xs text-gray-400 mt-0.5">Your dispatcher will assign it to a driver</p>
        </div>
      </div>

      {/* Success state */}
      {success && lastOrder && (
        <div className="bg-green-50 border border-green-200 rounded-2xl p-5 mb-5 flex items-start gap-3">
          <CheckCircle2 size={22} className="text-green-500 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-bold text-green-800">Order submitted!</p>
            <p className="text-sm text-green-600 mt-0.5">{lastOrder.recipientName} · {lastOrder.address}</p>
            <p className="text-xs text-green-500 mt-1">Scheduled for {lastOrder.planDate}</p>
            <button
              onClick={() => setSuccess(false)}
              className="mt-3 text-xs font-semibold text-green-700 bg-green-100 hover:bg-green-200 px-3 py-1.5 rounded-lg transition-colors"
            >
              Submit another order
            </button>
          </div>
        </div>
      )}

      {!success && (
        <form onSubmit={submit} className="space-y-4">
          {/* Patient info */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 space-y-3.5">
            <h2 className="text-sm font-bold text-gray-800">Patient Info</h2>
            <div>
              <label htmlFor="rx-patient-name" className={labelCls}>Patient Name <span className="text-red-400">*</span></label>
              <input id="rx-patient-name" autoComplete="name" value={form.recipientName} onChange={e => set('recipientName', e.target.value)} required
                className={inputCls} placeholder="Jane Smith" />
            </div>
            <div>
              <label htmlFor="rx-phone" className={labelCls}>Phone Number</label>
              <input id="rx-phone" type="tel" autoComplete="tel" value={form.recipientPhone} onChange={e => set('recipientPhone', e.target.value)}
                className={inputCls} placeholder="+1 313 555 0100" inputMode="tel" />
            </div>
            <div>
              <label htmlFor="rx-address" className={labelCls}>Delivery Address <span className="text-red-400">*</span></label>
              <input id="rx-address" autoComplete="street-address" value={form.address} onChange={e => set('address', e.target.value)} required
                className={inputCls} placeholder="123 Main St, Detroit, MI 48201" />
            </div>
          </div>

          {/* Order details */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 space-y-3.5">
            <h2 className="text-sm font-bold text-gray-800">Order Details</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="rx-numbers" className={labelCls}>Rx Numbers</label>
                <input id="rx-numbers" value={form.rxNumbers} onChange={e => set('rxNumbers', e.target.value)}
                  className={inputCls} placeholder="RX001, RX002" />
              </div>
              <div>
                <label className={labelCls}>Packages</label>
                <input type="number" min="1" value={form.packageCount} onChange={e => set('packageCount', e.target.value)}
                  className={inputCls} inputMode="numeric" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>COD Amount ($)</label>
                <input type="number" step="0.01" value={form.codAmount} onChange={e => set('codAmount', e.target.value)}
                  className={inputCls} placeholder="0.00" inputMode="decimal" />
              </div>
              <div>
                <label className={labelCls}>Delivery Date</label>
                <input type="date" value={form.deliveryDate} onChange={e => set('deliveryDate', e.target.value)}
                  className={inputCls} />
              </div>
            </div>
            <div>
              <label className={labelCls}>Delivery Notes</label>
              <input value={form.deliveryNotes} onChange={e => set('deliveryNotes', e.target.value)}
                className={inputCls} placeholder="Leave at back door, call on arrival…" />
            </div>
          </div>

          {/* Special handling — large tappable checkboxes */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
            <h2 className="text-sm font-bold text-gray-800 mb-3.5">Special Handling</h2>
            <div className="space-y-2">
              {[
                { key: 'requiresRefrigeration', label: 'Requires Refrigeration', sub: 'Cold chain packaging required' },
                { key: 'controlledSubstance', label: 'Controlled Substance', sub: 'Extra security handling' },
                { key: 'requiresSignature', label: 'Requires Signature', sub: 'Patient or authorized person must sign' },
              ].map(({ key, label, sub }) => (
                <label key={key} className="flex items-center gap-3.5 p-3 rounded-xl hover:bg-gray-50 cursor-pointer transition-colors">
                  <input
                    type="checkbox"
                    checked={form[key as keyof typeof form] as boolean}
                    onChange={e => set(key, e.target.checked)}
                    className="w-5 h-5 rounded-md text-[#0F4C81] focus:ring-blue-200 shrink-0"
                  />
                  <div>
                    <p className="text-sm font-medium text-gray-800">{label}</p>
                    <p className="text-xs text-gray-400">{sub}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {error && <div className="bg-red-50 border border-red-100 text-red-600 rounded-xl px-4 py-3 text-sm">{error}</div>}

          {/* Large submit button — easy tap target */}
          <button
            type="submit"
            disabled={saving}
            className="w-full bg-[#0F4C81] text-white py-4 rounded-2xl font-bold text-base disabled:opacity-60 hover:bg-[#0d3d69] transition-colors flex items-center justify-center gap-2 shadow-md shadow-blue-900/20"
          >
            {saving ? (
              <><Loader2 size={18} className="animate-spin" /> Geocoding &amp; Submitting…</>
            ) : (
              'Submit Delivery Order'
            )}
          </button>
        </form>
      )}
    </div>
  );
}
