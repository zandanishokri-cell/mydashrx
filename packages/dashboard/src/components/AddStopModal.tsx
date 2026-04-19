'use client';
import { useState, useRef } from 'react';
import { api } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { FormField, CheckboxField } from '@/components/ui/FormField';
import { Upload, Plus } from 'lucide-react';
import Papa from 'papaparse';

interface Props {
  routeId: string;
  orgId: string;
  onClose: () => void;
  onSaved: () => void;
}

interface StopBody {
  orgId: string;
  recipientName: string;
  recipientPhone: string;
  address: string;
  lat: number;
  lng: number;
  rxNumbers?: string[];
  packageCount?: number;
  requiresRefrigeration?: boolean;
  controlledSubstance?: boolean;
  requiresSignature?: boolean;
  deliveryNotes?: string;
}

// P-ROUTE2: exponential backoff retry — handles transient 'Failed to fetch' on stop creation
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  let delay = 200;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const isTransient = err.message?.includes('Failed to fetch') || err.message?.includes('network') || err.message?.includes('fetch');
      if (attempt === maxRetries || !isTransient) throw err;
      await new Promise(r => setTimeout(r, delay + Math.random() * 100));
      delay *= 2; // 200ms → 400ms → 800ms
    }
  }
  throw new Error('Max retries exceeded');
}

// Geocode an address using Nominatim (OpenStreetMap) — free, no key
async function geocode(address: string): Promise<{ lat: number; lng: number }> {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?` +
      new URLSearchParams({ q: address, format: 'json', limit: '1' }),
    { headers: { 'User-Agent': 'MyDashRx/1.0' } },
  );
  const data = (await res.json()) as Array<{ lat: string; lon: string }>;
  if (!data.length) throw new Error(`Could not geocode: "${address}"`);
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
}

export function AddStopModal({ routeId, orgId, onClose, onSaved }: Props) {
  const [tab, setTab] = useState<'manual' | 'csv'>('manual');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [csvProgress, setCsvProgress] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // Manual form state
  const [form, setForm] = useState({
    recipientName: '', recipientPhone: '', address: '',
    rxNumbers: '', packageCount: '1', deliveryNotes: '',
    requiresRefrigeration: false, controlledSubstance: false, requiresSignature: true,
  });

  const set = (key: string, val: string | boolean) =>
    setForm((f) => ({ ...f, [key]: val }));

  const submitManual = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      let coords: { lat: number; lng: number };
      try {
        coords = await geocode(form.address);
      } catch {
        throw new Error('Could not geocode address — check the address and try again, or use a more specific address.');
      }
      const body: StopBody = {
        orgId,
        recipientName: form.recipientName,
        recipientPhone: form.recipientPhone,
        address: form.address,
        lat: coords.lat,
        lng: coords.lng,
        rxNumbers: form.rxNumbers ? form.rxNumbers.split(',').map((s) => s.trim()).filter(Boolean) : [],
        packageCount: parseInt(form.packageCount) || 1,
        requiresRefrigeration: form.requiresRefrigeration,
        controlledSubstance: form.controlledSubstance,
        requiresSignature: form.requiresSignature,
        deliveryNotes: form.deliveryNotes || undefined,
      };
      // P-ROUTE2: retry up to 3× with backoff — recovers from Render cold-start / transient network
      await withRetry(() => api.post(`/routes/${routeId}/stops`, body));
      onSaved();
    } catch (err: any) {
      setError(err.message ?? 'Failed to add stop. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleCsvUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSaving(true);
    setError('');

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        const rows = results.data;
        let success = 0;
        const errors: string[] = [];

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const address = row['address'] || row['Address'] || row['delivery_address'] || '';
          const name = row['recipient_name'] || row['name'] || row['Name'] || row['recipientName'] || '';

          if (!address || !name) {
            errors.push(`Row ${i + 2}: missing name or address`);
            continue;
          }

          setCsvProgress(`Geocoding ${i + 1}/${rows.length}: ${name}…`);

          try {
            const coords = await geocode(address);
            // Rate-limit Nominatim to 1 req/sec
            await new Promise((r) => setTimeout(r, 1000));

            const body: StopBody = {
              orgId,
              recipientName: name,
              recipientPhone: row['phone'] || row['Phone'] || row['recipient_phone'] || '',
              address,
              lat: coords.lat,
              lng: coords.lng,
              rxNumbers: (row['rx_numbers'] || row['rxNumbers'] || '')
                .split(',').map((s) => s.trim()).filter(Boolean),
              packageCount: parseInt(row['package_count'] || row['packageCount'] || '1') || 1,
              requiresRefrigeration: ['true', '1', 'yes'].includes(
                (row['requires_refrigeration'] || row['refrigeration'] || '').toLowerCase(),
              ),
              controlledSubstance: ['true', '1', 'yes'].includes(
                (row['controlled_substance'] || row['controlled'] || '').toLowerCase(),
              ),
              requiresSignature: !['false', '0', 'no'].includes(
                (row['requires_signature'] || 'true').toLowerCase(),
              ),
              deliveryNotes: row['notes'] || row['delivery_notes'] || undefined,
            };
            await withRetry(() => api.post(`/routes/${routeId}/stops`, body));
            success++;
          } catch (err: any) {
            errors.push(`Row ${i + 2} (${name}): ${err.message}`);
          }
        }

        setCsvProgress('');
        setSaving(false);

        if (errors.length > 0) {
          setError(`${success} stops added. ${errors.length} failed:\n${errors.slice(0, 5).join('\n')}${errors.length > 5 ? `\n…and ${errors.length - 5} more` : ''}`);
          if (success > 0) onSaved();
        } else {
          onSaved();
        }
      },
      error: (err) => {
        setError(`CSV parse error: ${err.message}`);
        setSaving(false);
      },
    });
  };

  return (
    <Modal title="Add Stop" onClose={onClose} width="max-w-xl">
      {/* Tabs */}
      <div className="flex gap-1 mb-5 bg-gray-100 p-1 rounded-lg">
        {(['manual', 'csv'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            {t === 'manual' ? 'Manual Entry' : 'CSV Import'}
          </button>
        ))}
      </div>

      {tab === 'manual' ? (
        <form onSubmit={submitManual} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Patient Name" value={form.recipientName} onChange={(e) => set('recipientName', e.target.value)} required placeholder="Jane Smith" />
            <FormField label="Phone" value={form.recipientPhone} onChange={(e) => set('recipientPhone', e.target.value)} placeholder="+1 313 555 0100" />
          </div>
          <FormField label="Delivery Address" value={form.address} onChange={(e) => set('address', e.target.value)} required placeholder="123 Main St, Detroit, MI 48201" />
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Rx Numbers (comma-separated)" value={form.rxNumbers} onChange={(e) => set('rxNumbers', e.target.value)} placeholder="RX001, RX002" />
            <FormField label="Package Count" type="number" min="1" value={form.packageCount} onChange={(e) => set('packageCount', e.target.value)} />
          </div>
          <FormField label="Delivery Notes" value={form.deliveryNotes} onChange={(e) => set('deliveryNotes', e.target.value)} placeholder="Leave at back door, call on arrival…" />
          <div className="flex flex-wrap gap-4 pt-1">
            <CheckboxField label="Requires Refrigeration" checked={form.requiresRefrigeration} onChange={(e) => set('requiresRefrigeration', e.target.checked)} />
            <CheckboxField label="Controlled Substance" checked={form.controlledSubstance} onChange={(e) => set('controlledSubstance', e.target.checked)} />
            <CheckboxField label="Requires Signature" checked={form.requiresSignature} onChange={(e) => set('requiresSignature', e.target.checked)} />
          </div>
          {error && <p className="text-red-500 text-sm whitespace-pre-line">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" size="sm" type="button" onClick={onClose}>Cancel</Button>
            <Button size="sm" type="submit" loading={saving}>
              <Plus size={14} /> Add Stop
            </Button>
          </div>
        </form>
      ) : (
        <div className="space-y-4">
          <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-600">
            <p className="font-medium mb-2">Expected CSV columns:</p>
            <code className="text-xs text-gray-500 block">
              recipient_name, address, phone, rx_numbers, package_count,<br />
              requires_refrigeration, controlled_substance, requires_signature, notes
            </code>
          </div>
          {csvProgress && (
            <div className="bg-blue-50 text-blue-700 rounded-lg px-4 py-2 text-sm">{csvProgress}</div>
          )}
          {error && <p className="text-red-500 text-sm whitespace-pre-line">{error}</p>}
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleCsvUpload} />
          <Button
            onClick={() => fileRef.current?.click()}
            loading={saving}
            className="w-full justify-center"
          >
            <Upload size={14} /> Choose CSV File
          </Button>
        </div>
      )}
    </Modal>
  );
}
