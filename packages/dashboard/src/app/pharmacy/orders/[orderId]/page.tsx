'use client';
import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import {
  ArrowLeft, Package, CheckCircle2, XCircle, Clock, Truck,
  MapPin, Phone, User, Camera, FileText, AlertTriangle,
} from 'lucide-react';

interface OrderDetail {
  id: string;
  recipientName: string;
  recipientPhone: string;
  address: string;
  unit?: string;
  status: string;
  rxNumbers: string[];
  packageCount: number;
  requiresRefrigeration: boolean;
  controlledSubstance: boolean;
  requiresSignature: boolean;
  deliveryNotes?: string;
  failureReason?: string;
  failureNote?: string;
  arrivedAt?: string;
  completedAt?: string;
  createdAt: string;
  trackingToken: string;
  planDate?: string;
  planStatus?: string;
  driverName?: string;
  driverPhone?: string;
  driverStatus?: string;
  pod?: {
    packageCount: number;
    photos: string[];
    signature?: { svgData: string; signerName: string };
    ageVerification?: { verified: boolean; idType?: string };
    codCollected?: { amount: number; method: string };
    driverNote?: string;
    capturedAt: string;
  } | null;
}

const TIMELINE_STEPS = [
  { key: 'pending', label: 'Received', desc: 'Order submitted to pharmacy' },
  { key: 'en_route', label: 'Dispatched', desc: 'Driver assigned and en route' },
  { key: 'arrived', label: 'Out for Delivery', desc: 'Driver at delivery location' },
  { key: 'completed', label: 'Delivered', desc: 'Package delivered successfully' },
];
const STATUS_ORDER = ['pending', 'en_route', 'arrived', 'completed'];

const statusIcon = (s: string) => {
  if (s === 'completed') return <CheckCircle2 size={20} className="text-green-500" />;
  if (s === 'failed') return <XCircle size={20} className="text-red-400" />;
  if (s === 'arrived') return <Clock size={20} className="text-yellow-500" />;
  if (s === 'en_route') return <Truck size={20} className="text-blue-500" />;
  return <Package size={20} className="text-gray-300" />;
};

const fmt = (d: string) => new Date(d).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

export default function OrderDetailPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const router = useRouter();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<OrderDetail>(`/pharmacy/orders/${orderId}`)
      .then(setOrder)
      .catch(() => setError('Order not found'))
      .finally(() => setLoading(false));
  }, [orderId]);

  if (loading) return (
    <div className="p-5 space-y-4">
      {[1, 2, 3].map(i => <div key={i} className="h-28 bg-white rounded-2xl animate-pulse" />)}
    </div>
  );

  if (error || !order) return (
    <div className="p-5 text-center">
      <p className="text-gray-500 text-sm">{error || 'Order not found'}</p>
      <button onClick={() => router.back()} className="mt-3 text-sm text-[#0F4C81] font-medium">← Back to orders</button>
    </div>
  );

  const activeStep = order.status === 'failed' ? -1 : STATUS_ORDER.indexOf(order.status);

  return (
    <div className="p-4 md:p-5 space-y-4">
      {/* Back + header */}
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
          <ArrowLeft size={18} className="text-gray-500" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="font-bold text-gray-900 text-base truncate" style={{ fontFamily: 'var(--font-sora)' }}>
            {order.recipientName}
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">Order #{order.id.slice(-8).toUpperCase()}</p>
        </div>
        {statusIcon(order.status)}
      </div>

      {/* Status timeline */}
      {order.status !== 'failed' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Delivery Progress</p>
          <div className="relative">
            {/* Track line */}
            <div className="absolute left-4 top-4 bottom-4 w-0.5 bg-gray-100" />
            <div
              className="absolute left-4 top-4 w-0.5 bg-[#0F4C81] transition-all duration-500"
              style={{ height: `${activeStep >= 0 ? (activeStep / (TIMELINE_STEPS.length - 1)) * 100 : 0}%` }}
            />
            <div className="space-y-4">
              {TIMELINE_STEPS.map((step, i) => {
                const done = i <= activeStep;
                const current = i === activeStep;
                return (
                  <div key={step.key} className="flex items-start gap-3 relative">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 shrink-0 z-10 transition-colors ${
                      done ? 'bg-[#0F4C81] border-[#0F4C81]' : 'bg-white border-gray-200'
                    } ${current ? 'ring-4 ring-blue-50' : ''}`}>
                      {done && <CheckCircle2 size={14} className="text-white" />}
                    </div>
                    <div className="pt-1">
                      <p className={`text-sm font-semibold ${done ? 'text-gray-900' : 'text-gray-300'}`}>{step.label}</p>
                      <p className={`text-xs mt-0.5 ${done ? 'text-gray-400' : 'text-gray-200'}`}>{step.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Failed state */}
      {order.status === 'failed' && (
        <div className="bg-red-50 border border-red-100 rounded-2xl p-4 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-red-700 text-sm">Delivery Failed</p>
            {order.failureReason && <p className="text-xs text-red-500 mt-1">Reason: {order.failureReason}</p>}
            {order.failureNote && <p className="text-xs text-red-400 mt-0.5">{order.failureNote}</p>}
          </div>
        </div>
      )}

      {/* Patient & delivery info */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Delivery Details</p>
        <div className="space-y-2.5">
          <div className="flex items-start gap-2.5">
            <User size={14} className="text-gray-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs text-gray-400">Patient</p>
              <p className="text-sm font-medium text-gray-800">{order.recipientName}</p>
            </div>
          </div>
          {order.recipientPhone && (
            <div className="flex items-start gap-2.5">
              <Phone size={14} className="text-gray-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs text-gray-400">Phone</p>
                <p className="text-sm font-medium text-gray-800">{order.recipientPhone}</p>
              </div>
            </div>
          )}
          <div className="flex items-start gap-2.5">
            <MapPin size={14} className="text-gray-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs text-gray-400">Address</p>
              <p className="text-sm font-medium text-gray-800">{order.address}{order.unit ? `, ${order.unit}` : ''}</p>
            </div>
          </div>
          {order.rxNumbers?.length > 0 && (
            <div className="flex items-start gap-2.5">
              <FileText size={14} className="text-gray-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs text-gray-400">Rx Numbers</p>
                <p className="text-sm font-medium text-gray-800">{order.rxNumbers.join(', ')}</p>
              </div>
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5 mt-1">
          {order.requiresRefrigeration && <span className="text-xs bg-blue-50 text-blue-600 px-2 py-1 rounded-lg">❄ Cold Chain</span>}
          {order.controlledSubstance && <span className="text-xs bg-orange-50 text-orange-600 px-2 py-1 rounded-lg">⚠ Controlled</span>}
          {order.requiresSignature && <span className="text-xs bg-purple-50 text-purple-600 px-2 py-1 rounded-lg">✍ Signature Required</span>}
        </div>
        {order.deliveryNotes && (
          <p className="text-xs text-gray-500 bg-gray-50 rounded-xl px-3 py-2">{order.deliveryNotes}</p>
        )}
      </div>

      {/* Driver info */}
      {order.driverName && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Assigned Driver</p>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-50 rounded-full flex items-center justify-center">
              <Truck size={16} className="text-[#0F4C81]" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-gray-900 text-sm">{order.driverName}</p>
              {order.driverPhone && <p className="text-xs text-gray-400">{order.driverPhone}</p>}
            </div>
            <span className={`text-xs font-medium px-2 py-1 rounded-full ${
              order.driverStatus === 'on_route' ? 'bg-blue-50 text-blue-600' :
              order.driverStatus === 'available' ? 'bg-green-50 text-green-600' :
              'bg-gray-100 text-gray-500'
            }`}>
              {order.driverStatus?.replace('_', ' ')}
            </span>
          </div>
        </div>
      )}

      {/* Proof of delivery */}
      {order.pod && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Proof of Delivery</p>
          <p className="text-xs text-gray-400 mb-3">Captured {fmt(order.pod.capturedAt)}</p>

          {order.pod.signature && (
            <div className="mb-3">
              <p className="text-xs text-gray-500 mb-1">Signed by: {order.pod.signature.signerName}</p>
              <div
                className="border border-gray-100 rounded-xl p-2 bg-gray-50"
                dangerouslySetInnerHTML={{ __html: order.pod.signature.svgData }}
              />
            </div>
          )}

          {(order.pod.photos as string[]).length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <Camera size={13} className="text-gray-400" />
                <p className="text-xs text-gray-500">Photos ({(order.pod.photos as string[]).length})</p>
              </div>
              <div className="flex gap-2 flex-wrap">
                {(order.pod.photos as string[]).map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                    <img src={url} alt={`POD photo ${i + 1}`}
                      className="w-20 h-20 object-cover rounded-xl border border-gray-100 hover:opacity-80 transition-opacity" />
                  </a>
                ))}
              </div>
            </div>
          )}

          {order.pod.driverNote && (
            <p className="text-xs text-gray-500 bg-gray-50 rounded-xl px-3 py-2 mt-3">
              Driver note: {order.pod.driverNote}
            </p>
          )}
        </div>
      )}

      {/* Timestamps */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Timeline</p>
        <div className="space-y-1.5 text-xs">
          <div className="flex justify-between">
            <span className="text-gray-400">Submitted</span>
            <span className="text-gray-700 font-medium">{fmt(order.createdAt)}</span>
          </div>
          {order.arrivedAt && (
            <div className="flex justify-between">
              <span className="text-gray-400">Driver arrived</span>
              <span className="text-gray-700 font-medium">{fmt(order.arrivedAt)}</span>
            </div>
          )}
          {order.completedAt && (
            <div className="flex justify-between">
              <span className="text-gray-400">Delivered</span>
              <span className="text-green-600 font-medium">{fmt(order.completedAt)}</span>
            </div>
          )}
          {order.planDate && (
            <div className="flex justify-between">
              <span className="text-gray-400">Scheduled date</span>
              <span className="text-gray-700 font-medium">{order.planDate}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
