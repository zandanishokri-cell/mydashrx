'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { PodCaptureModal } from '@/components/PodCaptureModal';
import { ArrowLeft, Phone, MapPin, Package, Camera, CheckCircle2, XCircle, Clock, AlertTriangle, Thermometer, PenLine, Upload } from 'lucide-react';

interface Stop {
  id: string; routeId: string; recipientName: string; address: string;
  recipientPhone: string; status: string; sequenceNumber: number | null;
  requiresRefrigeration: boolean; controlledSubstance: boolean;
  requiresSignature: boolean; requiresPhoto: boolean; requiresAgeVerification: boolean;
  rxNumbers: string[]; packageCount: number; deliveryNotes?: string;
  codAmount?: number; arrivedAt?: string; completedAt?: string;
  failureReason?: string; failureNote?: string;
}

const FAILURE_REASONS = [
  'Not home', 'Refused delivery', 'Wrong address',
  'No safe drop location', 'ID required not present', 'Signature required not present', 'Other',
];

export default function StopDetailPage({ params }: { params: { stopId: string } }) {
  const router = useRouter();
  const { stopId } = params;
  const [stop, setStop] = useState<Stop | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [failureReason, setFailureReason] = useState('');
  const [failureNote, setFailureNote] = useState('');
  const [showFailure, setShowFailure] = useState(false);
  const [showPodModal, setShowPodModal] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.get<Stop>(`/driver/me/stops/${stopId}`)
      .then(setStop)
      .catch(() => {
        // Fallback: fetch from generic stops if driver endpoint fails
        setError('Could not load stop');
      })
      .finally(() => setLoading(false));

    // Load existing photo
    api.get<{ photos: Array<{ url: string }> }>(`/driver/me/stops/${stopId}/pod`)
      .then(pod => { if (pod.photos?.length) setPhotoUrl(pod.photos[pod.photos.length - 1].url); })
      .catch(() => null);
  }, [stopId]);

  const updateStatus = async (status: string) => {
    if (!stop) return;
    setSaving(true);
    setError('');
    try {
      const body: Record<string, unknown> = { status };
      if (status === 'failed') { body.failureReason = failureReason; body.failureNote = failureNote; }
      const updated = await api.patch<Stop>(`/driver/me/stops/${stopId}/status`, body);
      setStop(updated);
      setSuccess(status === 'completed' ? 'Delivery marked complete!' : status === 'arrived' ? 'Marked as arrived' : 'Status updated');
      if (status === 'completed' || status === 'failed') {
        setTimeout(() => router.back(), 1500);
      }
    } catch (err: any) {
      setError(err?.message ?? 'Failed to update');
    } finally {
      setSaving(false);
    }
  };

  const uploadPhoto = async (file: File) => {
    setUploading(true);
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      const token = localStorage.getItem('accessToken');
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/api/v1/driver/me/stops/${stopId}/photo`,
        { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form },
      );
      if (!res.ok) throw new Error('Upload failed');
      const data = await res.json();
      setPhotoUrl(data.url);
      setSuccess('Photo uploaded!');
    } catch (err: any) {
      setError(err?.message ?? 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadPhoto(file);
  };

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="animate-spin w-8 h-8 border-2 border-[#0F4C81] border-t-transparent rounded-full" />
    </div>
  );

  if (!stop) return (
    <div className="min-h-screen bg-gray-50 p-6">
      <button onClick={() => router.back()} className="flex items-center gap-2 text-gray-500 mb-4"><ArrowLeft size={16} /> Back</button>
      <div className="text-center py-12 text-red-500">Stop not found</div>
    </div>
  );

  const isDone = stop.status === 'completed' || stop.status === 'failed';

  return (
    <div className="min-h-screen bg-gray-50 pb-32">
      {/* Header */}
      <div className="bg-[#0F4C81] text-white px-5 pt-12 pb-5">
        <button onClick={() => router.back()} className="flex items-center gap-2 text-blue-200 mb-3 text-sm">
          <ArrowLeft size={16} /> Back to route
        </button>
        <h1 className="text-xl font-bold">{stop.recipientName}</h1>
        <p className="text-blue-200 text-sm mt-1 flex items-center gap-1">
          <MapPin size={12} /> {stop.address}
        </p>
      </div>

      <div className="px-4 py-4 space-y-4">
        {/* Package info */}
        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="flex items-center gap-2 text-gray-600">
              <Package size={14} className="text-gray-400" />
              <span>{stop.packageCount} package{stop.packageCount !== 1 ? 's' : ''}</span>
            </div>
            {stop.recipientPhone && (
              <a href={`tel:${stop.recipientPhone}`} className="flex items-center gap-2 text-[#0F4C81]">
                <Phone size={14} /> {stop.recipientPhone}
              </a>
            )}
            {stop.rxNumbers?.length > 0 && (
              <div className="col-span-2 text-xs text-gray-500">Rx: {stop.rxNumbers.join(', ')}</div>
            )}
          </div>

          {/* Flags */}
          <div className="flex flex-wrap gap-2 mt-3">
            {stop.requiresRefrigeration && (
              <span className="flex items-center gap-1 text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded-full">
                <Thermometer size={10} /> Cold chain
              </span>
            )}
            {stop.controlledSubstance && (
              <span className="flex items-center gap-1 text-xs bg-orange-50 text-orange-700 px-2 py-1 rounded-full">
                <AlertTriangle size={10} /> Controlled
              </span>
            )}
            {stop.requiresSignature && (
              <span className="flex items-center gap-1 text-xs bg-purple-50 text-purple-700 px-2 py-1 rounded-full">
                <PenLine size={10} /> Signature
              </span>
            )}
            {stop.codAmount && (
              <span className="text-xs bg-yellow-50 text-yellow-700 px-2 py-1 rounded-full">
                COD ${stop.codAmount}
              </span>
            )}
          </div>

          {stop.deliveryNotes && (
            <div className="mt-3 bg-yellow-50 rounded-xl px-3 py-2 text-sm text-yellow-800">
              <span className="font-medium">Note: </span>{stop.deliveryNotes}
            </div>
          )}
        </div>

        {/* Photo upload */}
        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <h3 className="font-semibold text-gray-800 mb-3 text-sm">Proof of Delivery Photo</h3>
          {photoUrl ? (
            <div className="relative">
              <img src={photoUrl} alt="POD" className="w-full rounded-xl object-cover max-h-48" />
              <button
                onClick={() => cameraRef.current?.click()}
                className="mt-2 w-full border border-gray-200 rounded-xl py-2 text-sm text-gray-500 hover:bg-gray-50 flex items-center justify-center gap-2"
              >
                <Camera size={14} /> Retake photo
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <button
                onClick={() => cameraRef.current?.click()}
                disabled={uploading}
                className="w-full bg-[#0F4C81] text-white py-3 rounded-xl font-medium flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Camera size={16} /> {uploading ? 'Uploading…' : 'Take Photo'}
              </button>
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="w-full border border-gray-200 text-gray-600 py-3 rounded-xl font-medium flex items-center justify-center gap-2 disabled:opacity-50 text-sm"
              >
                <Upload size={14} /> Upload from gallery
              </button>
            </div>
          )}
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileChange} />
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
        </div>

        {/* Status actions */}
        {!isDone && (
          <div className="bg-white rounded-2xl p-4 shadow-sm">
            <h3 className="font-semibold text-gray-800 mb-3 text-sm">Update Status</h3>
            <div className="space-y-2">
              {stop.status === 'pending' || stop.status === 'en_route' ? (
                <button
                  onClick={() => updateStatus('arrived')}
                  disabled={saving}
                  className="w-full bg-yellow-400 text-white py-3 rounded-xl font-semibold flex items-center justify-center gap-2 disabled:opacity-50 hover:bg-yellow-500 transition-colors"
                >
                  <Clock size={16} /> Mark Arrived
                </button>
              ) : null}

              <button
                onClick={() => setShowPodModal(true)}
                disabled={saving}
                className="w-full bg-green-500 text-white py-3 rounded-xl font-semibold flex items-center justify-center gap-2 disabled:opacity-50 hover:bg-green-600 transition-colors min-h-[56px]"
              >
                <CheckCircle2 size={16} /> Mark Delivered
              </button>

              <button
                onClick={() => setShowFailure(!showFailure)}
                className="w-full border border-red-200 text-red-500 py-3 rounded-xl font-semibold flex items-center justify-center gap-2 hover:bg-red-50 transition-colors"
              >
                <XCircle size={16} /> Failed Delivery
              </button>
            </div>

            {showFailure && (
              <div className="mt-3 space-y-2">
                <select
                  value={failureReason}
                  onChange={e => setFailureReason(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm"
                >
                  <option value="">Select reason…</option>
                  {FAILURE_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
                <input
                  value={failureNote}
                  onChange={e => setFailureNote(e.target.value)}
                  placeholder="Additional note (optional)"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm"
                />
                <button
                  onClick={() => updateStatus('failed')}
                  disabled={!failureReason || saving}
                  className="w-full bg-red-500 text-white py-3 rounded-xl font-semibold disabled:opacity-40"
                >
                  Confirm Failed
                </button>
              </div>
            )}
          </div>
        )}

        {isDone && (
          <div className={`rounded-2xl p-4 text-center ${stop.status === 'completed' ? 'bg-green-50' : 'bg-red-50'}`}>
            {stop.status === 'completed' ? (
              <><CheckCircle2 size={32} className="text-green-500 mx-auto mb-2" /><p className="font-semibold text-green-700">Delivery Complete</p></>
            ) : (
              <><XCircle size={32} className="text-red-400 mx-auto mb-2" /><p className="font-semibold text-red-600">Delivery Failed</p>{stop.failureReason && <p className="text-sm text-red-400 mt-1">{stop.failureReason}</p>}</>
            )}
          </div>
        )}

        {error && <div className="bg-red-50 text-red-600 rounded-xl px-4 py-3 text-sm">{error}</div>}
        {success && <div className="bg-green-50 text-green-700 rounded-xl px-4 py-3 text-sm font-medium">{success}</div>}

        {/* Navigate link */}
        <a
          href={`https://maps.google.com/?q=${encodeURIComponent(stop.address)}`}
          target="_blank" rel="noreferrer"
          className="w-full bg-gray-800 text-white py-3.5 rounded-2xl font-semibold flex items-center justify-center gap-2 hover:bg-gray-900 transition-colors"
        >
          <MapPin size={16} /> Open in Maps
        </a>
      </div>

      {showPodModal && stop && (
        <PodCaptureModal
          stopId={stop.id}
          recipientNameHint={stop.recipientName}
          onClose={() => setShowPodModal(false)}
          onSubmitted={() => {
            setShowPodModal(false);
            setSuccess('Delivery complete!');
            setStop({ ...stop, status: 'completed' });
            setTimeout(() => router.back(), 1500);
          }}
        />
      )}
    </div>
  );
}
