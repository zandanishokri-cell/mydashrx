'use client';
import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

type Step = 1 | 2 | 3;

const STEPS = [
  { label: 'Pharmacy info', time: '~1 min' },
  { label: 'Your account', time: '~1 min' },
  { label: 'Review', time: '~30 sec' },
];

const DRAFT_KEY = 'pharmacy_wizard_draft';

function StepIndicator({ current }: { current: Step }) {
  return (
    <div className="flex items-center gap-2 mb-8">
      {STEPS.map(({ label, time }, i) => {
        const step = (i + 1) as Step;
        const active = step === current;
        const done = step < current;
        return (
          <div key={label} className="flex items-center gap-2">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold ${done ? 'bg-green-500 text-white' : active ? 'bg-[#0F4C81] text-white' : 'bg-gray-100 text-gray-400'}`}>
              {done ? '✓' : step}
            </div>
            <div className="flex flex-col">
              <span className={`text-xs leading-tight ${active ? 'text-gray-900 font-medium' : 'text-gray-400'}`}>{label}</span>
              {active && <span className="text-[10px] text-gray-400 leading-tight">{time}</span>}
            </div>
            {i < STEPS.length - 1 && <div className="w-5 h-px bg-gray-200 mx-1" />}
          </div>
        );
      })}
    </div>
  );
}

const emptyForm = { orgName: '', orgPhone: '', orgAddress: '', adminName: '', adminEmail: '' };

export default function PharmacySignupPage() {
  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState(emptyForm);
  const [draftSaved, setDraftSaved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  // Restore draft on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) setForm(JSON.parse(saved));
    } catch { /* ignore */ }
  }, []);

  // Persist draft on form change
  useEffect(() => {
    const hasData = Object.values(form).some(v => v !== '');
    if (!hasData) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(form));
      setDraftSaved(true);
      const t = setTimeout(() => setDraftSaved(false), 1500);
      return () => clearTimeout(t);
    } catch { /* ignore */ }
  }, [form]);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [key]: e.target.value }));

  const submit = async () => {
    setLoading(true);
    setError('');
    try {
      await api.post('/signup/pharmacy', form);
      localStorage.removeItem(DRAFT_KEY);
      setSubmitted(true);
    } catch (err: any) {
      const raw = (err as Error).message ?? '';
      const match = raw.match(/\{.*\}/);
      let msg = 'Something went wrong. Please try again.';
      if (match) { try { msg = JSON.parse(match[0]).error ?? msg; } catch { /* ignore */ } }
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F7F8FC]">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
          <div className="w-14 h-14 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Application submitted!</h2>
          <p className="text-gray-500 text-sm mb-2">We've received your application for <strong>{form.orgName}</strong>.</p>
          <p className="text-gray-500 text-sm mb-6">Our team will review it and contact <strong>{form.adminEmail}</strong> within 24 hours.</p>
          <a href="/login" className="text-sm text-[#0F4C81] hover:underline">Back to sign in</a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F7F8FC] py-10">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
        <div className="flex items-center justify-between mb-6">
          <a href="/login" className="text-xs text-gray-400 hover:text-gray-600">← Back to sign in</a>
          {draftSaved && <span className="text-xs text-gray-400">Draft saved</span>}
        </div>
        <h1 className="text-2xl font-bold text-[#0F4C81] mb-1" style={{ fontFamily: 'var(--font-sora)' }}>
          Join MyDashRx
        </h1>
        <p className="text-gray-500 text-sm mb-6">Set up your pharmacy account</p>

        <StepIndicator current={step} />

        {step === 1 && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Pharmacy name</label>
              <input value={form.orgName} onChange={set('orgName')} placeholder="Greater Care Pharmacy" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone number</label>
              <input value={form.orgPhone} onChange={set('orgPhone')} placeholder="(555) 000-0000" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
              <input value={form.orgAddress} onChange={set('orgAddress')} placeholder="123 Main St, Detroit, MI 48201" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
            </div>
            <button
              onClick={() => setStep(2)}
              disabled={!form.orgName || !form.orgPhone || !form.orgAddress}
              className="w-full bg-[#0F4C81] text-white rounded-lg py-2.5 text-sm font-medium hover:bg-[#0d3d69] disabled:opacity-40 transition-colors mt-2"
            >
              Continue
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Your full name</label>
              <input value={form.adminName} onChange={set('adminName')} placeholder="Jane Smith" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Work email</label>
              <input type="email" value={form.adminEmail} onChange={set('adminEmail')} placeholder="jane@yourpharmacy.com" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
            </div>
            <div className="flex gap-3 mt-2">
              <button onClick={() => setStep(1)} className="flex-1 border border-gray-200 text-gray-600 rounded-lg py-2.5 text-sm font-medium hover:bg-gray-50 transition-colors">Back</button>
              <button
                onClick={() => setStep(3)}
                disabled={!form.adminName || !form.adminEmail}
                className="flex-1 bg-[#0F4C81] text-white rounded-lg py-2.5 text-sm font-medium hover:bg-[#0d3d69] disabled:opacity-40 transition-colors"
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="bg-gray-50 rounded-xl p-4 space-y-3 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Pharmacy</span><span className="font-medium">{form.orgName}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Phone</span><span>{form.orgPhone}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Address</span><span className="text-right max-w-[200px]">{form.orgAddress}</span></div>
              <div className="border-t border-gray-200 pt-3 flex justify-between"><span className="text-gray-500">Admin name</span><span className="font-medium">{form.adminName}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Admin email</span><span>{form.adminEmail}</span></div>
            </div>
            <p className="text-xs text-gray-400">After submission, our team will review your application and activate your account within 24 hours.</p>
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <div className="flex gap-3">
              <button onClick={() => setStep(2)} className="flex-1 border border-gray-200 text-gray-600 rounded-lg py-2.5 text-sm font-medium hover:bg-gray-50 transition-colors">Back</button>
              <button
                onClick={submit}
                disabled={loading}
                className="flex-1 bg-[#0F4C81] text-white rounded-lg py-2.5 text-sm font-medium hover:bg-[#0d3d69] disabled:opacity-50 transition-colors"
              >
                {loading ? 'Submitting…' : 'Submit application'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
