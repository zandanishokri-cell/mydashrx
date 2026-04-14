interface RouteCardProps {
  driverName: string;
  stopCount: number;
  completedCount: number;
  estimatedDuration: number | null;
  status: string;
}

const statusConfig: Record<string, { label: string; classes: string }> = {
  pending: { label: 'Pending', classes: 'bg-gray-100 text-gray-600' },
  active: { label: 'Active', classes: 'bg-teal-50 text-teal-700' },
  completed: { label: 'Complete', classes: 'bg-green-50 text-green-700' },
};

export function RouteCard({
  driverName,
  stopCount,
  completedCount,
  estimatedDuration,
  status,
}: RouteCardProps) {
  const pct = stopCount > 0 ? Math.round((completedCount / stopCount) * 100) : 0;
  const { label, classes } = statusConfig[status] ?? { label: status, classes: 'bg-gray-100 text-gray-600' };

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 hover:shadow-sm transition-shadow">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center text-[#0F4C81] font-semibold text-sm">
            {driverName[0] ?? '?'}
          </div>
          <div>
            <div className="text-sm font-medium text-gray-900">{driverName}</div>
            <div className="text-xs text-gray-400">
              {stopCount} stops{estimatedDuration ? ` · ${estimatedDuration} min` : ''}
            </div>
          </div>
        </div>
        <span className={`text-xs px-2 py-1 rounded-full font-medium ${classes}`}>
          {label}
        </span>
      </div>
      <div className="w-full bg-gray-100 rounded-full h-1.5">
        <div
          className="bg-[#00B8A9] rounded-full h-1.5 transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-1 text-xs text-gray-400">
        {completedCount} / {stopCount} completed
      </div>
    </div>
  );
}
