'use client';
export default function StopsPage() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-6" style={{ fontFamily: 'var(--font-sora)' }}>
        Stops
      </h1>
      <div className="bg-white rounded-xl border border-gray-100 p-8 text-center">
        <p className="text-gray-500 text-sm">Select a route plan to view stops.</p>
      </div>
    </div>
  );
}
