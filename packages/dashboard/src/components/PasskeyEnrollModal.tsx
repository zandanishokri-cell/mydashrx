'use client';
// P-ML18: Post-magic-link passkey enrollment prompt
// Shown once after magic link verify (localStorage guard mdrx_passkey_enrolled).
// HIPAA NIST SP 800-63B rev4 AAL2 — satisfies §164.312(d) Person Authentication.
import { useState } from 'react';
import { startRegistration } from '@simplewebauthn/browser';
import { api } from '@/lib/api';

interface PasskeyEnrollModalProps {
  onDone: () => void;
}

export function PasskeyEnrollModal({ onDone }: PasskeyEnrollModalProps) {
  const [step, setStep] = useState<'prompt' | 'enrolling' | 'success' | 'error'>('prompt');
  const [errorMsg, setErrorMsg] = useState('');

  const enroll = async () => {
    setStep('enrolling');
    try {
      const options = await api.post<any>('/auth/passkey/register/options', {});
      const regResponse = await startRegistration({ optionsJSON: options });
      await api.post('/auth/passkey/register/verify', { response: regResponse });
      localStorage.setItem('mdrx_passkey_enrolled', '1');
      setStep('success');
      setTimeout(onDone, 1800);
    } catch (err: unknown) {
      const msg = (err as Error)?.message ?? '';
      // User cancelled — treat as skip, not error
      if (msg.includes('cancelled') || msg.includes('abort') || msg.includes('NotAllowed')) {
        handleSkip();
        return;
      }
      setErrorMsg(msg || 'Passkey setup failed. Try again or skip for now.');
      setStep('error');
    }
  };

  const handleSkip = () => {
    localStorage.setItem('mdrx_passkey_prompt_shown', '1');
    onDone();
  };

  if (step === 'success') {
    return (
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-8 text-center">
          <div className="w-14 h-14 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Face ID / Touch ID enabled</h2>
          <p className="text-gray-500 text-sm">Sign in instantly next time — no email needed.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-8">
        {/* Icon */}
        <div className="w-14 h-14 bg-[#0F4C81]/10 rounded-full flex items-center justify-center mx-auto mb-5">
          <svg className="w-7 h-7 text-[#0F4C81]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
          </svg>
        </div>

        <h2 className="text-xl font-bold text-gray-900 text-center mb-2">Sign in faster next time</h2>
        <p className="text-gray-500 text-sm text-center mb-5">
          Set up Face ID or Touch ID and skip the email link on this device.
          <span className="block mt-1 text-xs text-gray-400">HIPAA AAL2 compliant · §164.312(d)</span>
        </p>

        {step === 'error' && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-red-700 text-sm">
            {errorMsg}
          </div>
        )}

        <div className="space-y-3">
          <button
            onClick={enroll}
            disabled={step === 'enrolling'}
            className="w-full bg-[#0F4C81] text-white rounded-xl py-3 text-sm font-semibold hover:bg-[#0d3d69] disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            {step === 'enrolling' ? (
              <>
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Setting up…
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
                </svg>
                Set up Face ID / Touch ID
              </>
            )}
          </button>
          <button
            onClick={handleSkip}
            className="w-full text-gray-400 hover:text-gray-600 text-sm py-2 transition-colors"
          >
            Not now — I'll use email links
          </button>
        </div>
      </div>
    </div>
  );
}
