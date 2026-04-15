'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { RefreshCw, Package, CheckCircle2, XCircle, Clock, Truck, ChevronRight } from 'lucide-react';

interface Order {
  id: string;
  recipientName: string;
  recipientPhone: string;
  address: string;
  status: string;
  rxNumbers: string[];
  packageCount: number;
  requiresRefrigeration: boolean;
  controlledSubstance: boolean;
  createdAt: string;
  planDate?: string;
  planStatus?: string;
  arrivedAt?: string;
  completedAt?: string;
  failureReason?: string;
  driverName?: string;
  estimatedDelivery?: string;
}

const STATUS_TABS = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'en_route', label: 'Dispatched' },
  { key: 'completed', label: 'Delivered' },
  { key: 'failed', label: 'Failed' },
];

// Order status timeline steps
const TIMELINE_STEPS = [
  { key: 'pending', label: 'Received' },
  { key: 'en_route', label: 'Dispatched' },
  { key: 'arrived', label: 'Out for Delivery' },
  { key: 'completed', label: 'Delivered' },
];

const STATUS_ORDER = ['pending', 'en_route', 'arrived', 'completed'];

function getActiveStep(status: string) {
  if (status === 'failed') return -1;
  const idx = STATUS_ORDER.indexOf(status);
  return idx === -1 ? 0 : idx;
}

function StatusTimeline({ status }: { status: string }) {
  const activeStep = getActiveStep(status);
  if (status === 'pending') return null; // Don't show full timeline for new orders
  return (
    <div className="flex items-center mt-3 mb-1">
      {TIMELINE_STEPS.map((step, i) => {
        const done = i <= activeStep;
        const current = i === activeStep;
        return (
          <div key={step.key} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center">
              <div className={`w-5 h-5 rounded-full flex items-center justify-center border-2 transition-colors ${
                done
                  ? 'bg-[#0F4C81] border-[#0F4C81]'
                  : 'bg-white border-gray-200'
              } ${current ? 'ring-2 ring-blue-100' : ''}`}>
                {done && <div className="w-2 h-2 rounded-full bg-white" />}
              </div>
              <span className={`text-[9px] mt-0.5 font-medium whitespace-nowrap ${done ? 'text-[#0F4C81]' : 'text-gray-300'}`}>
                {step.label}
              </span>
            </div>
            {i < TIMELINE_STEPS.length - 1 && (
              <div className={`flex-1 h-0.5 mx-0.5 mb-3.5 ${i < activeStep ? 'bg-[#0F4C81]' : 'bg-gray-100'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

const statusIcon = (s: string) => {
  if (s === 'completed') return <CheckCircle2 size={16} className="text-green-500" />;
  if (s === 'failed') return <XCircle size={16} className="text-red-400" />;
  if (s === 'arrived') return <Clock size={16} className="text-yellow-500" />;
  if (s === 'en_route') return <Truck size={16} className="text-blue-500" />;
  return <Package size={16} className="text-gray-300" />;
};

const statusLabel: Record<string, string> = {
  pending: 'Pending',
  en_route: 'Out for delivery',
  arrived: 'Driver arrived',
  completed: 'Delivered',
  failed: 'Failed',
};

const statusColor: Record<string, string> = {
  completed: 'text-green-600',
  failed: 'text-red-500',
  en_route: 'text-blue-600',
  arrived: 'text-yellow-600',
  pending: 'text-gray-500',
};

// Anonymize patient name: "Jane Smith" → "Smith, J."
const formatPatientName = (name: string) => {
  const parts = name.trim().split(' ');
  if (parts.length < 2) return name;
  return `${parts[parts.length - 1]}, ${parts[0][0]}.`;
};

export default function PharmacyOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [tab, setTab] = useState('all');
  const [loading, setLoading] = useState(true);

  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    api.get<{ stops: Order[] }>('/pharmacy/orders?limit=100')
      .then(d => {
        setOrders(d.stops);
        // Build counts
        const c: Record<string, number> = { all: d.stops.length };
        for (const o of d.stops) {
          const k = o.status === 'en_route' ? 'en_route' : o.status;
          c[k] = (c[k] ?? 0) + 1;
        }
        setCounts(c);
      })
      .catch(() => {})
      .finally(() => { if (!silent) setLoading(false); });
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh every 30s
  useEffect(() => {
    const id = setInterval(() => load(true), 30_000);
    return () => clearInterval(id);
  }, [load]);

  const filtered = tab === 'all' ? orders : orders.filter(o => {
    if (tab === 'en_route') return o.status === 'en_route' || o.status === 'arrived';
    return o.status === tab;
  });

  return (
    <div className="p-4 md:p-5">
      <div className="flex items-center justify-between mb-4">
        <h1 className="font-bold text-gray-900" style={{ fontFamily: 'var(--font-sora)' }}>My Orders</h1>
        <button onClick={() => load()} disabled={loading} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
          <RefreshCw size={16} className={`text-gray-400 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Status tabs with count badges */}
      <div className="flex bg-gray-100 rounded-xl p-1 mb-4 gap-1 overflow-x-auto">
        {STATUS_TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center justify-center gap-1 min-w-[60px] whitespace-nowrap ${
              tab === t.key ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'
            }`}>
            {t.label}
            {counts[t.key] > 0 && (
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                tab === t.key ? 'bg-[#0F4C81] text-white' : 'bg-gray-300 text-gray-600'
              }`}>
                {counts[t.key]}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => <div key={i} className="h-24 bg-white rounded-2xl animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl p-10 text-center shadow-sm">
          <Package size={32} className="text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">No orders {tab !== 'all' ? `with status "${STATUS_TABS.find(t => t.key === tab)?.label}"` : 'yet'}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(order => (
            <Link key={order.id} href={`/pharmacy/orders/${order.id}`}
              className="block bg-white rounded-2xl p-4 shadow-sm border border-gray-50 hover:border-blue-100 hover:shadow-md transition-all">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="mt-0.5 shrink-0">{statusIcon(order.status)}</div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-900 text-sm">{formatPatientName(order.recipientName)}</span>
                      {order.requiresRefrigeration && <span className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">❄ Cold</span>}
                      {order.controlledSubstance && <span className="text-xs bg-orange-50 text-orange-600 px-1.5 py-0.5 rounded">⚠ Ctrl</span>}
                    </div>
                    <p className="text-xs text-gray-400 truncate mt-0.5">{order.address}</p>
                    {order.rxNumbers?.length > 0 && (
                      <p className="text-xs text-gray-400 mt-0.5">Rx: {order.rxNumbers.join(', ')}</p>
                    )}
                    {order.driverName && (
                      <p className="text-xs text-blue-600 mt-0.5 font-medium">Driver: {order.driverName}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-start gap-1 shrink-0">
                  <div className="text-right">
                    <span className={`text-xs font-medium ${statusColor[order.status] ?? 'text-gray-500'}`}>
                      {statusLabel[order.status] ?? order.status}
                    </span>
                    {order.planDate && <p className="text-xs text-gray-400 mt-0.5">{order.planDate}</p>}
                    {order.estimatedDelivery && (
                      <p className="text-xs text-blue-500 mt-0.5">ETA {order.estimatedDelivery}</p>
                    )}
                  </div>
                  <ChevronRight size={14} className="text-gray-300 mt-0.5" />
                </div>
              </div>

              {/* Status timeline for in-progress orders */}
              {(order.status === 'en_route' || order.status === 'arrived') && (
                <StatusTimeline status={order.status} />
              )}

              {order.status === 'failed' && order.failureReason && (
                <p className="text-xs text-red-400 mt-2 bg-red-50 rounded-lg px-2 py-1">{order.failureReason}</p>
              )}
              {order.completedAt && (
                <p className="text-xs text-green-500 mt-1">
                  Delivered {new Date(order.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              )}
            </Link>
          ))}
        </div>
      )}

      <p className="text-center text-[10px] text-gray-300 mt-4">Auto-refreshes every 30 seconds</p>
    </div>
  );
}
