'use client';
import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { PodViewer } from '@/components/PodViewer';
import { Phone, MapPin, Package, Thermometer, AlertTriangle, PenLine, ClipboardList, Trash2, FileCheck } from 'lucide-react';

interface Stop {
  id: string;
  routeId: string;
  recipientName: string;
  address: string;
  recipientPhone: string;
  status: string;
  sequenceNumber: number | null;
  requiresRefrigeration: boolean;
  controlledSubstance: boolean;
  requiresSignature: boolean;
  requiresPhoto: boolean;
  rxNumbers: string[];
  packageCount: number;
  deliveryNotes?: string;
  codAmount?: number;
  trackingToken?: string;
  arrivedAt?: string;
  completedAt?: string;
  failureReason?: string;
  failureNote?: string;
}

interface Props {
  stop: Stop;
  onClose: () => void;
  onUpdated: () => void;
}

const STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: 'arrived', label: 'Arrived' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
];

const FAILURE_REASONS = [
  'Not home', 'Refused delivery', 'Wrong address', 'No safe drop location',
  'ID required not present', 'Signature required not present', 'Other',
];

export function StopDetailModal({ stop, onClose, onUpdated }: Props) {
  const [status, setStatus] = useState(stop.status);
  const [failureReason, setFailureReason] = useState(stop.failureReason ?? '');
  const [failureNote, setFailureNote] = useState(stop.failureNote ?? '');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');
  const [pod, setPod] = useState<Record<string, unknown> | null>(null);
  const [showPod, setShowPod] = useState(false);
  const [podLoading, setPodLoading] = useState(false);

  const loadPod = async () => {
    if (pod) { setShowPod(true); return; }
    setPodLoading(true);
    try {
      const data = await api.get<Record<string, unknown>>(`/stops/${stop.id}/pod`);
      setPod(data);
      setShowPod(true);
    } catch { setPod({}); setShowPod(true); }
    finally { setPodLoading(false); }
  };

  const dirty = status !== stop.status || failureReason !== (stop.failureReason ?? '') || failureNote !== (stop.failureNote ?? '');

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await api.patch(`/routes/${stop.routeId}/stops/${stop.id}/status`, {
        status,
        ...(status === 'failed' ? { failureReason, failureNote } : {}),
      });
      onUpdated();
    } catch {
      setError('Failed to update stop');
    } finally {
      setSaving(false);
    }
  };

  const deleteStop = async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      await api.del(`/routes/${stop.routeId}/stops/${stop.id}`);
      onUpdated();
    } catch {
      setError('Failed to delete stop');
      setDeleting(false);
    }
  };

  const trackingUrl = stop.trackingToken
    ? `${window.location.origin}/track/${stop.trackingToken}`
    : null;

  return (
    <Modal title={stop.recipientName} onClose={onClose} width="max-w-lg">
      <div className="space-y-5">
        {/* Info grid */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="flex items-start gap-2 text-gray-600">
            <MapPin size={14} className="mt-0.5 shrink-0 text-gray-400" />
            <span>{stop.address}</span>
          </div>
          <div className="flex items-center gap-2 text-gray-600">
            <Phone size={14} className="shrink-0 text-gray-400" />
            <span>{stop.recipientPhone || '—'}</span>
          </div>
          <div className="flex items-center gap-2 text-gray-600">
            <Package size={14} className="shrink-0 text-gray-400" />
            <span>{stop.packageCount} package{stop.packageCount !== 1 ? 's' : ''}</span>
          </div>
          {stop.rxNumbers?.length > 0 && (
            <div className="flex items-center gap-2 text-gray-600">
              <ClipboardList size={14} className="shrink-0 text-gray-400" />
              <span>Rx: {stop.rxNumbers.join(', ')}</span>
            </div>
          )}
        </div>

        {/* Flags */}
        <div className="flex flex-wrap gap-2">
          {stop.requiresRefrigeration && (
            <span className="flex items-center gap-1 text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded-full">
              <Thermometer size={11} /> Refrigeration Required
            </span>
          )}
          {stop.controlledSubstance && (
            <span className="flex items-center gap-1 text-xs bg-orange-50 text-orange-700 px-2 py-1 rounded-full">
              <AlertTriangle size={11} /> Controlled Substance
            </span>
          )}
          {stop.requiresSignature && (
            <span className="flex items-center gap-1 text-xs bg-purple-50 text-purple-700 px-2 py-1 rounded-full">
              <PenLine size={11} /> Signature Required
            </span>
          )}
          {stop.codAmount && (
            <span className="text-xs bg-yellow-50 text-yellow-700 px-2 py-1 rounded-full">
              COD ${stop.codAmount}
            </span>
          )}
        </div>

        {/* Notes */}
        {stop.deliveryNotes && (
          <div className="bg-gray-50 rounded-lg px-3 py-2 text-sm text-gray-600">
            <span className="font-medium text-gray-700">Notes: </span>{stop.deliveryNotes}
          </div>
        )}

        {/* Tracking link */}
        {trackingUrl && (
          <div className="bg-gray-50 rounded-lg px-3 py-2 text-sm">
            <span className="font-medium text-gray-700">Tracking: </span>
            <a href={trackingUrl} target="_blank" rel="noreferrer" className="text-[#0F4C81] hover:underline break-all">
              {trackingUrl}
            </a>
          </div>
        )}

        {/* Timestamps */}
        {(stop.arrivedAt || stop.completedAt) && (
          <div className="text-xs text-gray-400 space-y-1">
            {stop.arrivedAt && <div>Arrived: {new Date(stop.arrivedAt).toLocaleTimeString()}</div>}
            {stop.completedAt && <div>Completed: {new Date(stop.completedAt).toLocaleTimeString()}</div>}
          </div>
        )}

        {/* POD viewer for completed stops */}
        {stop.status === 'completed' && (
          <div>
            {!showPod ? (
              <Button variant="secondary" size="sm" onClick={loadPod} loading={podLoading} className="w-full flex items-center justify-center gap-1.5">
                <FileCheck size={14} /> View Proof of Delivery
              </Button>
            ) : pod && Object.keys(pod).length > 0 ? (
              <div className="border border-gray-100 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-semibold text-gray-800 text-sm flex items-center gap-1.5">
                    <FileCheck size={14} className="text-green-600" /> Proof of Delivery
                  </h4>
                  <button onClick={() => setShowPod(false)} className="text-xs text-gray-400 hover:text-gray-600">Hide</button>
                </div>
                <PodViewer pod={pod as any} />
              </div>
            ) : (
              <p className="text-xs text-gray-400 text-center py-2">No POD on file</p>
            )}
          </div>
        )}

        <hr className="border-gray-100" />

        {/* Status update */}
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
            <div className="flex gap-2 flex-wrap">
              {STATUS_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setStatus(opt.value)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                    status === opt.value
                      ? 'bg-[#0F4C81] text-white border-[#0F4C81]'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {status === 'failed' && (
            <div className="space-y-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Failure Reason</label>
                <select
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  value={failureReason}
                  onChange={(e) => setFailureReason(e.target.value)}
                >
                  <option value="">Select reason…</option>
                  {FAILURE_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Note (optional)</label>
                <input
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  value={failureNote}
                  onChange={(e) => setFailureNote(e.target.value)}
                  placeholder="Additional details…"
                />
              </div>
            </div>
          )}
        </div>

        {error && <p className="text-red-500 text-sm">{error}</p>}

        {confirmDelete && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-3 flex items-center justify-between">
            <span className="text-sm text-amber-800">Delete stop for <strong>{stop.recipientName}</strong>?</span>
            <div className="flex gap-2 ml-3 shrink-0">
              <button onClick={() => setConfirmDelete(false)} className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1">Cancel</button>
              <button onClick={deleteStop} disabled={deleting} className="text-xs bg-red-500 text-white px-3 py-1 rounded-md hover:bg-red-600 disabled:opacity-50">
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between pt-1">
          <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)} className="text-red-500 hover:bg-red-50">
            <Trash2 size={13} /> Delete Stop
          </Button>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={save} loading={saving} disabled={!dirty}>
              Save Changes
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
