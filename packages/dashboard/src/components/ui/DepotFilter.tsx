'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';

interface Depot { id: string; name: string; }

interface Props {
  value: string;
  onChange: (id: string, name?: string) => void;
  className?: string;
}

export function DepotFilter({ value, onChange, className = '' }: Props) {
  const [depots, setDepots] = useState<Depot[]>([]);
  const user = getUser();

  useEffect(() => {
    if (!user) return;
    api.get<Depot[]>(`/orgs/${user.orgId}/depots`).then(setDepots).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <select
      value={value}
      aria-label="Filter by depot"
      onChange={e => {
        const depot = depots.find(d => d.id === e.target.value);
        onChange(e.target.value, depot?.name);
      }}
      className={`border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-100 ${className}`}
    >
      <option value="">All depots</option>
      {depots.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
    </select>
  );
}
