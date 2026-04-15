'use client';
import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import {
  Zap, Plus, CheckCircle2, XCircle, Clock, RefreshCw,
  ChevronDown, X, ToggleLeft, ToggleRight, Loader2,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────
type Trigger =
  | 'stop_status_changed' | 'stop_failed' | 'stop_completed'
  | 'driver_started_route' | 'route_completed' | 'stop_approaching';

interface Rule {
  id: string;
  name: string;
  trigger: Trigger;
  enabled: boolean;
  actions: Array<{ type: string; to: string }>;
  smsTemplate: string | null;
  emailSubject: string | null;
  emailTemplate: string | null;
  runCount: number;
  lastRunAt: string | null;
  createdAt: string;
}

interface LogEntry {
  id: string;
  ruleId: string;
  trigger: string;
  resourceId: string | null;
  status: string;
  detail: string | null;
  createdAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const TRIGGER_LABELS: Record<Trigger, string> = {
  stop_completed: 'Stop Completed',
  stop_failed: 'Stop Failed',
  stop_status_changed: 'Status Changed',
  driver_started_route: 'Driver Started Route',
  route_completed: 'Route Completed',
  stop_approaching: 'Stop Approaching',
};

const TRIGGER_COLORS: Record<Trigger, string> = {
  stop_completed: 'bg-emerald-100 text-emerald-700',
  stop_failed: 'bg-red-100 text-red-700',
  stop_status_changed: 'bg-blue-100 text-blue-700',
  driver_started_route: 'bg-amber-100 text-amber-700',
  route_completed: 'bg-teal-100 text-teal-700',
  stop_approaching: 'bg-purple-100 text-purple-700',
};

const TRIGGER_OPTIONS: Trigger[] = [
  'stop_completed', 'stop_failed', 'stop_status_changed',
  'driver_started_route', 'route_completed', 'stop_approaching',
];

const fmt = (d: string) => new Date(d).toLocaleString(undefined, {
  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
});

function actionsSummary(actions: Rule['actions']): string {
  return actions.map(a => `${a.type.toUpperCase()} → ${a.to}`).join(', ') || '—';
}

// ─── Add Rule Modal ───────────────────────────────────────────────────────────
interface ModalProps {
  onClose: () => void;
  onSaved: () => void;
  orgId: string;
}

function AddRuleModal({ onClose, onSaved, orgId }: ModalProps) {
  const [form, setForm] = useState({
    name: '',
    trigger: 'stop_completed' as Trigger,
    smsTemplate: '',
    emailSubject: '',
    emailTemplate: '',
    smsPatient: true,
    emailPatient: true,
    emailDispatcher: false,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const set = (k: string, v: unknown) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return setErr('Name is required');
    setSaving(true);
    setErr('');
    try {
      const actions: Array<{ type: string; to: string }> = [];
      if (form.smsPatient) actions.push({ type: 'sms', to: 'patient' });
      if (form.emailPatient) actions.push({ type: 'email', to: 'patient' });
      if (form.emailDispatcher) actions.push({ type: 'email', to: 'dispatcher' });
      await api.post(`/orgs/${orgId}/automation/rules`, {
        name: form.name,
        trigger: form.trigger,
        actions,
        smsTemplate: form.smsTemplate || undefined,
        emailSubject: form.emailSubject || undefined,
        emailTemplate: form.emailTemplate || undefined,
      });
      onSaved();
      onClose();
    } catch (e: any) {
      setErr(e.message ?? 'Failed to save rule');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800 text-base">New Automation Rule</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {err && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{err}</p>}

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Rule Name</label>
            <input
              value={form.name}
              onChange={e => set('name', e.target.value)}
              placeholder="e.g. Notify patient on delivery"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F4C81]/30"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Trigger</label>
            <select
              value={form.trigger}
              onChange={e => set('trigger', e.target.value as Trigger)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F4C81]/30 bg-white"
            >
              {TRIGGER_OPTIONS.map(t => (
                <option key={t} value={t}>{TRIGGER_LABELS[t]}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Actions</label>
            <div className="space-y-2">
              {[
                { key: 'smsPatient', label: 'SMS → Patient' },
                { key: 'emailPatient', label: 'Email → Patient' },
                { key: 'emailDispatcher', label: 'Email → Dispatcher' },
              ].map(({ key, label }) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={(form as any)[key]}
                    onChange={e => set(key, e.target.checked)}
                    className="rounded"
                  />
                  <span className="text-sm text-gray-700">{label}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">SMS Template</label>
            <textarea
              value={form.smsTemplate}
              onChange={e => set('smsTemplate', e.target.value)}
              rows={2}
              placeholder="Hi {{patientName}}, your delivery at {{address}} is..."
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F4C81]/30 resize-none"
            />
            <p className="text-xs text-gray-400 mt-1">
              Variables: <code className="bg-gray-50 px-1 rounded">{'{{patientName}}'}</code>{' '}
              <code className="bg-gray-50 px-1 rounded">{'{{address}}'}</code>{' '}
              <code className="bg-gray-50 px-1 rounded">{'{{driverName}}'}</code>{' '}
              <code className="bg-gray-50 px-1 rounded">{'{{stopStatus}}'}</code>
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Email Subject</label>
            <input
              value={form.emailSubject}
              onChange={e => set('emailSubject', e.target.value)}
              placeholder="Your delivery update — {{address}}"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F4C81]/30"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Email Body (HTML)</label>
            <textarea
              value={form.emailTemplate}
              onChange={e => set('emailTemplate', e.target.value)}
              rows={3}
              placeholder="<p>Hi {{patientName}},</p><p>Your delivery...</p>"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F4C81]/30 resize-none font-mono"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2 text-sm text-white bg-[#0F4C81] rounded-lg hover:bg-[#0d3d6b] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : null}
              Save Rule
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function AutomationPage() {
  const user = getUser();
  const orgId = user?.orgId ?? '';

  const [rules, setRules] = useState<Rule[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [seedError, setSeedError] = useState('');
  const [toggling, setToggling] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const [r, l] = await Promise.all([
        api.get<Rule[]>(`/orgs/${orgId}/automation/rules`),
        api.get<LogEntry[]>(`/orgs/${orgId}/automation/log`),
      ]);
      setRules(r);
      setLog(l);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  const handleSeedDefaults = async () => {
    setSeeding(true);
    try {
      await api.post(`/orgs/${orgId}/automation/seed-defaults`, {});
      await load();
      setSeedError('');
    } catch (e: any) {
      setSeedError(e.message ?? 'Failed to seed defaults');
    } finally {
      setSeeding(false);
    }
  };

  const toggleRule = async (rule: Rule) => {
    setToggling(rule.id);
    try {
      const updated = await api.patch<Rule>(`/orgs/${orgId}/automation/rules/${rule.id}`, {
        enabled: !rule.enabled,
      });
      setRules(rs => rs.map(r => r.id === updated.id ? updated : r));
    } finally {
      setToggling(null);
    }
  };

  const activeCount = rules.filter(r => r.enabled).length;
  const todayCount = log.filter(l => {
    const d = new Date(l.createdAt);
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  }).length;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-[#0F4C81]/10 rounded-xl flex items-center justify-center">
            <Zap size={18} className="text-[#0F4C81]" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-800">Automation & Alerts</h1>
            <p className="text-xs text-gray-400">Configure SMS/email triggers for delivery events</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleSeedDefaults}
            disabled={seeding}
            className="px-3 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            {seeding ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            Seed Defaults
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="px-3 py-2 text-sm text-white bg-[#0F4C81] rounded-lg hover:bg-[#0d3d6b] transition-colors flex items-center gap-1.5"
          >
            <Plus size={14} />
            Add Rule
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Total Rules', value: rules.length, color: '#0F4C81' },
          { label: 'Active Rules', value: activeCount, color: '#00B8A9' },
          { label: 'Alerts Today', value: todayCount, color: '#F6A623' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-100 px-5 py-4 shadow-sm">
            <p className="text-xs text-gray-400 font-medium">{label}</p>
            <p className="text-2xl font-bold mt-1" style={{ color }}>{loading ? '—' : value}</p>
          </div>
        ))}
      </div>

      {seedError && (
        <div className="mb-4 px-4 py-2.5 bg-red-50 border border-red-100 rounded-xl text-sm text-red-600 flex items-center justify-between">
          {seedError}
          <button onClick={() => setSeedError('')} className="ml-2 text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      {/* Rules list */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm mb-6">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">Rules</h2>
          {loading && <Loader2 size={14} className="animate-spin text-gray-400" />}
        </div>
        {rules.length === 0 && !loading ? (
          <div className="px-5 py-10 text-center">
            <Zap size={32} className="text-gray-200 mx-auto mb-3" />
            <p className="text-sm text-gray-400">No rules yet. Click "Seed Defaults" to get started.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {rules.map(rule => (
              <div key={rule.id} className="px-5 py-4 flex items-start gap-4 hover:bg-gray-50/50 transition-colors">
                <button
                  onClick={() => toggleRule(rule)}
                  disabled={toggling === rule.id}
                  className="mt-0.5 shrink-0 text-gray-300 hover:text-[#0F4C81] transition-colors disabled:opacity-50"
                  title={rule.enabled ? 'Disable rule' : 'Enable rule'}
                >
                  {toggling === rule.id
                    ? <Loader2 size={22} className="animate-spin text-gray-300" />
                    : rule.enabled
                      ? <ToggleRight size={22} className="text-[#00B8A9]" />
                      : <ToggleLeft size={22} />
                  }
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className={`text-sm font-medium ${rule.enabled ? 'text-gray-800' : 'text-gray-400'}`}>
                      {rule.name}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TRIGGER_COLORS[rule.trigger] ?? 'bg-gray-100 text-gray-500'}`}>
                      {TRIGGER_LABELS[rule.trigger] ?? rule.trigger}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400">{actionsSummary(rule.actions)}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs text-gray-400">
                    {rule.runCount} run{rule.runCount !== 1 ? 's' : ''}
                  </p>
                  {rule.lastRunAt && (
                    <p className="text-xs text-gray-300 mt-0.5">{fmt(rule.lastRunAt)}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Log table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">Recent Activity</h2>
        </div>
        {log.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <p className="text-sm text-gray-400">No activity yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  {['Time', 'Trigger', 'Resource', 'Status', 'Detail'].map(h => (
                    <th key={h} className="text-left text-xs font-medium text-gray-400 px-5 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {log.map(entry => {
                  const ruleName = rules.find(r => r.id === entry.ruleId)?.name ?? entry.ruleId.slice(0, 8);
                  return (
                    <tr key={entry.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-5 py-3 text-xs text-gray-400 whitespace-nowrap">{fmt(entry.createdAt)}</td>
                      <td className="px-5 py-3">
                        <span className="text-xs font-medium text-gray-700">{ruleName}</span>
                        <br />
                        <span className="text-xs text-gray-400">{entry.trigger}</span>
                      </td>
                      <td className="px-5 py-3 text-xs text-gray-500 font-mono">{entry.resourceId?.slice(0, 8) ?? '—'}</td>
                      <td className="px-5 py-3">
                        <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
                          entry.status === 'success' ? 'bg-emerald-50 text-emerald-700' :
                          entry.status === 'failed' ? 'bg-red-50 text-red-700' :
                          'bg-gray-100 text-gray-500'
                        }`}>
                          {entry.status === 'success' && <CheckCircle2 size={10} />}
                          {entry.status === 'failed' && <XCircle size={10} />}
                          {entry.status === 'skipped' && <Clock size={10} />}
                          {entry.status}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-xs text-gray-400 max-w-xs truncate">{entry.detail ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <AddRuleModal orgId={orgId} onClose={() => setShowModal(false)} onSaved={load} />
      )}
    </div>
  );
}
