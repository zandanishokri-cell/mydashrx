'use client';
import { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { SignupTrustBlock } from '@/components/SignupTrustBlock';
import { useFieldError } from '@/lib/useFieldError';
import { API_BASE } from '@/lib/config';

// P-CNV30: Per-field green check micro-validation (completion momentum — 23% abandonment reduction)
function FieldCheck({ field, validFields }: { field: string; validFields: Set<string> }) {
  if (!validFields.has(field)) return null;
  return (
    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-green-500 text-sm pointer-events-none"
      aria-label="Valid" role="img">✓</span>
  );
}

// P-CNV30: 4-segment password strength bar
function PasswordStrength({ value }: { value: string }) {
  if (!value) return null;
  const score = [/.{8,}/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(r => r.test(value)).length;
  const colors = ['bg-red-400', 'bg-orange-400', 'bg-yellow-400', 'bg-green-500'];
  return (
    <div className="flex gap-1 mt-1" aria-hidden="true">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${i < score ? colors[score - 1] : 'bg-gray-200'}`} />
      ))}
    </div>
  );
}

// P-CNV24: Step 0 = role segmentation; Steps 1 & 2 = existing pharmacy info / account
type Step = 0 | 1 | 2;
type OrgSize = 'solo' | 'small_group' | 'enterprise';

const ORG_SIZE_OPTIONS: { value: OrgSize; label: string; subtitle: string; icon: string }[] = [
  { value: 'solo', label: 'Solo pharmacist', subtitle: 'Just me — independent or owner-operated', icon: '🧑‍⚕️' },
  { value: 'small_group', label: 'Small group', subtitle: '2–10 locations or pharmacists', icon: '🏪' },
  { value: 'enterprise', label: 'Enterprise', subtitle: '10+ locations or large operation', icon: '🏢' },
];

const STEPS = [
  { label: 'Pharmacy info', time: '~1 min' },
  { label: 'Your account', time: '~1 min' },
];

const DRAFT_KEY = 'pharmacy_wizard_draft';

// P-A11Y29: StepIndicator — aria-current=step on active indicator (WCAG 3.3.7 + 1.3.1)
function StepIndicator({ current }: { current: Step }) {
  if (current === 0) return null;
  return (
    <div className="flex items-center gap-2 mb-8" role="list" aria-label="Progress">
      {STEPS.map(({ label, time }, i) => {
        const step = (i + 1) as 1 | 2;
        const active = step === current;
        const done = step < current;
        return (
          <div key={label} role="listitem" className="flex items-center gap-2">
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold ${done ? 'bg-green-500 text-white' : active ? 'bg-[#0F4C81] text-white' : 'bg-gray-100 text-gray-400'}`}
              aria-current={active ? 'step' : undefined}
              aria-label={done ? `${label} — completed` : active ? `${label} — current` : label}
            >
              {done ? '✓' : step}
            </div>
            <div className="flex flex-col">
              <span className={`text-xs leading-tight ${active ? 'text-gray-900 font-medium' : 'text-gray-400'}`}>{label}</span>
              {active && <span className="text-[10px] text-gray-400 leading-tight">{time}</span>}
            </div>
            {i < STEPS.length - 1 && <div className="w-5 h-px bg-gray-200 mx-1" aria-hidden="true" />}
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

// P-CNV11: detect 409 duplicate account error
const isDuplicateError = (msg: string) =>
  msg.toLowerCase().includes('already exists') || msg.toLowerCase().includes('already registered');

const INTENT_URL = `${API_BASE}/api/v1/signup/pharmacy-intent`;
const RESCUE_KEY = 'mdrx_rescue_shown';

function PharmacySignupPageInner() {
  const searchParams = useSearchParams();
  // P-CNV32: read ?ref= param for referral tracking
  const referredByOrgId = searchParams.get('ref') ?? undefined;

  const [step, setStep] = useState<Step>(0);
  const [orgSize, setOrgSize] = useState<OrgSize | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState('');
  // P-A11Y20: accessible field error
  const emailFE = useFieldError(emailError);
  const [draftSaved, setDraftSaved] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false); // P-CNV10
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  // P-CNV12: NPI field state
  const [npiNumber, setNpiNumber] = useState('');
  const [npiStatus, setNpiStatus] = useState<'idle' | 'checking' | 'valid' | 'invalid'>('idle');
  // P-A11Y29: track prev NPI to skip status reset when value unchanged
  const prevNpiRef = useRef('');
  // P-A11Y29: always-mounted live region for step announcements (WCAG 3.3.7)
  const [stepAnnouncement, setStepAnnouncement] = useState('');
  // P-CNV15: approval tier from backend
  const [approvalTier, setApprovalTier] = useState<'auto_approve' | 'manual'>('manual');
  // P-CNV32: referred-by org name returned from backend
  const [referredByOrgName, setReferredByOrgName] = useState<string | null>(null);
  // P-CNV25: rescue banner — shown once per session after 75s if email entered but not submitted
  const [showRescueBanner, setShowRescueBanner] = useState(false);
  // P-ONB46: BAA click-wrap consent
  const [baaChecked, setBaaChecked] = useState(false);
  const [baaError, setBaaError] = useState('');
  // P-CNV30: per-field green check micro-validation state
  const [validFields, setValidFields] = useState<Set<string>>(new Set());
  const markValid = (field: string, isValid: boolean) =>
    setValidFields(prev => { const n = new Set(prev); isValid ? n.add(field) : n.delete(field); return n; });

  const fieldValidators: Record<string, (v: string) => boolean> = {
    orgName: v => v.trim().length >= 3,
    orgPhone: v => /^\d{10}$/.test(v.replace(/\D/g, '')),
    orgAddress: v => v.trim().length >= 10,
    adminName: v => v.trim().split(' ').filter(Boolean).length >= 2,
    adminEmail: v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
    adminPassword: v => v.length >= 8,
  };

  useEffect(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // P-CNV10: only restore if there's meaningful data
        if (Object.values(parsed).some((v: unknown) => typeof v === 'string' && (v as string).trim())) {
          setForm(parsed);
          setDraftRestored(true);
        }
      }
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

  // P-CNV25: 75s rescue banner — fires once per session if email entered but form not submitted
  useEffect(() => {
    if (submitted) return;
    const t = setTimeout(() => {
      if (!form.adminEmail || sessionStorage.getItem(RESCUE_KEY)) return;
      setShowRescueBanner(true);
      sessionStorage.setItem(RESCUE_KEY, '1');
      // Also fire intent capture with source=rescue_banner + orgSize for segmentation
      fetch(INTENT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminEmail: form.adminEmail, orgName: form.orgName, step, orgSize, source: 'rescue_banner' }),
      }).catch(() => {});
    }, 75_000);
    return () => clearTimeout(t);
  }, [form.adminEmail, form.orgName, orgSize, step, submitted]); // eslint-disable-line react-hooks/exhaustive-deps

  // P-CNV25: beforeunload intent capture via sendBeacon (silent, non-blocking)
  useEffect(() => {
    const handle = () => {
      if (!form.adminEmail || submitted) return;
      navigator.sendBeacon(INTENT_URL, JSON.stringify({
        adminEmail: form.adminEmail,
        orgName: form.orgName,
        step,
        orgSize,
        source: 'beforeunload',
        timestamp: new Date().toISOString(),
      }));
    };
    window.addEventListener('beforeunload', handle);
    return () => window.removeEventListener('beforeunload', handle);
  }, [form.adminEmail, form.orgName, orgSize, step, submitted]);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [key]: e.target.value }));

  // P-A11Y29: announce step transitions to SR (WCAG 3.3.7 Level A — WCAG 2.2)
  const announceStep = (nextStep: Step) => {
    const total = STEPS.length;
    if (nextStep === 0) { setStepAnnouncement('Step 0 of 2: Choose pharmacy size'); return; }
    const { label } = STEPS[nextStep - 1];
    setStepAnnouncement(`Step ${nextStep} of ${total}: ${label}`);
  };

  // P-CNV12: NPPES NPI verification (fail-open — never block submission)
  const verifyNpi = async (npi: string) => {
    if (!/^\d{10}$/.test(npi)) { setNpiStatus('invalid'); markValid('npiNumber', false); return; }
    setNpiStatus('checking');
    try {
      const res = await fetch(`https://npiregistry.cms.hhs.gov/api/?number=${npi}&version=2.1`);
      const data = await res.json();
      const isValid = data?.result_count > 0;
      setNpiStatus(isValid ? 'valid' : 'invalid');
      // P-CNV30: mark NPI valid on NPPES success
      markValid('npiNumber', isValid);
    } catch { setNpiStatus('idle'); } // fail-open on network error
  };

  const submit = async () => {
    // P-ONB46: gate on BAA acceptance
    if (!baaChecked) { setBaaError('You must agree to the Business Associate Agreement to continue.'); return; }
    setLoading(true);
    setError('');
    try {
      const body: Record<string, unknown> = { ...form, adminPassword: password, baaAccepted: true };
      if (npiNumber) body.npiNumber = npiNumber;
      if (orgSize) body.orgSize = orgSize;
      // P-CNV32: include referral param in POST body
      if (referredByOrgId) body.referredByOrgId = referredByOrgId;
      const resp = await api.post('/signup/pharmacy', body) as { tier?: string; referredByOrgName?: string };
      localStorage.removeItem(DRAFT_KEY);
      if (resp?.tier === 'auto_approve') setApprovalTier('auto_approve');
      if (resp?.referredByOrgName) setReferredByOrgName(resp.referredByOrgName);
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
          {/* P-CNV32: referral acknowledgment */}
          {referredByOrgName && (
            <p className="text-sm text-gray-600 bg-indigo-50 rounded-lg px-3 py-2 mb-2">
              You were referred by <strong>{referredByOrgName}</strong> — they&apos;ll be notified when you&apos;re approved.
            </p>
          )}
          {/* P-CNV15: tier-aware approval timeline */}
          {approvalTier === 'auto_approve' ? (
            <p className="text-green-700 text-sm font-medium bg-green-50 rounded-lg px-3 py-2 mb-5">
              Your NPI verified — your account is being approved automatically. Check your email at <strong>{form.adminEmail}</strong> in a few minutes.
            </p>
          ) : (
            <p className="text-gray-500 text-sm mb-5">
              Our team will review it and contact <strong>{form.adminEmail}</strong> within 2–4 business hours.
            </p>
          )}

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
      {/* P-CNV13: Trust block above form — drives conversion before first keystroke */}
      <div className="flex flex-col items-center w-full max-w-lg">
      <SignupTrustBlock />
      <div className="w-full bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
        <div className="flex items-center justify-between mb-6">
          <a href="/login" className="text-xs text-gray-400 hover:text-gray-600">← Back to sign in</a>
          {draftSaved && <span className="text-xs text-gray-400">Draft saved</span>}
        </div>

        {/* P-CNV10: draft restoration banner */}
        {draftRestored && (
          <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
            <p className="text-xs text-amber-700">Resuming your saved application.</p>
            <button
              onClick={() => {
                localStorage.removeItem(DRAFT_KEY);
                setForm(emptyForm);
                setDraftRestored(false);
              }}
              className="text-xs text-amber-600 hover:text-amber-800 font-medium underline-offset-2 hover:underline"
            >
              Start fresh
            </button>
          </div>
        )}
        {/* P-CNV25: rescue banner — amber nudge after 75s idle with email entered */}
        {showRescueBanner && (
          <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4" role="status" aria-live="polite">
            <p className="text-xs text-amber-800">Still deciding? Most pharmacies finish in under 3 minutes.</p>
            <button
              onClick={() => setShowRescueBanner(false)}
              className="ml-3 text-amber-500 hover:text-amber-700 shrink-0 text-sm leading-none"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        )}

        <h1 className="text-2xl font-bold text-[#0F4C81] mb-1" style={{ fontFamily: 'var(--font-sora)' }}>
          Join MyDashRx
        </h1>
        <p className="text-gray-500 text-sm mb-6">Set up your pharmacy account</p>

        {/* P-A11Y29: always-mounted step announcement region (WCAG 3.3.7 — WCAG 2.2) */}
        <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
          {stepAnnouncement}
        </div>
        <StepIndicator current={step} />

        {/* P-CNV24: Step 0 — role segmentation card-select */}
        {step === 0 && (
          <div>
            <p className="text-sm font-medium text-gray-700 mb-3">What best describes your pharmacy?</p>
            <div className="space-y-2 mb-6">
              {ORG_SIZE_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => { setOrgSize(opt.value); setStep(1); announceStep(1); }}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 text-left transition-all hover:border-[#0F4C81] hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F4C81] ${orgSize === opt.value ? 'border-[#0F4C81] bg-blue-50' : 'border-gray-200 bg-white'}`}
                  aria-pressed={orgSize === opt.value}
                >
                  <span className="text-2xl leading-none">{opt.icon}</span>
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{opt.label}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{opt.subtitle}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <div>
              <label htmlFor="signup-org-name" className="block text-sm font-medium text-gray-700 mb-1">Pharmacy name</label>
              {/* P-CNV30: relative wrapper + FieldCheck + onBlur markValid */}
              <div className="relative">
                <input id="signup-org-name" autoComplete="organization" value={form.orgName} onChange={set('orgName')}
                  onBlur={e => markValid('orgName', fieldValidators.orgName(e.target.value))}
                  placeholder="Greater Care Pharmacy"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 pr-8" />
                <FieldCheck field="orgName" validFields={validFields} />
              </div>
            </div>
            <div>
              <label htmlFor="signup-org-phone" className="block text-sm font-medium text-gray-700 mb-1">Phone number <span className="text-gray-400 font-normal">(optional)</span></label>
              <div className="relative">
                <input id="signup-org-phone" autoComplete="tel" value={form.orgPhone} onChange={set('orgPhone')}
                  onBlur={e => { if (e.target.value) markValid('orgPhone', fieldValidators.orgPhone(e.target.value)); }}
                  placeholder="(555) 000-0000"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 pr-8" />
                <FieldCheck field="orgPhone" validFields={validFields} />
              </div>
              <p className="text-xs text-gray-400 mt-1">You can add this in Settings after approval</p>
            </div>
            <div>
              <label htmlFor="signup-org-address" className="block text-sm font-medium text-gray-700 mb-1">Address <span className="text-gray-400 font-normal">(optional)</span></label>
              <div className="relative">
                <input id="signup-org-address" autoComplete="street-address" value={form.orgAddress} onChange={set('orgAddress')}
                  onBlur={e => { if (e.target.value) markValid('orgAddress', fieldValidators.orgAddress(e.target.value)); }}
                  placeholder="123 Main St, Detroit, MI 48201"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 pr-8" />
                <FieldCheck field="orgAddress" validFields={validFields} />
              </div>
              <p className="text-xs text-gray-400 mt-1">You can add this in Settings after approval</p>
            </div>
            {/* P-CNV12: NPI field with NPPES inline verification */}
            <div>
              <label htmlFor="signup-npi" className="block text-sm font-medium text-gray-700 mb-1">
                Pharmacy NPI <span className="text-gray-400 font-normal">(optional — speeds up approval)</span>
              </label>
              <div className="relative">
                <input
                  id="signup-npi"
                  value={npiNumber}
                  onChange={e => {
                    const next = e.target.value.replace(/\D/g, '').slice(0, 10);
                    setNpiNumber(next);
                    // P-A11Y29: only reset status if value actually changed (WCAG 3.3.7)
                    if (next !== prevNpiRef.current) { setNpiStatus('idle'); prevNpiRef.current = next; markValid('npiNumber', false); }
                  }}
                  onBlur={() => npiNumber && verifyNpi(npiNumber)}
                  placeholder="10-digit NPI number"
                  className={`w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 pr-24 ${npiStatus === 'valid' ? 'border-green-400 focus:ring-green-100' : npiStatus === 'invalid' ? 'border-red-300 focus:ring-red-100' : 'border-gray-200 focus:ring-blue-200'}`}
                />
                {npiStatus !== 'idle' && (
                  <span className={`absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium ${npiStatus === 'checking' ? 'text-gray-400' : npiStatus === 'valid' ? 'text-green-600' : 'text-red-500'}`}>
                    {npiStatus === 'checking' ? 'Verifying…' : npiStatus === 'valid' ? '✓ Verified' : '✗ Not found'}
                  </span>
                )}
              </div>
              {npiStatus === 'valid' && <p className="text-xs text-green-600 mt-1">NPI verified — eligible for faster approval</p>}
              {npiStatus === 'invalid' && <p className="text-xs text-red-500 mt-1">NPI not found in NPPES registry — you can still submit without it</p>}
            </div>
            <button
              onClick={() => { setStep(2); announceStep(2); }}
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
              <label htmlFor="signup-admin-name" className="block text-sm font-medium text-gray-700 mb-1">Your full name</label>
              {/* P-CNV30: FieldCheck on name */}
              <div className="relative">
                <input id="signup-admin-name" autoComplete="name" value={form.adminName} onChange={set('adminName')}
                  onBlur={e => markValid('adminName', fieldValidators.adminName(e.target.value))}
                  placeholder="Jane Smith"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 pr-8" />
                <FieldCheck field="adminName" validFields={validFields} />
              </div>
            </div>
            <div>
              <label htmlFor="signup-admin-email" className="block text-sm font-medium text-gray-700 mb-1">Work email</label>
              {/* P-CNV30: FieldCheck on email */}
              <div className="relative">
                <input
                  id="signup-admin-email"
                  type="email"
                  autoComplete="email"
                  value={form.adminEmail}
                  onChange={e => { set('adminEmail')(e); if (emailError) setEmailError(validateEmail(e.target.value)); }}
                  onBlur={e => {
                    setEmailError(validateEmail(e.target.value));
                    markValid('adminEmail', fieldValidators.adminEmail(e.target.value));
                    // P-CNV14: fire-and-forget intent capture for abandonment recovery
                    const val = e.target.value;
                    if (!validateEmail(val) && val) {
                      fetch(`${API_BASE}/api/v1/signup/pharmacy-intent`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ adminEmail: val, orgName: form.orgName }),
                      }).catch(() => {}); // totally fire-and-forget, silent fail
                    }
                  }}
                  placeholder="jane@yourpharmacy.com"
                  {...emailFE.inputProps}
                  className={`w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 pr-8 ${emailError ? 'border-red-300 focus:ring-red-100' : 'border-gray-200 focus:ring-blue-200'}`}
                />
                {!emailError && <FieldCheck field="adminEmail" validFields={validFields} />}
              </div>
              {/* P-A11Y20: always-in-DOM error region — opacity-0 not display:none so SR fires on insert */}
              <p {...emailFE.errorProps}>{emailError}</p>
            </div>
            {/* P-CNV30: Password field with strength bar */}
            <div>
              <label htmlFor="signup-admin-password" className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <div className="relative">
                <input
                  id="signup-admin-password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onBlur={e => markValid('adminPassword', fieldValidators.adminPassword(e.target.value))}
                  placeholder="Min. 8 characters"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 pr-8"
                />
                <FieldCheck field="adminPassword" validFields={validFields} />
              </div>
              <PasswordStrength value={password} />
            </div>

            {/* P-A11Y29: Mini-summary of Step 1 — aria-label for SR (WCAG 3.3.7 redundant entry) */}
            <div
              className="bg-gray-50 rounded-lg px-3 py-2 text-xs text-gray-500"
              aria-label={`Organization name: ${form.orgName}${form.orgPhone ? `, phone: ${form.orgPhone}` : ''}`}
            >
              <span className="font-medium text-gray-700">{form.orgName}</span>
              {form.orgPhone && <> · {form.orgPhone}</>}
            </div>

            {/* P-ONB46: BAA click-wrap consent — required before submission (HIPAA §164.308(b)(1)) */}
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-3">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={baaChecked}
                  onChange={e => { setBaaChecked(e.target.checked); if (e.target.checked) setBaaError(''); }}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#0F4C81] focus:ring-[#0F4C81]"
                  aria-describedby={baaError ? 'baa-error' : undefined}
                />
                <span className="text-xs text-gray-600 leading-relaxed">
                  I agree to the{' '}
                  <a href="/legal/baa" target="_blank" rel="noopener noreferrer" className="text-[#0F4C81] underline underline-offset-2">Business Associate Agreement</a>
                  {' '}and{' '}
                  <a href="/legal/terms" target="_blank" rel="noopener noreferrer" className="text-[#0F4C81] underline underline-offset-2">Terms of Service</a>
                  {' '}on behalf of <strong>{form.orgName || 'my pharmacy'}</strong>.
                </span>
              </label>
              {baaError && <p id="baa-error" className="mt-1.5 text-xs text-red-500" role="alert">{baaError}</p>}
            </div>

            {/* P-CNV11: actionable error display with sign-in/support links on 409 */}
            {error && (
              <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2.5">
                <p className="text-red-600 text-sm">{error}</p>
                {isDuplicateError(error) && (
                  <p className="text-xs text-red-500 mt-1.5">
                    Already submitted?{' '}
                    <a href="/login" className="font-medium underline hover:text-red-700">Sign in here</a>
                    {' '}or{' '}
                    <a href="mailto:support@mydashrx.com" className="font-medium underline hover:text-red-700">contact support</a>.
                  </p>
                )}
              </div>
            )}
            <div className="flex gap-3">
              <button onClick={() => { setStep(1); announceStep(1); }} className="flex-1 border border-gray-200 text-gray-600 rounded-lg py-2.5 text-sm font-medium hover:bg-gray-50 transition-colors">Back</button>
              <button
                onClick={submit}
                disabled={loading || !form.adminName.trim() || form.adminName.trim().length < 2 || !form.adminEmail || !!validateEmail(form.adminEmail) || password.length < 8}
                className="flex-1 bg-[#0F4C81] text-white rounded-lg py-2.5 text-sm font-medium hover:bg-[#0d3d69] disabled:opacity-40 transition-colors"
              >
                {loading ? 'Submitting…' : 'Submit application'}
              </button>
            </div>
          </div>
        )}
      </div>

      </div>
    </div>
  );
}

export default function PharmacySignupPage() {
  return (
    <Suspense>
      <PharmacySignupPageInner />
    </Suspense>
  );
}
