'use client';
import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { ArrowLeft, Plus, CheckCircle, AlertTriangle, Clock, XCircle, Pencil, X, Check, AlertCircle } from 'lucide-react';

interface ComplianceItem {
  id: string;
  category: string;
  itemName: string;
  status: string;
  notes: string | null;
  dueDate: string | null;
  completedAt: string | null;
  legalRef: string | null;
}

const todayStr = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD local

function isOverdue(dueDate: string | null, status: string): boolean {
  if (!dueDate || status === 'compliant') return false;
  return dueDate.split('T')[0] < todayStr;
}

const CATEGORIES = [
  { key: '',                  label: 'All' },
  { key: 'maps_reporting',    label: 'MAPS Reporting' },
  { key: 'id_verification',   label: 'ID Verification' },
  { key: 'record_retention',  label: 'Record Retention' },
  { key: 'pharmacy_licensure',label: 'Pharmacy Licensure' },
  { key: 'data_destruction',  label: 'Data Destruction' },
  { key: 'breach_readiness',  label: 'Breach Readiness' },
];

const STATUS_CONFIG: Record<string, { icon: typeof CheckCircle; bg: string; text: string; label: string }> = {
  compliant:     { icon: CheckCircle,   bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Compliant' },
  warning:       { icon: AlertTriangle, bg: 'bg-amber-50',   text: 'text-amber-700',   label: 'Warning' },
  non_compliant: { icon: XCircle,       bg: 'bg-red-50',     text: 'text-red-700',     label: 'Non-Compliant' },
  pending:       { icon: Clock,         bg: 'bg-gray-50',    text: 'text-gray-600',    label: 'Pending' },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${s.bg} ${s.text}`}>
      <Icon size={10} /> {s.label}
    </span>
  );
}

interface EditState { id: string; notes: string; }

function ComplianceItemsContent() {
  const [user] = useState(getUser);
  const searchParams = useSearchParams();
  const initCategory = searchParams.get('category') ?? '';
  const [category, setCategory] = useState(initCategory);
  const [items, setItems] = useState<ComplianceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newItem, setNewItem] = useState({ category: 'maps_reporting', itemName: '', legalRef: '', notes: '' });
  const [saving, setSaving] = useState('');
  const [actionError, setActionError] = useState('');

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true); setLoadError(false);
    try {
      const url = category
        ? `/orgs/${user.orgId}/mi-compliance/items?category=${category}`
        : `/orgs/${user.orgId}/mi-compliance/items`;
      const result = await api.get<ComplianceItem[]>(url);
      setItems(result);
    } catch { setItems([]); setLoadError(true); }
    finally { setLoading(false); }
  }, [user, category]);

  useEffect(() => { load(); }, [load]);

  const updateStatus = async (id: string, status: string) => {
    if (!user) return;
    setSaving(id);
    setActionError('');
    try {
      const updated = await api.patch<ComplianceItem>(`/orgs/${user.orgId}/mi-compliance/items/${id}`, { status });
      setItems(prev => prev.map(i => i.id === id ? updated : i));
    } catch {
      setActionError('Update failed. Please try again.');
    } finally { setSaving(''); }
  };

  const saveNote = async (id: string) => {
    if (!user || !editing) return;
    setSaving(id);
    setActionError('');
    try {
      const updated = await api.patch<ComplianceItem>(`/orgs/${user.orgId}/mi-compliance/items/${id}`, { notes: editing.notes });
      setItems(prev => prev.map(i => i.id === id ? updated : i));
      setEditing(null);
    } catch {
      setActionError('Save failed. Please try again.');
    } finally { setSaving(''); }
  };

  const addItem = async () => {
    if (!user || !newItem.itemName.trim()) return;
    setSaving('new');
    setActionError('');
    try {
      const created = await api.post<ComplianceItem>(`/orgs/${user.orgId}/mi-compliance/items`, newItem);
      setItems(prev => [...prev, created]);
      setNewItem({ category: 'maps_reporting', itemName: '', legalRef: '', notes: '' });
      setShowAdd(false);
    } catch {
      setActionError('Failed to add item. Please try again.');
    } finally { setSaving(''); }
  };

  return (
    <div className="p-6 space-y-6">
      {loadError && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          <span className="flex items-center gap-2"><AlertCircle size={14} />Failed to load compliance items. Please try again.</span>
          <button onClick={load} className="text-red-600 font-medium hover:underline text-xs">Retry</button>
        </div>
      )}
      {actionError && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          <span className="flex items-center gap-2"><AlertCircle size={14} />{actionError}</span>
          <button onClick={() => setActionError('')} className="text-red-400 hover:text-red-600">✕</button>
        </div>
      )}
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/mi-compliance" className="text-gray-400 hover:text-gray-600">
            <ArrowLeft size={18} />
          </Link>
          <h1 className="text-xl font-bold text-gray-900" style={{ fontFamily: 'var(--font-sora)' }}>
            Compliance Item Tracker
          </h1>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-[#0F4C81] text-white rounded-lg hover:bg-[#0d3f6e] transition-colors"
        >
          <Plus size={13} /> Add Custom Item
        </button>
      </div>

      {/* Category Tabs */}
      <div className="flex gap-1 flex-wrap">
        {CATEGORIES.map(c => (
          <button
            key={c.key}
            onClick={() => setCategory(c.key)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              category === c.key
                ? 'bg-[#0F4C81] text-white'
                : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Add Item Form */}
      {showAdd && (
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 space-y-3">
          <p className="text-sm font-semibold text-[#0F4C81]">New Compliance Item</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <select
              aria-label="Compliance item category"
              value={newItem.category}
              onChange={e => setNewItem(p => ({ ...p, category: e.target.value }))}
              className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white"
            >
              {CATEGORIES.filter(c => c.key).map(c => (
                <option key={c.key} value={c.key}>{c.label}</option>
              ))}
            </select>
            <input
              placeholder="Legal reference (e.g., MCL 333.17735)"
              value={newItem.legalRef}
              onChange={e => setNewItem(p => ({ ...p, legalRef: e.target.value }))}
              className="text-sm border border-gray-200 rounded-lg px-3 py-1.5"
            />
          </div>
          <input
            placeholder="Item name / requirement"
            value={newItem.itemName}
            onChange={e => setNewItem(p => ({ ...p, itemName: e.target.value }))}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5"
          />
          <input
            placeholder="Notes (optional)"
            value={newItem.notes}
            onChange={e => setNewItem(p => ({ ...p, notes: e.target.value }))}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5"
          />
          <div className="flex gap-2">
            <button
              onClick={addItem}
              disabled={saving === 'new' || !newItem.itemName.trim()}
              className="px-3 py-1.5 text-sm bg-[#0F4C81] text-white rounded-lg hover:bg-[#0d3f6e] disabled:opacity-50"
            >
              {saving === 'new' ? 'Adding…' : 'Add Item'}
            </button>
            <button onClick={() => setShowAdd(false)} className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm">Loading…</div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">
            No items found. Run Init from the dashboard to seed the default checklist.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 w-2/5">Requirement</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500">Legal Ref</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500">Status</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500">Notes</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {items.map(item => (
                  <tr key={item.id} className="hover:bg-gray-50/50">
                    <td className="py-3 px-4">
                      <p className="text-gray-900 font-medium leading-snug">{item.itemName}</p>
                      {item.dueDate && (
                        <div className="flex items-center gap-1 mt-0.5">
                          {isOverdue(item.dueDate, item.status) ? (
                            <>
                              <span className="text-xs font-semibold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full">OVERDUE</span>
                              <span className="text-xs text-red-400">{new Date(item.dueDate + 'T00:00:00').toLocaleDateString()}</span>
                            </>
                          ) : (
                            <span className="text-xs text-gray-400">Due: {new Date(item.dueDate + 'T00:00:00').toLocaleDateString()}</span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-xs text-gray-500 whitespace-nowrap">{item.legalRef ?? '—'}</td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <StatusBadge status={item.status} />
                    </td>
                    <td className="py-3 px-4 max-w-xs">
                      {editing?.id === item.id ? (
                        <div className="flex items-center gap-1">
                          <input
                            autoFocus
                            value={editing.notes}
                            onChange={e => setEditing({ id: item.id, notes: e.target.value })}
                            className="flex-1 text-xs border border-gray-200 rounded px-2 py-1"
                          />
                          <button onClick={() => saveNote(item.id)} className="text-emerald-600 hover:text-emerald-700">
                            <Check size={14} />
                          </button>
                          <button onClick={() => setEditing(null)} className="text-gray-400 hover:text-gray-600">
                            <X size={14} />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 group">
                          <span className="text-xs text-gray-500 truncate max-w-[180px]">{item.notes ?? '—'}</span>
                          <button
                            onClick={() => setEditing({ id: item.id, notes: item.notes ?? '' })}
                            className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-gray-600 transition-opacity"
                          >
                            <Pencil size={11} />
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-end gap-1">
                        {item.status !== 'compliant' && (
                          <button
                            onClick={() => updateStatus(item.id, 'compliant')}
                            disabled={saving === item.id}
                            className="px-2 py-1 text-xs bg-emerald-50 text-emerald-700 rounded hover:bg-emerald-100 transition-colors disabled:opacity-50"
                          >
                            Mark Compliant
                          </button>
                        )}
                        {item.status !== 'warning' && (
                          <button
                            onClick={() => updateStatus(item.id, 'warning')}
                            disabled={saving === item.id}
                            className="px-2 py-1 text-xs bg-amber-50 text-amber-700 rounded hover:bg-amber-100 transition-colors disabled:opacity-50"
                          >
                            Mark Warning
                          </button>
                        )}
                        {item.status !== 'non_compliant' && (
                          <button
                            onClick={() => updateStatus(item.id, 'non_compliant')}
                            disabled={saving === item.id}
                            className="px-2 py-1 text-xs bg-red-50 text-red-700 rounded hover:bg-red-100 transition-colors disabled:opacity-50"
                          >
                            Non-Compliant
                          </button>
                        )}
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

function ComplianceItemsPageInner() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-gray-400 text-sm">Loading…</div>}>
      <ComplianceItemsContent />
    </Suspense>
  );
}

export default function ComplianceItemsPage() {
  return (
    <Suspense>
      <ComplianceItemsPageInner />
    </Suspense>
  );
}
