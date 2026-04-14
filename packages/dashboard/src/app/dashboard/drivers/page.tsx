'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { FormField, SelectField } from '@/components/ui/FormField';
import { Truck, Plus } from 'lucide-react';
import type { Driver } from '@mydash-rx/shared';

export default function DriversPage() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const user = getUser();

  const load = () => {
    if (!user) return;
    api.get<Driver[]>(`/orgs/${user.orgId}/drivers`)
      .then(setDrivers)
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900" style={{ fontFamily: 'var(--font-sora)' }}>Drivers</h1>
        <Button size="sm" onClick={() => setShowAdd(true)}>
          <Plus size={14} /> Add Driver
        </Button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-16 bg-white rounded-xl border border-gray-100 animate-pulse" />)}
        </div>
      ) : drivers.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center">
          <Truck size={32} className="text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 text-sm mb-3">No drivers added yet.</p>
          <Button size="sm" onClick={() => setShowAdd(true)}><Plus size={14} /> Add Driver</Button>
        </div>
      ) : (
        <div className="space-y-2">
          {drivers.map((driver) => (
            <div key={driver.id} className="flex items-center justify-between bg-white rounded-xl border border-gray-100 px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-blue-50 flex items-center justify-center text-[#0F4C81] font-semibold text-sm">
                  {driver.name[0]}
                </div>
                <div>
                  <div className="text-sm font-medium text-gray-900">{driver.name}</div>
                  <div className="text-xs text-gray-400">{driver.vehicleType} · {driver.phone}</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {driver.drugCapable && (
                  <span className="text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full">Rx Capable</span>
                )}
                <Badge status={driver.status} />
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <AddDriverModal
          orgId={user!.orgId}
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); load(); }}
        />
      )}
    </div>
  );
}

function AddDriverModal({ orgId, onClose, onSaved }: { orgId: string; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: '', email: '', phone: '', password: '',
    vehicleType: 'car' as 'car' | 'van' | 'bicycle',
    drugCapable: false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.post(`/orgs/${orgId}/drivers`, form);
      onSaved();
    } catch (err: any) {
      setError(err.message ?? 'Failed to add driver');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Add Driver" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <FormField label="Full Name" value={form.name} onChange={(e) => set('name', e.target.value)} required placeholder="Maria Rodriguez" />
        <FormField label="Email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} required placeholder="maria@pharmacy.com" />
        <FormField label="Phone" value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+1 313 555 0101" />
        <FormField label="Password" type="password" value={form.password} onChange={(e) => set('password', e.target.value)} required placeholder="Temporary password" />
        <SelectField label="Vehicle Type" value={form.vehicleType} onChange={(e) => set('vehicleType', e.target.value)}>
          <option value="car">Car</option>
          <option value="van">Van</option>
          <option value="bicycle">Bicycle</option>
        </SelectField>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={form.drugCapable} onChange={(e) => set('drugCapable', e.target.checked)} className="rounded border-gray-300" />
          <span className="text-sm text-gray-700">Rx / Drug Capable</span>
        </label>
        {error && <p className="text-red-500 text-sm">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" size="sm" type="button" onClick={onClose}>Cancel</Button>
          <Button size="sm" type="submit" loading={saving}>Add Driver</Button>
        </div>
      </form>
    </Modal>
  );
}
