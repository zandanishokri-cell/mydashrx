'use client';
import { useRef, useState, useEffect, useCallback } from 'react';
import { X, AlertTriangle, Camera, CheckCircle2, RotateCcw, User, FileText, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { enqueueAction } from '@/lib/offline-queue';

interface Props {
  stopId: string;
  recipientNameHint?: string;
  isOnline?: boolean;
  onClose: () => void;
  onSubmitted: () => void;
  onQueued?: () => void;
}

type Step = 1 | 2 | 3 | 4;

export function PodCaptureModal({ stopId, recipientNameHint, isOnline = true, onClose, onSubmitted, onQueued }: Props) {
  const [step, setStep] = useState<Step>(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Step 1
  const [recipientName, setRecipientName] = useState(recipientNameHint ?? '');
  const [isCS, setIsCS] = useState(false);

  // Step 2 — signature canvas
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);
  const [hasSig, setHasSig] = useState(false);
  const [sigPreview, setSigPreview] = useState<string | null>(null);

  // Step 3 — ID
  const idInputRef = useRef<HTMLInputElement>(null);
  const [idPhotoDataUrl, setIdPhotoDataUrl] = useState<string | null>(null);
  const [dobConfirmed, setDobConfirmed] = useState(false);
  const [mapsConfirmed, setMapsConfirmed] = useState(false);

  // Check if stop is CS on mount
  useEffect(() => {
    api.get<{ required: boolean }>(`/driver/me/stops/${stopId}/cs-required`)
      .then(r => { if (r.required) setIsCS(true); })
      .catch(() => null);
  }, [stopId]);

  // ── Canvas helpers ────────────────────────────────────────────────────────
  const getPos = (e: React.MouseEvent | React.TouchEvent): { x: number; y: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if ('touches' in e) {
      const t = e.touches[0];
      return { x: (t.clientX - rect.left) * scaleX, y: (t.clientY - rect.top) * scaleY };
    }
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  };

  const startDraw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    drawing.current = true;
    lastPos.current = getPos(e);
  }, []);

  const draw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    if (!drawing.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) return;
    const pos = getPos(e);
    if (!pos || !lastPos.current) return;
    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    lastPos.current = pos;
    setHasSig(true);
  }, []);

  const stopDraw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    drawing.current = false;
    lastPos.current = null;
  }, []);

  const clearSig = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (ctx && canvas) { ctx.clearRect(0, 0, canvas.width, canvas.height); setHasSig(false); }
  };

  // ── ID photo ─────────────────────────────────────────────────────────────
  const handleIdPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setIdPhotoDataUrl(ev.target?.result as string ?? null);
    reader.readAsDataURL(file);
  };

  // ── Submit ────────────────────────────────────────────────────────────────
  const submit = async () => {
    setSubmitting(true);
    setError('');
    const signatureData = sigPreview ?? canvasRef.current?.toDataURL('image/png') ?? undefined;
    const podPayload = {
      packageCount: 1,
      recipientName,
      isControlledSubstance: isCS,
      signatureData,
      idPhotoUrl: idPhotoDataUrl ?? undefined,
      idVerified: isCS ? (!!idPhotoDataUrl && dobConfirmed) : false,
      idDobConfirmed: dobConfirmed,
      deliveryNotes: '',
    };

    if (!isOnline) {
      try {
        await enqueueAction({ type: 'pod_submit', stopId, payload: podPayload });
        onQueued?.();
      } catch {
        setError('Failed to save offline');
        setSubmitting(false);
      }
      return;
    }

    try {
      await api.post(`/driver/me/stops/${stopId}/pod`, podPayload);
      onSubmitted();
    } catch (err: any) {
      setError(err?.message ?? 'Submission failed');
      setSubmitting(false);
    }
  };

  const canAdvanceStep1 = recipientName.trim().length > 0;
  const canAdvanceStep2 = hasSig;
  const canAdvanceStep3 = !isCS || (!!idPhotoDataUrl && dobConfirmed && mapsConfirmed);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60">
      <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100 shrink-0">
          <div>
            <h2 className="font-bold text-gray-900 text-lg">Proof of Delivery</h2>
            <p className="text-xs text-gray-400 mt-0.5">Step {step} of {isCS ? 4 : 3}</p>
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100 min-h-[44px] min-w-[44px] flex items-center justify-center">
            <X size={20} />
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex gap-1.5 px-5 py-3 shrink-0">
          {([1, 2, ...(isCS ? [3, 4] : [3])] as Step[]).map((s, i) => (
            <div key={s} className={`h-1.5 flex-1 rounded-full transition-colors ${step > i + 1 ? 'bg-green-500' : step === i + 1 ? 'bg-[#0F4C81]' : 'bg-gray-200'}`} />
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-5">
          {/* ── STEP 1: Recipient ─────────────────────────────────────── */}
          {step === 1 && (
            <div className="space-y-4 pt-2">
              <div className="flex items-center gap-2 mb-1">
                <User size={18} className="text-[#0F4C81]" />
                <h3 className="font-semibold text-gray-800">Recipient Confirmation</h3>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Who received the delivery?</label>
                <input
                  value={recipientName}
                  onChange={e => setRecipientName(e.target.value)}
                  placeholder="Full name of recipient"
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-[#0F4C81]/20 focus:border-[#0F4C81]"
                  autoFocus
                />
              </div>
              <label className="flex items-start gap-3 cursor-pointer bg-orange-50 border border-orange-200 rounded-xl p-4">
                <input
                  type="checkbox"
                  checked={isCS}
                  onChange={e => setIsCS(e.target.checked)}
                  className="mt-0.5 w-5 h-5 rounded accent-orange-500"
                />
                <div>
                  <span className="font-medium text-orange-800 text-sm">Controlled substance delivery</span>
                  <p className="text-xs text-orange-600 mt-0.5">Photo ID verification required by Michigan law</p>
                </div>
              </label>
            </div>
          )}

          {/* ── STEP 2: Signature ────────────────────────────────────── */}
          {step === 2 && (
            <div className="space-y-3 pt-2">
              <div className="flex items-center gap-2 mb-1">
                <FileText size={18} className="text-[#0F4C81]" />
                <h3 className="font-semibold text-gray-800">Recipient Signature</h3>
              </div>
              <p className="text-sm text-gray-500">Ask {recipientName || 'the recipient'} to sign below</p>
              <div className="border-2 border-dashed border-gray-300 rounded-2xl overflow-hidden bg-gray-50 touch-none select-none">
                <canvas
                  ref={canvasRef}
                  width={600}
                  height={220}
                  className="w-full cursor-crosshair"
                  onMouseDown={startDraw}
                  onMouseMove={draw}
                  onMouseUp={stopDraw}
                  onMouseLeave={stopDraw}
                  onTouchStart={startDraw}
                  onTouchMove={draw}
                  onTouchEnd={stopDraw}
                />
              </div>
              {!hasSig && (
                <p className="text-center text-xs text-gray-400">Draw signature above</p>
              )}
              <button
                onClick={clearSig}
                className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mx-auto"
              >
                <RotateCcw size={14} /> Clear signature
              </button>
            </div>
          )}

          {/* ── STEP 3: ID Verification (CS only) ───────────────────── */}
          {step === 3 && isCS && (
            <div className="space-y-4 pt-2">
              <div className="bg-orange-50 border border-orange-300 rounded-2xl p-4">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle size={20} className="text-orange-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold text-orange-800 text-sm">Michigan Law — Photo ID Required</p>
                    <p className="text-xs text-orange-700 mt-1">R 338.3162 — Government-issued photo ID with date of birth required for controlled substance deliveries.</p>
                  </div>
                </div>
              </div>

              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">Photograph the recipient&apos;s government-issued ID</p>
                {idPhotoDataUrl ? (
                  <div>
                    <img src={idPhotoDataUrl} alt="ID" className="w-full rounded-xl object-cover max-h-40 border border-gray-200" />
                    <button
                      onClick={() => idInputRef.current?.click()}
                      className="mt-2 w-full border border-gray-200 rounded-xl py-2.5 text-sm text-gray-600 hover:bg-gray-50 flex items-center justify-center gap-2"
                    >
                      <Camera size={14} /> Retake ID photo
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => idInputRef.current?.click()}
                    className="w-full bg-[#0F4C81] text-white py-3.5 rounded-xl font-semibold flex items-center justify-center gap-2 min-h-[56px]"
                  >
                    <Camera size={18} /> Capture ID Photo
                  </button>
                )}
                <input
                  ref={idInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={handleIdPhoto}
                />
              </div>

              <label className="flex items-start gap-3 cursor-pointer bg-gray-50 border border-gray-200 rounded-xl p-4">
                <input
                  type="checkbox"
                  checked={dobConfirmed}
                  onChange={e => setDobConfirmed(e.target.checked)}
                  className="mt-0.5 w-5 h-5 rounded accent-[#0F4C81]"
                />
                <span className="text-sm text-gray-700">I have verified the recipient&apos;s date of birth matches the ID</span>
              </label>

              <label className="flex items-start gap-3 cursor-pointer bg-gray-50 border border-gray-200 rounded-xl p-4">
                <input
                  type="checkbox"
                  checked={mapsConfirmed}
                  onChange={e => setMapsConfirmed(e.target.checked)}
                  className="mt-0.5 w-5 h-5 rounded accent-[#0F4C81]"
                />
                <span className="text-sm text-gray-700">Patient identifiers submitted to MAPS (Michigan Automated Prescription System)</span>
              </label>
            </div>
          )}

          {/* ── STEP 3 (non-CS) / STEP 4 (CS): Confirmation ────────── */}
          {((step === 3 && !isCS) || (step === 4 && isCS)) && (
            <div className="space-y-4 pt-2">
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle2 size={18} className="text-green-600" />
                <h3 className="font-semibold text-gray-800">Confirm &amp; Submit</h3>
              </div>

              <div className="bg-gray-50 rounded-2xl p-4 space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Recipient</span>
                  <span className="font-medium text-gray-800">{recipientName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Signature</span>
                  <span className="font-medium text-green-600 flex items-center gap-1"><CheckCircle2 size={13} /> Captured</span>
                </div>
                {isCS && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-gray-500">ID Photo</span>
                      <span className={`font-medium flex items-center gap-1 ${idPhotoDataUrl ? 'text-green-600' : 'text-red-500'}`}>
                        {idPhotoDataUrl ? <><CheckCircle2 size={13} /> Captured</> : 'Missing'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">DOB Verified</span>
                      <span className={`font-medium flex items-center gap-1 ${dobConfirmed ? 'text-green-600' : 'text-red-500'}`}>
                        {dobConfirmed ? <><CheckCircle2 size={13} /> Confirmed</> : 'Not confirmed'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-500">Type</span>
                      <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                        <AlertTriangle size={10} /> Controlled Substance
                      </span>
                    </div>
                  </>
                )}
              </div>

              {/* Signature preview */}
              {sigPreview && (
                <div>
                  <p className="text-xs text-gray-400 mb-1.5">Signature preview</p>
                  <div className="border border-gray-200 rounded-xl overflow-hidden bg-gray-50 p-2">
                    <img src={sigPreview} alt="Signature" className="w-full max-h-20 object-contain" />
                  </div>
                </div>
              )}

              {error && <div className="bg-red-50 text-red-600 rounded-xl px-4 py-3 text-sm">{error}</div>}
            </div>
          )}
        </div>

        {/* Footer nav */}
        <div className="px-5 pb-6 pt-3 border-t border-gray-100 shrink-0 space-y-2">
          {step === 1 && (
            <button
              disabled={!canAdvanceStep1}
              onClick={() => setStep(2)}
              className="w-full bg-[#0F4C81] text-white py-4 rounded-2xl font-bold text-base disabled:opacity-40 min-h-[56px]"
            >
              Next: Signature
            </button>
          )}
          {step === 2 && (
            <div className="flex gap-2">
              <button onClick={() => setStep(1)} className="flex-1 border border-gray-200 text-gray-600 py-4 rounded-2xl font-semibold min-h-[56px]">Back</button>
              <button
                disabled={!canAdvanceStep2}
                onClick={() => {
                  setSigPreview(canvasRef.current?.toDataURL('image/png') ?? null);
                  setStep(isCS ? 3 : (3 as Step));
                }}
                className="flex-1 bg-[#0F4C81] text-white py-4 rounded-2xl font-bold disabled:opacity-40 min-h-[56px]"
              >
                Next{isCS ? ': ID Check' : ': Review'}
              </button>
            </div>
          )}
          {step === 3 && isCS && (
            <div className="flex gap-2">
              <button onClick={() => setStep(2)} className="flex-1 border border-gray-200 text-gray-600 py-4 rounded-2xl font-semibold min-h-[56px]">Back</button>
              <button
                disabled={!canAdvanceStep3}
                onClick={() => setStep(4)}
                className="flex-1 bg-[#0F4C81] text-white py-4 rounded-2xl font-bold disabled:opacity-40 min-h-[56px]"
              >
                Next: Review
              </button>
            </div>
          )}
          {((step === 3 && !isCS) || (step === 4 && isCS)) && (
            <div className="flex gap-2">
              <button onClick={() => setStep(isCS ? 3 : 2)} className="flex-1 border border-gray-200 text-gray-600 py-4 rounded-2xl font-semibold min-h-[56px]">Back</button>
              <button
                disabled={submitting}
                onClick={submit}
                className="flex-1 bg-green-500 text-white py-4 rounded-2xl font-bold disabled:opacity-40 min-h-[56px] flex items-center justify-center gap-2"
              >
                <ShieldCheck size={18} /> {submitting ? 'Saving…' : isOnline ? 'Submit Delivery' : 'Save Offline'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
