'use client';
import { useRef, useState, useEffect, useCallback } from 'react';
import { X, AlertTriangle, Camera, CheckCircle2, RotateCcw, User, FileText, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { enqueueAction } from '@/lib/offline-queue';

interface Props {
  stopId: string;
  recipientNameHint?: string;
  requiresPhoto?: boolean;
  packageCount?: number;
  codAmount?: number;
  isOnline?: boolean;
  onClose: () => void;
  onSubmitted: () => void;
  onQueued?: () => void;
}

export function PodCaptureModal({ stopId, recipientNameHint, requiresPhoto, packageCount, codAmount, isOnline = true, onClose, onSubmitted, onQueued }: Props) {
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Step: recipient
  const [recipientName, setRecipientName] = useState(recipientNameHint ?? '');
  const [isCS, setIsCS] = useState(false);

  // Step: signature canvas
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);
  const [hasSig, setHasSig] = useState(false);
  const [sigPreview, setSigPreview] = useState<string | null>(null);

  // Step: delivery photo
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [deliveryPhotoDataUrl, setDeliveryPhotoDataUrl] = useState<string | null>(null);

  // Step: ID verification
  const idInputRef = useRef<HTMLInputElement>(null);
  const [idPhotoDataUrl, setIdPhotoDataUrl] = useState<string | null>(null);
  const [dobConfirmed, setDobConfirmed] = useState(false);
  const [mapsConfirmed, setMapsConfirmed] = useState(false);

  // Step: COD
  const [codMethod, setCodMethod] = useState<'cash' | 'check' | ''>('');
  const [codAmountConfirmed, setCodAmountConfirmed] = useState(String(codAmount ?? ''));
  const [codNote, setCodNote] = useState('');

  // Step: package count (in review)
  const [confirmedPackageCount, setConfirmedPackageCount] = useState(packageCount ?? 1);

  // Build ordered step list based on stop flags
  const steps: string[] = ['recipient', 'signature'];
  if (requiresPhoto) steps.push('photo');
  if (isCS) steps.push('id');
  if ((codAmount ?? 0) > 0) steps.push('cod');
  steps.push('review');

  const totalSteps = steps.length;
  const currentStepName = steps[step - 1];
  const isLastStep = step === totalSteps;

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

  // ── Photo handlers ────────────────────────────────────────────────────────
  const handleIdPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setIdPhotoDataUrl(ev.target?.result as string ?? null);
    reader.readAsDataURL(file);
  };

  const handleDeliveryPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setDeliveryPhotoDataUrl(ev.target?.result as string ?? null);
    reader.readAsDataURL(file);
  };

  // ── Step advance guard ────────────────────────────────────────────────────
  const canAdvance = (() => {
    switch (currentStepName) {
      case 'recipient': return recipientName.trim().length > 0;
      case 'signature': return hasSig;
      case 'photo': return !!deliveryPhotoDataUrl;
      case 'id': return !!idPhotoDataUrl && dobConfirmed && mapsConfirmed;
      case 'cod': return codMethod !== '' && parseFloat(codAmountConfirmed) > 0;
      default: return true;
    }
  })();

  const nextStepLabel = (() => {
    const next = steps[step]; // step is 1-based, so steps[step] is the *next* step name
    if (!next) return '';
    const labels: Record<string, string> = { signature: 'Signature', photo: 'Delivery Photo', id: 'ID Check', cod: 'COD Collection', review: 'Review' };
    return `Next: ${labels[next] ?? 'Continue'}`;
  })();

  const advance = () => {
    if (currentStepName === 'signature') setSigPreview(canvasRef.current?.toDataURL('image/png') ?? null);
    setStep(s => s + 1);
  };

  // ── Submit ────────────────────────────────────────────────────────────────
  const submit = async () => {
    setSubmitting(true);
    setError('');
    const signatureData = sigPreview ?? canvasRef.current?.toDataURL('image/png') ?? undefined;
    const podPayload = {
      packageCount: confirmedPackageCount,
      recipientName,
      isControlledSubstance: isCS,
      signatureData,
      idPhotoUrl: idPhotoDataUrl ?? undefined,
      idVerified: isCS ? (!!idPhotoDataUrl && dobConfirmed) : false,
      idDobConfirmed: dobConfirmed,
      deliveryNotes: '',
      ...(codAmount && codMethod ? {
        codCollected: {
          amount: parseFloat(codAmountConfirmed) || codAmount,
          method: codMethod,
          note: codNote.trim() || undefined,
        }
      } : {}),
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
      // Upload delivery photo (non-fatal)
      if (deliveryPhotoDataUrl) {
        try {
          const blob = await (await fetch(deliveryPhotoDataUrl)).blob();
          const formData = new FormData();
          formData.append('file', blob, 'delivery.jpg');
          await api.upload(`/driver/me/stops/${stopId}/pod/photo`, formData);
        } catch { /* non-fatal */ }
      }
      onSubmitted();
    } catch {
      setError('Submission failed. Please try again.');
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60">
      <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100 shrink-0">
          <div>
            <h2 className="font-bold text-gray-900 text-lg">Proof of Delivery</h2>
            <p className="text-xs text-gray-400 mt-0.5">Step {step} of {totalSteps}</p>
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100 min-h-[44px] min-w-[44px] flex items-center justify-center">
            <X size={20} />
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex gap-1.5 px-5 py-3 shrink-0">
          {steps.map((_, i) => (
            <div key={i} className={`h-1.5 flex-1 rounded-full transition-colors ${step > i + 1 ? 'bg-green-500' : step === i + 1 ? 'bg-[#0F4C81]' : 'bg-gray-200'}`} />
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-5">
          {/* ── STEP: Recipient ───────────────────────────────────────── */}
          {currentStepName === 'recipient' && (
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

          {/* ── STEP: Signature ────────────────────────────────────────── */}
          {currentStepName === 'signature' && (
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
              {!hasSig && <p className="text-center text-xs text-gray-400">Draw signature above</p>}
              <button onClick={clearSig} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mx-auto">
                <RotateCcw size={14} /> Clear signature
              </button>
            </div>
          )}

          {/* ── STEP: Delivery Photo ──────────────────────────────────── */}
          {currentStepName === 'photo' && (
            <div className="space-y-4 pt-2">
              <div className="flex items-center gap-2 mb-1">
                <Camera size={18} className="text-[#0F4C81]" />
                <h3 className="font-semibold text-gray-800">Delivery Photo</h3>
              </div>
              <p className="text-sm text-gray-500">Take a photo showing the delivered package(s) at the door or drop location.</p>
              {deliveryPhotoDataUrl ? (
                <div>
                  <img src={deliveryPhotoDataUrl} alt="Delivery" className="w-full rounded-xl object-cover max-h-48 border border-gray-200" />
                  <button
                    onClick={() => photoInputRef.current?.click()}
                    className="mt-2 w-full border border-gray-200 rounded-xl py-2.5 text-sm text-gray-600 hover:bg-gray-50 flex items-center justify-center gap-2"
                  >
                    <Camera size={14} /> Retake photo
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => photoInputRef.current?.click()}
                  className="w-full bg-[#0F4C81] text-white py-3.5 rounded-xl font-semibold flex items-center justify-center gap-2 min-h-[56px]"
                >
                  <Camera size={18} /> Capture Delivery Photo
                </button>
              )}
              <input ref={photoInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleDeliveryPhoto} />
            </div>
          )}

          {/* ── STEP: ID Verification (CS only) ───────────────────────── */}
          {currentStepName === 'id' && (
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
                <input ref={idInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleIdPhoto} />
              </div>
              <label className="flex items-start gap-3 cursor-pointer bg-gray-50 border border-gray-200 rounded-xl p-4">
                <input type="checkbox" checked={dobConfirmed} onChange={e => setDobConfirmed(e.target.checked)} className="mt-0.5 w-5 h-5 rounded accent-[#0F4C81]" />
                <span className="text-sm text-gray-700">I have verified the recipient&apos;s date of birth matches the ID</span>
              </label>
              <label className="flex items-start gap-3 cursor-pointer bg-gray-50 border border-gray-200 rounded-xl p-4">
                <input type="checkbox" checked={mapsConfirmed} onChange={e => setMapsConfirmed(e.target.checked)} className="mt-0.5 w-5 h-5 rounded accent-[#0F4C81]" />
                <span className="text-sm text-gray-700">Patient identifiers submitted to MAPS (Michigan Automated Prescription System)</span>
              </label>
            </div>
          )}

          {/* ── STEP: COD Collection ─────────────────────────────────── */}
          {currentStepName === 'cod' && (
            <div className="space-y-4 pt-2">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg">💵</span>
                <h3 className="font-semibold text-gray-800">Cash on Delivery</h3>
              </div>
              <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
                <p className="text-sm font-semibold text-yellow-800">Amount Due: <span className="text-lg">${codAmount?.toFixed(2)}</span></p>
                <p className="text-xs text-yellow-600 mt-1">Collect payment before handing over the package</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Payment method received</label>
                <div className="grid grid-cols-2 gap-2">
                  {(['cash', 'check'] as const).map(m => (
                    <button
                      key={m}
                      onClick={() => setCodMethod(m)}
                      className={`py-3 rounded-xl text-sm font-semibold border-2 capitalize transition-colors ${codMethod === m ? 'border-[#0F4C81] bg-[#0F4C81] text-white' : 'border-gray-200 text-gray-600'}`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Amount collected ($)</label>
                <input
                  type="number"
                  step="0.01"
                  value={codAmountConfirmed}
                  onChange={e => setCodAmountConfirmed(e.target.value)}
                  placeholder={String(codAmount ?? '')}
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-[#0F4C81]/20"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Note (optional)</label>
                <input
                  value={codNote}
                  onChange={e => setCodNote(e.target.value)}
                  placeholder="e.g. Patient gave exact change"
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F4C81]/20"
                />
              </div>
            </div>
          )}

          {/* ── STEP: Review + Submit ─────────────────────────────────── */}
          {currentStepName === 'review' && (
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
                {requiresPhoto && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Delivery Photo</span>
                    <span className={`font-medium flex items-center gap-1 ${deliveryPhotoDataUrl ? 'text-green-600' : 'text-amber-500'}`}>
                      {deliveryPhotoDataUrl ? <><CheckCircle2 size={13} /> Captured</> : 'Skipped'}
                    </span>
                  </div>
                )}
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
                {(codAmount ?? 0) > 0 && codMethod && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">COD Collected</span>
                    <span className="font-medium text-green-600 flex items-center gap-1">
                      <CheckCircle2 size={13} /> ${parseFloat(codAmountConfirmed || '0').toFixed(2)} ({codMethod})
                    </span>
                  </div>
                )}
                {/* Package count stepper */}
                <div className="flex justify-between items-center">
                  <span className="text-gray-500">Packages delivered</span>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setConfirmedPackageCount(c => Math.max(1, c - 1))}
                      className="w-8 h-8 rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50 flex items-center justify-center font-bold"
                    >
                      −
                    </button>
                    <span className="text-sm font-bold text-gray-900 w-6 text-center">{confirmedPackageCount}</span>
                    <button
                      onClick={() => setConfirmedPackageCount(c => c + 1)}
                      className="w-8 h-8 rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50 flex items-center justify-center font-bold"
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>

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
          <div className="flex gap-2">
            {step > 1 && (
              <button onClick={() => setStep(s => s - 1)} className="flex-1 border border-gray-200 text-gray-600 py-4 rounded-2xl font-semibold min-h-[56px]">
                Back
              </button>
            )}
            {isLastStep ? (
              <button
                disabled={submitting}
                onClick={submit}
                className="flex-1 bg-green-500 text-white py-4 rounded-2xl font-bold disabled:opacity-40 min-h-[56px] flex items-center justify-center gap-2"
              >
                <ShieldCheck size={18} /> {submitting ? 'Saving…' : isOnline ? 'Submit Delivery' : 'Save Offline'}
              </button>
            ) : (
              <button
                disabled={!canAdvance}
                onClick={advance}
                className={`flex-1 bg-[#0F4C81] text-white py-4 rounded-2xl font-bold disabled:opacity-40 min-h-[56px] ${step === 1 ? 'w-full' : ''}`}
              >
                {nextStepLabel}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
