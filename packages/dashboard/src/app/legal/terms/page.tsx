export default function TermsPage() {
  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Terms of Service</h1>
        <p className="text-sm text-gray-400 mb-6">Version 1.0 — Effective April 1, 2026</p>

        <p className="text-sm text-gray-600 mb-4">
          By signing up for MyDashRx, you agree to these Terms of Service. Please read them carefully.
        </p>

        <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-2">1. Service Description</h2>
        <p className="text-sm text-gray-600 mb-3">MyDashRx provides pharmacy delivery route management, driver dispatch, real-time tracking, and patient notification services to licensed pharmacies.</p>

        <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-2">2. Eligibility</h2>
        <p className="text-sm text-gray-600 mb-3">You must be a licensed pharmacy or authorized representative of a licensed pharmacy to use MyDashRx. Use is subject to approval by MyDashRx staff.</p>

        <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-2">3. Account Responsibilities</h2>
        <p className="text-sm text-gray-600 mb-3">You are responsible for maintaining the confidentiality of your credentials, all activity under your account, and ensuring your staff follows applicable laws including HIPAA.</p>

        <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-2">4. Acceptable Use</h2>
        <p className="text-sm text-gray-600 mb-3">You may not use MyDashRx for any unlawful purpose, to transmit PHI beyond what is necessary for delivery operations, or in any way that violates HIPAA or Michigan pharmacy law.</p>

        <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-2">5. Payment</h2>
        <p className="text-sm text-gray-600 mb-3">Subscription fees are billed monthly. You authorize MyDashRx to charge your payment method on file. Failure to pay may result in suspension.</p>

        <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-2">6. Limitation of Liability</h2>
        <p className="text-sm text-gray-600 mb-3">MyDashRx is not liable for any indirect, incidental, or consequential damages arising from your use of the platform. Our total liability shall not exceed fees paid in the 3 months preceding the claim.</p>

        <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-2">7. Termination</h2>
        <p className="text-sm text-gray-600 mb-3">Either party may terminate with 30 days notice. MyDashRx may terminate immediately for violation of these Terms or the BAA.</p>

        <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-2">8. Contact</h2>
        <p className="text-sm text-gray-600 mb-3">
          Questions: <a href="mailto:support@mydashrx.com" className="text-[#0F4C81] underline">support@mydashrx.com</a>
        </p>

        <div className="mt-6 text-xs text-gray-400 text-center">
          MyDashRx, LLC · Terms of Service v1.0 · Effective April 1, 2026
        </div>
      </div>
    </div>
  );
}
