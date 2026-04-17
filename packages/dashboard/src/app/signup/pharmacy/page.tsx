'use client';
import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

type Step = 1 | 2;

const STEPS = [
  { label: 'Pharmacy info', time: '~1 min' },
  { label: 'Your account', time: '~1 min' },
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

const validateEmail = (v: string) => {
  if (!v) return '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? '' : 'Please enter a valid work email';
};

export default function PharmacySignupPage() {
  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState(emptyForm);
  const [emailError, setEmailError] = useState('');
  const [draftSaved, setDraftSaved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) setForm(JSON.parse(saved));
    } catch { /* ignore */ }
  }, []);

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
          <p className="text-gray-500 text-sm mb-1">
            We&apos;ve received your application for <strong>{form.orgName}</strong>.
          </p>
          <p className="text-gray-500 text-sm mb-5">
            Our team will review it and contact <strong>{form.adminEmail}</strong> within 2–4 business hours.
          </p>

          <div className="bg-blue-50 rounded-xl p-4 text-left mb-5">
            <p className="text-xs font-semibold text-blue-800 mb-2">While you wait</p>
            <ul className="space-y-1.5 text-xs text-blue-700">
              <li>• Gather your pharmacy NPI number and state license</li>
              <li>• Prepare your staff list (names + emails)</li>
              <li>• Download the MyDashRx driver app</li>
            </ul>
          </div>

          <a
            href={`mailto:onboarding@mydashrx.com?subject=MyDashRx%20Onboarding%20Call&body=Hi%2C%20I%27d%20like%20to%20schedule%20a%20call%20before%20${encodeURIComponent(form.orgName)}%20goes%20live.`}
            className="block w-full bg-[#0F4C81] text-white rounded-lg py-2.5 text-sm font-medium hover:bg-[#0d3d69] transition-colors mb-3"
          >
            Book a 15-min onboarding call
          </a>
          <a href="/login" className="text-xs text-gray-400 hover:text-gray-600">Back to sign in</a>
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
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone number <span className="text-gray-400 font-normal">(optional)</span></label>
              <input value={form.orgPhone} onChange={set('orgPhone')} placeholder="(555) 000-0000" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
              <p className="text-xs text-gray-400 mt-1">You can add this in Settings after approval</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Address <span className="text-gray-400 font-normal">(optional)</span></label>
              <input value={form.orgAddress} onChange={set('orgAddress')} placeholder="123 Main St, Detroit, MI 48201" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
              <p className="text-xs text-gray-400 mt-1">You can add this in Settings after approval</p>
            </div>
            <button
              onClick={() => setStep(2)}
              disabled={!form.orgName.trim() || form.orgName.trim().length < 2}
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
              <input
                type="email"
                value={form.adminEmail}
                onChange={e => { set('adminEmail')(e); if (emailError) setEmailError(validateEmail(e.target.value)); }}
                onBlur={e => setEmailError(validateEmail(e.target.value))}
                placeholder="jane@yourpharmacy.com"
                className={`w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 ${emailError ? 'border-red-300 focus:ring-red-100' : 'border-gray-200 focus:ring-blue-200'}`}
              />
              {emailError && <p className="text-red-500 text-xs mt-1">{emailError}</p>}
            </div>

            {/* Mini-summary of Step 1 for confidence before submit */}
            <div className="bg-gray-50 rounded-lg px-3 py-2 text-xs text-gray-500">
              <span className="font-medium text-gray-700">{form.orgName}</span>
              {form.orgPhone && <> · {form.orgPhone}</>}
            </div>

            {error && <p className="text-red-500 text-sm">{error}</p>}
            <div className="flex gap-3">
              <button onClick={() => setStep(1)} className="flex-1 border border-gray-200 text-gray-600 rounded-lg py-2.5 text-sm font-medium hover:bg-gray-50 transition-colors">Back</button>
              <button
                onClick={submit}
                disabled={loading || !form.adminName.trim() || form.adminName.trim().length < 2 || !form.adminEmail || !!validateEmail(form.adminEmail)}
                className="flex-1 bg-[#0F4C81] text-white rounded-lg py-2.5 text-sm font-medium hover:bg-[#0d3d69] disabled:opacity-40 transition-colors"
              >
                {loading ? 'Submitting…' : 'Submit application'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Trust signals */}
      <div className="w-full max-w-lg mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-gray-400">
        <span>🔒 HIPAA-compliant</span>
        <span>·</span>
        <span>BAA available on request</span>
        <span>·</span>
        <span>Reviewed in 2–4 hours</span>
        <span>·</span>
        <span>Trusted by independent pharmacies nationwide</span>
      </div>
    </div>
  );
}
