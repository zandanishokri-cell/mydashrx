'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { Button } from '@/components/ui/Button';
import { FormField, SelectField } from '@/components/ui/FormField';
import { CheckCircle2, Building2, Users, Sparkles, ArrowRight } from 'lucide-react';

const STEPS = ['Welcome', 'Add Depot', 'Add Driver', 'Setup Complete'];

function ProgressBar({ step }: { step: number }) {
  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-gray-500">Step {step} of {STEPS.length}</span>
        <span className="text-xs font-semibold text-[#0F4C81]">{STEPS[step - 1]}</span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-[#0F4C81] rounded-full transition-all duration-500"
          style={{ width: `${((step - 1) / (STEPS.length - 1)) * 100}%` }}
        />
      </div>
      <div className="flex justify-between mt-2">
        {STEPS.map((label, i) => (
          <div key={label} className="flex flex-col items-center gap-1">
            <div className={`w-2 h-2 rounded-full transition-colors ${i + 1 <= step ? 'bg-[#0F4C81]' : 'bg-gray-200'}`} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function OnboardingPage() {
  const router = useRouter();
  const [user] = useState(getUser);
  const [step, setStep] = useState(1);
  const [completedDepot, setCompletedDepot] = useState(false);
  const [completedDriver, setCompletedDriver] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [initCompliance, setInitCompliance] = useState(false);
  const [initMi, setInitMi] = useState(false);

  const seedAutomations = async () => {
    if (!user) return;
    setSeeding(true);
    try { await api.post(`/orgs/${user.orgId}/automation/seed-defaults`, {}); }
    catch { /* non-blocking */ }
    finally { setSeeding(false); }
  };

  const runCompliance = async () => {
    if (!user) return;
    setInitCompliance(true);
    try { await api.post(`/orgs/${user.orgId}/compliance/checks/run`, {}); }
    catch { /* non-blocking */ }
    finally { setInitCompliance(false); }
  };

  const runMiCompliance = async () => {
    if (!user) return;
    setInitMi(true);
    try { await api.post(`/orgs/${user.orgId}/mi-compliance/init`, {}); }
    catch { /* non-blocking */ }
    finally { setInitMi(false); }
  };

  return (
    <div className="min-h-screen bg-[#F7F8FC] flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
        <ProgressBar step={step} />

        {step === 1 && <StepWelcome onNext={() => setStep(2)} />}
        {step === 2 && (
          <StepDepot
            orgId={user?.orgId ?? ''}
            onSuccess={() => { setCompletedDepot(true); setStep(3); }}
            onSkip={() => setStep(3)}
          />
        )}
        {step === 3 && (
          <StepDriver
            orgId={user?.orgId ?? ''}
            onSuccess={() => { setCompletedDriver(true); setStep(4); }}
            onSkip={() => setStep(4)}
          />
        )}
        {step === 4 && (
          <StepComplete
            completedDepot={completedDepot}
            completedDriver={completedDriver}
            seeding={seeding}
            initCompliance={initCompliance}
            initMi={initMi}
            onSeedAutomations={seedAutomations}
            onRunCompliance={runCompliance}
            onRunMiCompliance={runMiCompliance}
            onDone={() => router.replace('/dashboard')}
          />
        )}
      </div>
    </div>
  );
}

function StepWelcome({ onNext }: { onNext: () => void }) {
  return (
    <div className="text-center">
      <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-5">
        <Sparkles size={28} className="text-[#0F4C81]" />
      </div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2" style={{ fontFamily: 'var(--font-sora)' }}>
        Welcome to MyDashRx
      </h1>
      <p className="text-gray-500 text-sm mb-2">
        Set up your pharmacy delivery operation in 4 steps.
      </p>
      <p className="text-gray-400 text-xs mb-8">
        Add your depot, register your first driver, and activate compliance tools — all in under 5 minutes.
      </p>
      <Button onClick={onNext} className="w-full">
        Get Started <ArrowRight size={15} />
      </Button>
    </div>
  );
}

function StepDepot({ orgId, onSuccess, onSkip }: { orgId: string; onSuccess: () => void; onSkip: () => void }) {
  const [form, setForm] = useState({ name: '', address: '', phone: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true); setError('');
    try {
      await api.post(`/orgs/${orgId}/depots`, {
        name: form.name,
        address: form.address,
        phone: form.phone || undefined,
        lat: 0,
        lng: 0,
      });
      onSuccess();
    } catch (err: any) {
      setError(err.message ?? 'Failed to create depot');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-1">
        <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center shrink-0">
          <Building2 size={20} className="text-[#0F4C81]" />
        </div>
        <h2 className="text-lg font-bold text-gray-900" style={{ fontFamily: 'var(--font-sora)' }}>Add Your First Depot</h2>
      </div>
      <p className="text-xs text-gray-400 mb-6 ml-13">
        A depot is the pharmacy or dispatch hub where drivers start and end routes.
      </p>
      <form onSubmit={submit} className="space-y-3">
        <FormField
          label="Depot Name"
          value={form.name}
          onChange={e => set('name', e.target.value)}
          required
          placeholder="Main Street Pharmacy"
        />
        <FormField
          label="Address"
          value={form.address}
          onChange={e => set('address', e.target.value)}
          required
          placeholder="123 Main St, Detroit, MI 48201"
        />
        <FormField
          label="Phone (optional)"
          value={form.phone}
          onChange={e => set('phone', e.target.value)}
          placeholder="+1 313 555 0100"
        />
        {error && <p className="text-red-500 text-sm">{error}</p>}
        <Button type="submit" loading={saving} className="w-full mt-2">
          Save Depot <ArrowRight size={15} />
        </Button>
      </form>
      <button
        type="button"
        onClick={onSkip}
        className="mt-3 w-full text-center text-xs text-gray-400 hover:text-gray-600 transition-colors"
      >
        Skip for now — I'll add my depot in Settings →
      </button>
    </div>
  );
}

function StepDriver({ orgId, onSuccess, onSkip }: { orgId: string; onSuccess: () => void; onSkip: () => void }) {
  const [tab, setTab] = useState<'single' | 'csv'>('single');
  const [form, setForm] = useState({
    name: '', email: '', phone: '', password: '',
    vehicleType: 'car' as 'car' | 'van' | 'bicycle',
    drugCapable: false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // P-ONB27: CSV bulk invite state
  const [csvText, setCsvText] = useState('');
  const [csvResult, setCsvResult] = useState<{ email: string; status: string }[] | null>(null);
  const set = (k: string, v: string | boolean) => setForm(f => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true); setError('');
    try {
      await api.post(`/orgs/${orgId}/drivers`, form);
      onSuccess();
    } catch (err: any) {
      setError(err.message ?? 'Failed to add driver');
    } finally {
      setSaving(false);
    }
  };

  // P-ONB27: parse CSV (name,email,phone) and POST to /bulk-invite
  const submitCsv = async () => {
    setSaving(true); setError(''); setCsvResult(null);
    try {
      const lines = csvText.trim().split('\n').filter(l => l.trim());
      const driversPayload = lines.map(line => {
        const [name, email, phone] = line.split(',').map(s => s.trim());
        return { name: name ?? '', email: email ?? '', phone: phone ?? '' };
      }).filter(d => d.name && d.email);
      if (driversPayload.length === 0) { setError('No valid rows found. Format: Name, Email, Phone'); setSaving(false); return; }
      if (driversPayload.length > 50) { setError('Maximum 50 drivers per upload'); setSaving(false); return; }
      const res = await api.post(`/orgs/${orgId}/drivers/bulk-invite`, { drivers: driversPayload }) as { results: { email: string; status: string }[] };
      setCsvResult(res.results ?? []);
      const invited = res.results?.filter(r => r.status === 'invited').length ?? 0;
      if (invited > 0) onSuccess();
    } catch (err: any) {
      setError(err.message ?? 'Bulk invite failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-1">
        <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center shrink-0">
          <Users size={20} className="text-[#0F4C81]" />
        </div>
        <h2 className="text-lg font-bold text-gray-900" style={{ fontFamily: 'var(--font-sora)' }}>Add Your First Driver</h2>
      </div>
      <p className="text-xs text-gray-400 mb-4">
        Drivers will receive an invite email with a magic link to activate their account.
      </p>

      {/* P-ONB27: Tab switcher — single vs CSV */}
      <div className="flex bg-gray-100 rounded-lg p-1 mb-4">
        <button onClick={() => setTab('single')} className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${tab === 'single' ? 'bg-white text-[#0F4C81] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Add one</button>
        <button onClick={() => setTab('csv')} className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${tab === 'csv' ? 'bg-white text-[#0F4C81] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Upload CSV (up to 50)</button>
      </div>

      {tab === 'single' && (
        <form onSubmit={submit} className="space-y-3">
          <FormField label="Full Name" value={form.name} onChange={e => set('name', e.target.value)} required placeholder="Maria Rodriguez" />
          <FormField label="Email" type="email" value={form.email} onChange={e => set('email', e.target.value)} required placeholder="driver@pharmacy.com" />
          <FormField label="Phone" value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="+1 313 555 0101" />
          <FormField label="Temporary Password" type="password" value={form.password} onChange={e => set('password', e.target.value)} required placeholder="They can change this later" />
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
          <Button type="submit" loading={saving} className="w-full mt-2">
            Add Driver <ArrowRight size={15} />
          </Button>
        </form>
      )}

      {tab === 'csv' && (
        <div className="space-y-3">
          <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 text-xs text-blue-700">
            <strong>Format:</strong> one driver per line — <code>Name, Email, Phone</code><br />
            Each driver gets an invite email with a magic sign-in link.
          </div>
          <textarea
            value={csvText}
            onChange={e => setCsvText(e.target.value)}
            rows={6}
            placeholder={"Maria Rodriguez, maria@bestpharmacy.com, 3135550101\nJohn Smith, john@bestpharmacy.com, 3135550102"}
            className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-200"
          />
          {csvResult && (
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {csvResult.map(r => (
                <div key={r.email} className={`flex items-center justify-between text-xs px-2 py-1 rounded ${r.status === 'invited' ? 'bg-green-50 text-green-700' : r.status === 'already_exists' ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-600'}`}>
                  <span>{r.email}</span>
                  <span className="font-medium">{r.status === 'invited' ? 'Invited' : r.status === 'already_exists' ? 'Already exists' : 'Failed'}</span>
                </div>
              ))}
            </div>
          )}
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <Button type="button" loading={saving} onClick={submitCsv} className="w-full">
            Send Invite Emails <ArrowRight size={15} />
          </Button>
        </div>
      )}

      <button
        type="button"
        onClick={onSkip}
        className="mt-3 w-full text-center text-xs text-gray-400 hover:text-gray-600 transition-colors"
      >
        Skip for now — I'll add drivers in Settings →
      </button>
    </div>
  );
}

function StepComplete({
  completedDepot, completedDriver, seeding, initCompliance, initMi,
  onSeedAutomations, onRunCompliance, onRunMiCompliance, onDone,
}: {
  completedDepot: boolean; completedDriver: boolean;
  seeding: boolean; initCompliance: boolean; initMi: boolean;
  onSeedAutomations: () => void; onRunCompliance: () => void;
  onRunMiCompliance: () => void; onDone: () => void;
}) {
  const checks = [
    { label: 'Account created', done: true },
    { label: 'First depot added', done: completedDepot },
    { label: 'First driver registered', done: completedDriver },
  ];

  return (
    <div>
      <div className="text-center mb-6">
        <div className="w-16 h-16 bg-emerald-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 size={28} className="text-emerald-500" />
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-1" style={{ fontFamily: 'var(--font-sora)' }}>
          Setup Complete!
        </h2>
        <p className="text-sm text-gray-500">Your pharmacy delivery operation is ready.</p>
      </div>

      <div className="space-y-2 mb-6">
        {checks.map(c => (
          <div key={c.label} className="flex items-center gap-2.5 text-sm">
            <CheckCircle2 size={16} className={c.done ? 'text-emerald-500' : 'text-gray-200'} />
            <span className={c.done ? 'text-gray-800' : 'text-gray-400'}>{c.label}</span>
          </div>
        ))}
      </div>

      <div className="border-t border-gray-100 pt-5 space-y-2.5 mb-6">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Optional: Activate Tools</p>
        <button
          onClick={onSeedAutomations}
          disabled={seeding}
          className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-gray-200 text-sm text-gray-700 hover:border-[#0F4C81] hover:text-[#0F4C81] hover:bg-blue-50 transition-colors disabled:opacity-50"
        >
          <span className="font-medium">{seeding ? 'Seeding…' : 'Seed Default Automations'}</span>
          <ArrowRight size={14} />
        </button>
        <button
          onClick={onRunCompliance}
          disabled={initCompliance}
          className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-gray-200 text-sm text-gray-700 hover:border-[#0F4C81] hover:text-[#0F4C81] hover:bg-blue-50 transition-colors disabled:opacity-50"
        >
          <span className="font-medium">{initCompliance ? 'Initializing…' : 'Initialize HIPAA Compliance'}</span>
          <ArrowRight size={14} />
        </button>
        <button
          onClick={onRunMiCompliance}
          disabled={initMi}
          className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-gray-200 text-sm text-gray-700 hover:border-[#0F4C81] hover:text-[#0F4C81] hover:bg-blue-50 transition-colors disabled:opacity-50"
        >
          <span className="font-medium">{initMi ? 'Initializing…' : 'Initialize Michigan Compliance'}</span>
          <ArrowRight size={14} />
        </button>
      </div>

      <Button onClick={onDone} className="w-full">
        Go to Dashboard <ArrowRight size={15} />
      </Button>
      {(completedDepot || completedDriver) && (
        <a
          href="/dashboard/stops?onboarding=1"
          className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-semibold hover:bg-emerald-100 transition-colors"
        >
          Create Your First Route <ArrowRight size={14} />
        </a>
      )}
    </div>
  );
}
