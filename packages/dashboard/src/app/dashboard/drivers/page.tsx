'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { FormField, SelectField } from '@/components/ui/FormField';
import { Truck, Plus, Search, Pencil, Trash2, Download, Users } from 'lucide-react';

interface Driver {
  id: string; orgId: string; name: string; email: string; phone: string;
  drugCapable: boolean; vehicleType: string; status: string;
  currentLat: number | null; currentLng: number | null; lastPingAt: string | null;
  totalStops: number;
}

interface DriverPerf { completionRate: number; summary: { totalStops: number } }

const STATUS_DOT: Record<string, string> = {
  available: 'bg-emerald-500',
  on_route: 'bg-blue-500',
  offline: 'bg-gray-400',
};

export default function DriversPage() {
  const router = useRouter();
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [filtered, setFiltered] = useState<Driver[]>([]);
  const [perfMap, setPerfMap] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editDriver, setEditDriver] = useState<Driver | null>(null);
  const [search, setSearch] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [user] = useState(getUser);

  const load = useCallback(() => {
    if (!user) return;
    api.get<Driver[]>(`/orgs/${user.orgId}/drivers`)
      .then(data => {
        setDrivers(data);
        setFiltered(data);
        // Fetch completion rates for all drivers in parallel
        Promise.allSettled(
          data.map(d =>
            api.get<DriverPerf>(`/orgs/${user.orgId}/drivers/${d.id}/performance`)
              .then(p => ({ id: d.id, rate: p.summary.totalStops > 0 ? p.completionRate : -1 }))
          )
        ).then(results => {
          const map: Record<string, number> = {};
          for (const r of results) {
            if (r.status === 'fulfilled') map[r.value.id] = r.value.rate;
          }
          setPerfMap(map);
        });
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [user]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!search) { setFiltered(drivers); return; }
    const q = search.toLowerCase();
    setFiltered(drivers.filter(d =>
      d.name.toLowerCase().includes(q) ||
      d.email.toLowerCase().includes(q) ||
      d.phone.includes(q)
    ));
  }, [search, drivers]);

  const requestDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDeleteId(id);
  };

  const confirmDelete = async () => {
    if (!confirmDeleteId || !user) return;
    const id = confirmDeleteId;
    setConfirmDeleteId(null);
    try {
      await api.del(`/orgs/${user.orgId}/drivers/${id}`);
      setDeleteError('');
      load();
    } catch { setDeleteError('Failed to remove driver. Try again.'); }
  };

  const openEdit = (driver: Driver, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditDriver(driver);
  };

  const exportCsv = () => {
    const rows = drivers.map(d => [d.name, d.email, d.phone, d.vehicleType, d.status, d.totalStops, d.drugCapable ? 'Yes' : 'No']);
    const csv = [['Name', 'Email', 'Phone', 'Vehicle', 'Status', 'Total Stops', 'Rx Capable'], ...rows].map(r => r.join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'drivers.csv';
    a.click();
  };

  const lastSeen = (d: Driver) => {
    if (!d.lastPingAt) return null;
    const mins = Math.floor((Date.now() - new Date(d.lastPingAt).getTime()) / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return new Date(d.lastPingAt).toLocaleDateString();
  };

  const completionDisplay = (id: string) => {
    const r = perfMap[id];
    if (r === undefined) return <span className="text-gray-300 text-xs">…</span>;
    if (r === -1) return <span className="text-gray-400 text-xs">—</span>;
    const color = r >= 95 ? 'text-emerald-600' : r >= 80 ? 'text-amber-600' : 'text-red-500';
    return <span className={`font-semibold ${color}`}>{r}%</span>;
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900" style={{ fontFamily: 'var(--font-sora)' }}>Drivers</h1>
          <p className="text-xs text-gray-400 mt-0.5">{drivers.length} drivers total</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportCsv} className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
            <Download size={14} /> Export
          </button>
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <Plus size={14} /> Add new driver
          </Button>
        </div>
      </div>

      {confirmDeleteId && (() => {
        const name = drivers.find(d => d.id === confirmDeleteId)?.name ?? 'this driver';
        return (
          <div className="mb-4 px-4 py-2.5 bg-amber-50 border border-amber-100 rounded-xl text-sm text-amber-800 flex items-center justify-between">
            <span>Remove <strong>{name}</strong>? This cannot be undone.</span>
            <div className="flex items-center gap-2 ml-4 shrink-0">
              <button onClick={() => setConfirmDeleteId(null)} className="text-xs text-gray-500 hover:text-gray-700">Cancel</button>
              <button onClick={confirmDelete} className="text-xs bg-red-500 text-white px-3 py-1 rounded-lg hover:bg-red-600">Remove</button>
            </div>
          </div>
        );
      })()}

      {deleteError && (
        <div className="mb-4 px-4 py-2.5 bg-red-50 border border-red-100 rounded-xl text-sm text-red-600 flex items-center justify-between">
          {deleteError}
          <button onClick={() => setDeleteError('')} className="ml-2 text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      <div className="relative mb-4">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, vehicle, phone…"
          className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100"
        />
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => <div key={i} className="h-16 bg-white rounded-xl border border-gray-100 animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
          {search ? (
            <>
              <Truck size={48} className="text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 text-sm">No drivers match your search.</p>
            </>
          ) : (
            <>
              <Users size={48} className="text-gray-300 mx-auto mb-3" />
              <p className="text-gray-800 font-semibold text-sm mb-1">No drivers yet</p>
              <p className="text-gray-400 text-sm">Add your first driver to start assigning deliveries.</p>
            </>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Driver</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden md:table-cell">Last seen</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden sm:table-cell">Total stops</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden md:table-cell">30d rate</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden lg:table-cell">Vehicle</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(driver => (
                <tr
                  key={driver.id}
                  className="hover:bg-gray-50 transition-colors cursor-pointer"
                  onClick={() => router.push(`/dashboard/drivers/${driver.id}`)}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center text-[#0F4C81] font-semibold text-sm shrink-0">
                        {driver.name[0]}
                      </div>
                      <div>
                        <div className="font-medium text-gray-900">{driver.name}</div>
                        <div className="text-xs text-gray-400">{driver.phone}</div>
                      </div>
                      {driver.drugCapable && (
                        <span className="text-xs bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded-full hidden sm:inline">Rx</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 hidden md:table-cell">
                    {lastSeen(driver) ?? 'Never'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[driver.status] ?? 'bg-gray-400'}`} />
                      <Badge status={driver.status} />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600 hidden sm:table-cell">{driver.totalStops ?? 0} stops</td>
                  <td className="px-4 py-3 hidden md:table-cell">{completionDisplay(driver.id)}</td>
                  <td className="px-4 py-3 text-gray-500 capitalize hidden lg:table-cell">{driver.vehicleType}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      <button onClick={e => openEdit(driver, e)} className="p-1.5 text-gray-400 hover:text-[#0F4C81] rounded-lg hover:bg-blue-50 transition-colors">
                        <Pencil size={13} />
                      </button>
                      <button onClick={e => requestDelete(driver.id, e)} className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors">
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

      {showAdd && (
        <AddDriverModal orgId={user!.orgId} onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load(); }} />
      )}
      {editDriver && (
        <EditDriverModal driver={editDriver} orgId={user!.orgId} onClose={() => setEditDriver(null)} onSaved={() => { setEditDriver(null); load(); }} />
      )}
    </div>
  );
}

function AddDriverModal({ orgId, onClose, onSaved }: { orgId: string; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', vehicleType: 'car' as 'car' | 'van' | 'bicycle', drugCapable: false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k: string, v: string | boolean) => setForm(f => ({ ...f, [k]: v }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true); setError('');
    try { await api.post(`/orgs/${orgId}/drivers`, form); onSaved(); }
    catch (err: any) { setError(err.message ?? 'Failed to add driver'); }
    finally { setSaving(false); }
  };
  return (
    <Modal title="Add new driver" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <FormField label="Full Name" value={form.name} onChange={e => set('name', e.target.value)} required placeholder="Maria Rodriguez" />
        <FormField label="Email" type="email" value={form.email} onChange={e => set('email', e.target.value)} required placeholder="maria@pharmacy.com" />
        <FormField label="Phone" value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="+1 313 555 0101" />
        <FormField label="Password" type="password" value={form.password} onChange={e => set('password', e.target.value)} required placeholder="Temporary password" />
        <SelectField label="Vehicle Type" value={form.vehicleType} onChange={e => set('vehicleType', e.target.value)}>
          <option value="car">Car</option>
          <option value="van">Van</option>
          <option value="bicycle">Bicycle</option>
        </SelectField>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={form.drugCapable} onChange={e => set('drugCapable', e.target.checked)} className="rounded border-gray-300" />
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

function EditDriverModal({ driver, orgId, onClose, onSaved }: { driver: Driver; orgId: string; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: driver.name, phone: driver.phone, vehicleType: driver.vehicleType as 'car' | 'van' | 'bicycle', drugCapable: driver.drugCapable });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k: string, v: string | boolean) => setForm(f => ({ ...f, [k]: v }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true); setError('');
    try { await api.patch(`/orgs/${orgId}/drivers/${driver.id}`, form); onSaved(); }
    catch (err: any) { setError(err.message ?? 'Failed to update driver'); }
    finally { setSaving(false); }
  };
  return (
    <Modal title="Edit driver" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <FormField label="Full Name" value={form.name} onChange={e => set('name', e.target.value)} required />
        <FormField label="Phone" value={form.phone} onChange={e => set('phone', e.target.value)} />
        <SelectField label="Vehicle Type" value={form.vehicleType} onChange={e => set('vehicleType', e.target.value)}>
          <option value="car">Car</option>
          <option value="van">Van</option>
          <option value="bicycle">Bicycle</option>
        </SelectField>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={form.drugCapable} onChange={e => set('drugCapable', e.target.checked)} className="rounded border-gray-300" />
          <span className="text-sm text-gray-700">Rx / Drug Capable</span>
        </label>
        {error && <p className="text-red-500 text-sm">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" size="sm" type="button" onClick={onClose}>Cancel</Button>
          <Button size="sm" type="submit" loading={saving}>Save changes</Button>
        </div>
      </form>
    </Modal>
  );
}
