export default function PendingApprovalPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F7F8FC]">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
        <div className="w-14 h-14 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-7 h-7 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Account pending approval</h2>
        <p className="text-gray-500 text-sm mb-2">Your pharmacy account is under review.</p>
        <p className="text-gray-500 text-sm mb-6">Our team will activate your account and send you a confirmation email within 24 hours.</p>
        <p className="text-xs text-gray-400">Questions? Contact <a href="mailto:support@mydashrx.com" className="text-[#0F4C81] hover:underline">support@mydashrx.com</a></p>
      </div>
    </div>
  );
}
