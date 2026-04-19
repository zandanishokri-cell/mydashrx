export default function BaaPage() {
  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-sm border border-gray-100 p-8 prose prose-gray max-w-none">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Business Associate Agreement</h1>
        <p className="text-sm text-gray-400 mb-6">Version 1.0 — Effective April 1, 2026</p>

        <p className="text-sm text-gray-600 mb-4">
          This Business Associate Agreement ("BAA") is entered into between <strong>MyDashRx, LLC</strong> ("Business Associate") and the pharmacy or healthcare organization accepting this agreement ("Covered Entity") as part of the MyDashRx signup process.
        </p>

        <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-2">1. Definitions</h2>
        <p className="text-sm text-gray-600 mb-3">Terms used in this BAA shall have the same meanings as those defined in the Health Insurance Portability and Accountability Act of 1996 (HIPAA), 45 CFR Parts 160 and 164, and the Health Information Technology for Economic and Clinical Health Act (HITECH).</p>

        <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-2">2. Permitted Uses and Disclosures</h2>
        <p className="text-sm text-gray-600 mb-3">Business Associate may use or disclose Protected Health Information (PHI) only as permitted or required by this BAA, or as required by law. Business Associate agrees to:</p>
        <ul className="text-sm text-gray-600 list-disc pl-5 space-y-1 mb-3">
          <li>Use PHI only to provide delivery route management, patient notification, and related services under the MyDashRx platform.</li>
          <li>Not use or disclose PHI in a manner that would violate HIPAA if done by the Covered Entity.</li>
          <li>Use appropriate safeguards to prevent unauthorized use or disclosure of PHI.</li>
          <li>Report to the Covered Entity any use or disclosure of PHI not provided for by this BAA.</li>
          <li>Ensure that subcontractors who handle PHI agree to equivalent protections.</li>
        </ul>

        <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-2">3. Obligations of Covered Entity</h2>
        <p className="text-sm text-gray-600 mb-3">Covered Entity agrees to:</p>
        <ul className="text-sm text-gray-600 list-disc pl-5 space-y-1 mb-3">
          <li>Notify Business Associate of any limitations in its Notice of Privacy Practices that would affect permitted uses or disclosures.</li>
          <li>Obtain all necessary consents from patients before transmitting PHI to MyDashRx.</li>
          <li>Not request Business Associate to use or disclose PHI in any manner that would not be permissible under HIPAA.</li>
        </ul>

        <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-2">4. Security Requirements</h2>
        <p className="text-sm text-gray-600 mb-3">Business Associate agrees to implement administrative, physical, and technical safeguards that reasonably and appropriately protect the confidentiality, integrity, and availability of electronic PHI per 45 CFR 164.308, 164.310, and 164.312.</p>

        <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-2">5. Breach Notification</h2>
        <p className="text-sm text-gray-600 mb-3">Business Associate agrees to notify Covered Entity of any Breach of Unsecured PHI without unreasonable delay and within 60 days of discovery, per 45 CFR 164.400–164.414.</p>

        <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-2">6. Termination</h2>
        <p className="text-sm text-gray-600 mb-3">Either party may terminate this BAA if the other party breaches a material term and fails to cure within 30 days. Upon termination, Business Associate will return or destroy all PHI.</p>

        <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-2">7. Michigan Pharmacy Compliance</h2>
        <p className="text-sm text-gray-600 mb-3">This BAA is designed to satisfy the data handling agreement requirements under Michigan Pharmacy Practice Act R 338.3162 for licensed pharmacies operating in Michigan.</p>

        <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-2">8. Governing Law</h2>
        <p className="text-sm text-gray-600 mb-3">This BAA shall be governed by the laws of the State of Michigan, consistent with applicable federal law including HIPAA and HITECH.</p>

        <div className="mt-8 p-4 bg-blue-50 border border-blue-100 rounded-xl text-sm text-blue-800">
          <strong>Questions?</strong> Contact our compliance team at <a href="mailto:compliance@mydashrx.com" className="underline">compliance@mydashrx.com</a>.
        </div>

        <div className="mt-6 text-xs text-gray-400 text-center">
          MyDashRx, LLC · Business Associate Agreement v1.0 · Effective April 1, 2026
        </div>
      </div>
    </div>
  );
}
