'use client';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { MapPin, Loader2 } from 'lucide-react';

interface Prediction {
  description: string;
  placeId: string;
  mainText: string;
  secondaryText: string;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  id?: string;
}

export function AddressAutocomplete({ value, onChange, placeholder, className, id }: Props) {
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [justSelected, setJustSelected] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (justSelected) { setJustSelected(false); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = value.trim();
    if (q.length < 3) { setPredictions([]); setOpen(false); return; }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api.get<{ predictions: Prediction[] }>(`/geocode/autocomplete?q=${encodeURIComponent(q)}`);
        setPredictions(res.predictions ?? []);
        setOpen((res.predictions ?? []).length > 0);
        setActiveIndex(-1);
      } catch { setPredictions([]); setOpen(false); }
      finally { setLoading(false); }
    }, 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [value, justSelected]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const pick = (p: Prediction) => {
    setJustSelected(true);
    onChange(p.description);
    setOpen(false);
    setPredictions([]);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || predictions.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex(i => Math.min(i + 1, predictions.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && activeIndex >= 0) { e.preventDefault(); pick(predictions[activeIndex]); }
    else if (e.key === 'Escape') setOpen(false);
  };

  return (
    <div ref={wrapperRef} className="relative">
      <input
        id={id}
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => predictions.length > 0 && setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoComplete="off"
        className={className}
      />
      {loading && (
        <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 animate-spin" />
      )}
      {open && predictions.length > 0 && (
        <ul className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-64 overflow-y-auto" role="listbox">
          {predictions.map((p, i) => (
            <li key={p.placeId}
              role="option"
              aria-selected={i === activeIndex}
              onMouseDown={e => { e.preventDefault(); pick(p); }}
              onMouseEnter={() => setActiveIndex(i)}
              className={`flex items-start gap-2 px-3 py-2 cursor-pointer text-sm ${i === activeIndex ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
            >
              <MapPin size={14} className="text-gray-400 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <div className="text-gray-900 truncate">{p.mainText}</div>
                {p.secondaryText && <div className="text-xs text-gray-500 truncate">{p.secondaryText}</div>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
