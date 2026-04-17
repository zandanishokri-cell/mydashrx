export default function PendingApprovalPage() {
  const checklist = [
    { done: true, text: 'Application submitted' },
    { done: false, text: 'Add team email addresses so staff can be invited on day one' },
    { done: false, text: 'Download the MyDashRx driver app (iOS & Android)' },
    { done: false, text: 'Watch the 3-minute setup walkthrough' },
  ];

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F7F8FC] py-8">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
        <div className="text-center mb-6">
          <div className="w-14 h-14 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Account pending approval</h2>
          <p className="text-gray-500 text-sm mb-3">Your pharmacy account is under review.</p>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-green-50 text-green-700 text-xs font-medium rounded-full border border-green-100">
            <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
            Typical approval: 2–4 business hours
          </div>
        </div>

        <div className="border-t border-gray-100 pt-5 mb-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">While you wait</h3>
          <ul className="space-y-3">
            {checklist.map((item, i) => (
              <li key={i} className="flex items-start gap-3 text-sm">
                <span className={`mt-0.5 w-4 h-4 rounded-full flex-shrink-0 flex items-center justify-center ${item.done ? 'bg-green-100 text-green-600' : 'border-2 border-gray-200'}`}>
                  {item.done && (
                    <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </span>
                <span className={item.done ? 'text-gray-400 line-through' : 'text-gray-600'}>{item.text}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="bg-blue-50 rounded-xl p-4 mb-5">
          <p className="text-xs text-blue-700 font-semibold mb-1">Want a head start?</p>
          <p className="text-xs text-blue-600">
            <a href="mailto:onboarding@mydashrx.com" className="underline font-medium">Book a 15-minute onboarding call</a>{' '}
            — we'll have your routes, drivers, and depot configured before your account goes live.
          </p>
        </div>

        <div className="text-center space-y-1">
          <p className="text-xs text-gray-400">You'll receive a confirmation email when your account is activated.</p>
          <p className="text-xs text-gray-400">
            Questions? Contact{' '}
            <a href="mailto:support@mydashrx.com" className="text-[#0F4C81] hover:underline">support@mydashrx.com</a>
          </p>
        </div>
      </div>
    </div>
  );
}
