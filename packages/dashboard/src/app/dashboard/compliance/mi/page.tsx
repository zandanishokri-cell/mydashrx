'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { ChevronLeft, CheckCircle2, Clock, AlertTriangle, AlertCircle, MapPin } from 'lucide-react';

interface MiItem {
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

const STATUS_CYCLE: Record<string, string> = {
  pending: 'compliant',
  compliant: 'warning',
  warning: 'non_compliant',
  non_compliant: 'pending',
};

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-600',
  compliant: 'bg-emerald-100 text-emerald-700',
  warning: 'bg-amber-100 text-amber-700',
  non_compliant: 'bg-red-100 text-red-700',
};

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  compliant: 'Compliant',
  warning: 'Warning',
  non_compliant: 'Non-Compliant',
};

function statusIcon(status: string) {
  if (status === 'compliant') return <CheckCircle2 size={15} className="text-emerald-500" />;
  if (status === 'in_progress') return <Clock size={15} className="text-blue-500" />;
  return <AlertTriangle size={15} className="text-amber-500" />;
}

export default function MiCompliancePage() {
  const [user] = useState(getUser);
  const [items, setItems] = useState<MiItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [saveError, setSaveError] = useState('');

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setLoadError(false);
    try {
      const rows = await api.get<MiItem[]>(`/orgs/${user.orgId}/compliance/mi-checklist`);
      setItems(rows);
    } catch { setLoadError(true); }
    finally { setLoading(false); }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const cycleStatus = async (item: MiItem) => {
    if (!user) return;
    const next = STATUS_CYCLE[item.status] ?? 'pending';
    setSaving(item.id);
    setSaveError('');
    try {
      const updated = await api.patch<MiItem>(`/orgs/${user!.orgId}/compliance/mi-checklist/${item.id}`, { status: next });
      setItems(prev => prev.map(i => i.id === item.id ? updated : i));
    } catch (err: any) { setSaveError(err?.message ?? 'Failed to update status'); }
    finally { setSaving(null); }
  };

  // Group by category
  const grouped = items.reduce<Record<string, MiItem[]>>((acc, item) => {
    (acc[item.category] ??= []).push(item);
    return acc;
  }, {});

  const compliantCount = items.filter(i => i.status === 'compliant').length;
  const overdueItems = items.filter(i => isOverdue(i.dueDate, i.status));

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/compliance" className="text-gray-400 hover:text-gray-600">
            <ChevronLeft size={18} />
          </Link>
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-blue-50 rounded-lg">
              <MapPin size={16} className="text-[#0F4C81]" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900" style={{ fontFamily: 'var(--font-sora)' }}>
                Michigan Compliance Checklist
              </h1>
              <p className="text-xs text-gray-500">MAPS reporting, controlled substances, pharmacy license</p>
            </div>
          </div>
        </div>
        {!loading && !loadError && (
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-500">
              <span className="font-semibold text-gray-900">{compliantCount}</span> / {items.length} compliant
            </span>
            {overdueItems.length > 0 && (
              <span className="flex items-center gap-1.5 text-xs font-medium text-red-600 bg-red-50 border border-red-100 px-2.5 py-1 rounded-full">
                <AlertTriangle size={12} /> {overdueItems.length} overdue
              </span>
            )}
          </div>
        )}
      </div>

      {saveError && (
        <div className="flex items-center justify-between bg-red-50 border border-red-100 rounded-xl px-4 py-2.5 text-sm text-red-600">
          {saveError}
          <button onClick={() => setSaveError('')} className="ml-2 text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      {loading ? (
        <div className="space-y-4">
          {[1,2,3].map(i => <div key={i} className="h-32 bg-white rounded-xl border border-gray-100 animate-pulse" />)}
        </div>
      ) : loadError ? (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
          <AlertCircle size={36} className="text-red-400 mx-auto mb-3" />
          <p className="text-gray-700 font-semibold text-sm mb-1">Failed to load checklist</p>
          <p className="text-gray-400 text-sm mb-4">Check your connection and try again.</p>
          <button onClick={load} className="text-sm bg-[#0F4C81] text-white px-4 py-2 rounded-lg hover:bg-blue-900">Retry</button>
        </div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 border-dashed p-12 text-center">
          <MapPin size={32} className="text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 text-sm font-medium mb-1">No checklist items yet</p>
          <p className="text-gray-400 text-xs">Michigan compliance items will appear here once seeded.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {Object.entries(grouped).map(([category, categoryItems]) => (
            <div key={category} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-700">{category}</h2>
                <span className="text-xs text-gray-400">
                  {categoryItems.filter(i => i.status === 'compliant').length} / {categoryItems.length}
                </span>
              </div>
              <div className="divide-y divide-gray-50">
                {categoryItems.map(item => {
                  const itemIsOverdue = isOverdue(item.dueDate, item.status);
                  return (
                    <div key={item.id} className={`px-5 py-4 flex items-start gap-4 ${itemIsOverdue ? 'bg-red-50/30' : ''}`}>
                      <button
                        onClick={() => cycleStatus(item)}
                        disabled={saving === item.id}
                        title="Click to cycle status"
                        className="mt-0.5 shrink-0 disabled:opacity-50 hover:scale-110 transition-transform"
                      >
                        {statusIcon(item.status)}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <p className="text-sm font-medium text-gray-900">{item.itemName}</p>
                          <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${STATUS_BADGE[item.status] ?? 'bg-gray-100 text-gray-600'}`}>
                            {STATUS_LABEL[item.status] ?? item.status}
                          </span>
                          {itemIsOverdue && (
                            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-600">
                              Overdue
                            </span>
                          )}
                        </div>
                        {item.notes && <p className="text-xs text-gray-500 mb-1">{item.notes}</p>}
                        <div className="flex items-center gap-3 flex-wrap">
                          {item.legalRef && (
                            <span className="text-[11px] text-gray-400 font-mono">{item.legalRef}</span>
                          )}
                          {item.dueDate && item.status !== 'compliant' && (
                            <span className={`text-[11px] ${itemIsOverdue ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
                              Due {new Date(item.dueDate + 'T00:00:00').toLocaleDateString()}
                            </span>
                          )}
                          {item.completedAt && (
                            <span className="text-[11px] text-emerald-600">
                              Completed {new Date(item.completedAt).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-gray-400 text-center">
        Click any status icon to cycle: Pending → Compliant → Warning → Non-Compliant
      </p>
    </div>
  );
}
