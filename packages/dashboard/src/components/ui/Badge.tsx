const variants: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  optimized: 'bg-blue-50 text-blue-700',
  distributed: 'bg-teal-50 text-teal-700',
  completed: 'bg-green-50 text-green-700',
  pending: 'bg-gray-100 text-gray-600',
  arrived: 'bg-yellow-50 text-yellow-700',
  failed: 'bg-red-50 text-red-700',
  available: 'bg-green-50 text-green-700',
  on_route: 'bg-teal-50 text-teal-700',
  offline: 'bg-gray-100 text-gray-500',
  active: 'bg-blue-50 text-blue-700',
};

export function Badge({ status }: { status: string }) {
  return (
    <span className={`text-xs px-2 py-1 rounded-full font-medium ${variants[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}
