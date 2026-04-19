'use client';
// P-ONB37: BAA acceptance gate — HIPAA §164.308(b)(1) requires documented BAA before ePHI flows
import { useState } from 'react';
import { api } from '@/lib/api';
import { ShieldCheck, FileText, AlertTriangle } from 'lucide-react';

interface Props {
  orgId: string;
  onAccepted: () => void;
}

export function BAAModal({ orgId, onAccepted }: Props) {
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState('');
  const [scrolledToBottom, setScrolledToBottom] = useState(false);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 10) setScrolledToBottom(true);
  };

  const accept = async () => {
    setAccepting(true);
    setError('');
    try {
      await api.post(`/orgs/${orgId}/baa-accept`, {});
      onAccepted();
    } catch (e: unknown) {
      setError((e as { message?: string })?.message ?? 'Failed to record BAA acceptance. Please try again.');
      setAccepting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="bg-[#0F4C81] px-6 py-4 flex items-center gap-3">
          <ShieldCheck className="text-white" size={22} />
          <div>
            <h2 className="text-white font-bold text-lg leading-tight">Business Associate Agreement</h2>
            <p className="text-blue-200 text-xs">Required before processing patient delivery data</p>
          </div>
        </div>

        {/* BAA text — must scroll to bottom to enable accept */}
        <div
          className="px-6 py-4 h-64 overflow-y-auto text-sm text-gray-700 space-y-3 border-b border-gray-100"
          onScroll={handleScroll}
        >
          <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
            <AlertTriangle size={14} className="text-amber-600 flex-shrink-0" />
            <p className="text-amber-800 text-xs font-medium">Scroll to read the full agreement before accepting.</p>
          </div>

          <p className="font-semibold text-gray-900">HIPAA Business Associate Agreement</p>
          <p>This Business Associate Agreement (&quot;BAA&quot;) is entered into between MyDashRx, Inc. (&quot;Business Associate&quot;) and your pharmacy organization (&quot;Covered Entity&quot;) pursuant to the Health Insurance Portability and Accountability Act of 1996 (&quot;HIPAA&quot;) and the Health Information Technology for Economic and Clinical Health Act (&quot;HITECH&quot;).</p>

          <p className="font-medium text-gray-900 mt-2">1. Definitions</p>
          <p>&quot;Protected Health Information&quot; (PHI) means individually identifiable health information transmitted or maintained in any form or medium as defined in 45 C.F.R. § 160.103. This includes patient names, addresses, delivery instructions, and any health-related information processed through the MyDashRx platform.</p>

          <p className="font-medium text-gray-900 mt-2">2. Permitted Uses and Disclosures</p>
          <p>Business Associate may use and disclose PHI only as necessary to provide pharmacy delivery management services on behalf of Covered Entity, including route optimization, delivery tracking, proof of delivery, and related operational functions.</p>

          <p className="font-medium text-gray-900 mt-2">3. Safeguards</p>
          <p>Business Associate shall implement appropriate administrative, physical, and technical safeguards to protect PHI, including encryption in transit (TLS 1.2+) and at rest, access controls, audit logging, and workforce training.</p>

          <p className="font-medium text-gray-900 mt-2">4. Data Retention and Disposal</p>
          <p>Business Associate shall retain PHI only as required by law. Proof of delivery PHI (including signatures, photos, and delivery addresses) shall be purged after 6 years. GPS location data shall be purged after 1 year. Purge events are logged to the audit trail.</p>

          <p className="font-medium text-gray-900 mt-2">5. Breach Notification</p>
          <p>Business Associate shall notify Covered Entity of any discovered Breach of Unsecured PHI without unreasonable delay and within 60 days of discovery, as required by 45 C.F.R. § 164.410.</p>

          <p className="font-medium text-gray-900 mt-2">6. Subcontractors</p>
          <p>Business Associate shall ensure that any subcontractors that create, receive, maintain, or transmit PHI agree to the same restrictions and conditions that apply to Business Associate with respect to such PHI.</p>

          <p className="font-medium text-gray-900 mt-2">7. Term and Termination</p>
          <p>This BAA shall remain in effect for the duration of the service agreement and shall survive termination with respect to obligations relating to PHI created or received during the term.</p>

          <p className="font-medium text-gray-900 mt-2">8. Governing Law</p>
          <p>This Agreement shall be governed by HIPAA, HITECH, and applicable federal and state law. In the event of a conflict between this BAA and any other agreement, this BAA shall control with respect to PHI.</p>

          <div className="mt-4 p-3 bg-blue-50 rounded-lg border border-blue-100">
            <p className="text-xs text-blue-800">By clicking &quot;I Accept&quot; below, an authorized representative of your pharmacy confirms they have read, understand, and agree to this Business Associate Agreement. Your IP address, browser, and timestamp will be recorded for compliance purposes.</p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 space-y-3">
          {error && <p className="text-red-600 text-xs bg-red-50 border border-red-100 rounded px-3 py-2">{error}</p>}

          {!scrolledToBottom && (
            <p className="text-xs text-gray-400 text-center flex items-center justify-center gap-1">
              <FileText size={12} /> Scroll to the bottom to enable acceptance
            </p>
          )}

          <button
            onClick={accept}
            disabled={!scrolledToBottom || accepting}
            className="w-full bg-[#0F4C81] text-white rounded-lg py-3 text-sm font-semibold hover:bg-[#0d3d69] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {accepting ? 'Recording acceptance...' : 'I Accept — Sign Business Associate Agreement'}
          </button>
          <p className="text-xs text-gray-400 text-center">
            Need a PDF copy?{' '}
            <a href="/baa.pdf" target="_blank" rel="noopener noreferrer" className="text-[#0F4C81] hover:underline">Download BAA</a>
          </p>
        </div>
      </div>
    </div>
  );
}
