'use client';
import { useState, useRef, useEffect } from 'react';
import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react';

export interface DateRange {
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
}

export type DatePreset = '7d' | '30d' | '90d' | 'today' | 'week' | 'month' | 'custom';

interface Props {
  value: DateRange;
  onChange: (range: DateRange) => void;
  presets?: DatePreset[];
  label?: string;
}

const PRESET_LABELS: Record<DatePreset, string> = {
  today: 'Today',
  week: 'This week',
  month: 'This month',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  custom: 'All time / Custom',
};

function getPresetRange(preset: Exclude<DatePreset, 'custom'>): DateRange {
  const today = new Date();
  const fmt = (d: Date) => d.toISOString().split('T')[0];
  const todayStr = fmt(today);
  switch (preset) {
    case 'today': return { from: todayStr, to: todayStr };
    case 'week': {
      const d = new Date(today);
      d.setDate(today.getDate() - today.getDay() + 1);
      return { from: fmt(d), to: todayStr };
    }
    case 'month': {
      return { from: fmt(new Date(today.getFullYear(), today.getMonth(), 1)), to: todayStr };
    }
    case '7d': {
      const d = new Date(today); d.setDate(today.getDate() - 6);
      return { from: fmt(d), to: todayStr };
    }
    case '30d': {
      const d = new Date(today); d.setDate(today.getDate() - 29);
      return { from: fmt(d), to: todayStr };
    }
    case '90d': {
      const d = new Date(today); d.setDate(today.getDate() - 89);
      return { from: fmt(d), to: todayStr };
    }
  }
}

function detectPreset(range: DateRange, presets: DatePreset[]): DatePreset {
  for (const p of presets) {
    if (p === 'custom') continue;
    const r = getPresetRange(p);
    if (r.from === range.from && r.to === range.to) return p;
  }
  return 'custom';
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS = ['Su','Mo','Tu','We','Th','Fr','Sa'];

function CalendarMonth({
  year, month, selecting, selectedFrom, selectedTo, hoverDate,
  onSelectDate, onHoverDate,
}: {
  year: number; month: number; selecting: 'from' | 'to' | null;
  selectedFrom: string | null; selectedTo: string | null; hoverDate: string | null;
  onSelectDate: (d: string) => void; onHoverDate: (d: string | null) => void;
}) {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = Array(firstDay).fill(null);
  for (let i = 1; i <= daysInMonth; i++) cells.push(i);
  while (cells.length % 7 !== 0) cells.push(null);

  const fmt = (d: number) => `${year}-${String(month + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;

  return (
    <div className="w-64">
      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {DAYS.map(d => <div key={d} className="text-center text-xs text-gray-400 font-medium py-1">{d}</div>)}
        {cells.map((day, i) => {
          if (!day) return <div key={`e${i}`} />;
          const dateStr = fmt(day);
          const isFrom = dateStr === selectedFrom;
          const isTo = dateStr === selectedTo;
          const endDate = selectedTo ?? (selecting === 'to' && hoverDate ? hoverDate : null);
          const inRange = selectedFrom && endDate && dateStr > selectedFrom && dateStr < endDate;
          const isHover = dateStr === hoverDate && selecting === 'to';
          return (
            <button
              key={day}
              onClick={() => onSelectDate(dateStr)}
              onMouseEnter={() => onHoverDate(dateStr)}
              onMouseLeave={() => onHoverDate(null)}
              className={`
                w-full aspect-square text-xs rounded transition-colors
                ${isFrom || isTo ? 'bg-[#0F4C81] text-white font-semibold' : ''}
                ${inRange ? 'bg-blue-100 text-blue-800' : ''}
                ${isHover && !isFrom && !isTo ? 'bg-blue-200 text-blue-900' : ''}
                ${!isFrom && !isTo && !inRange && !isHover ? 'hover:bg-gray-100 text-gray-700' : ''}
              `}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function DateRangePicker({ value, onChange, presets = ['today','week','month','30d','90d','custom'], label }: Props) {
  const [open, setOpen] = useState(false);
  const [activePreset, setActivePreset] = useState<DatePreset>(() => detectPreset(value, presets));
  const [showCalendar, setShowCalendar] = useState(false);
  const [calFrom, setCalFrom] = useState<string | null>(value.from);
  const [calTo, setCalTo] = useState<string | null>(value.to);
  const [selecting, setSelecting] = useState<'from' | 'to'>('from');
  const [hoverDate, setHoverDate] = useState<string | null>(null);
  const [calYear, setCalYear] = useState(new Date().getFullYear());
  const [calMonth, setCalMonth] = useState(new Date().getMonth());
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const formatDisplay = () => {
    if (activePreset !== 'custom') return PRESET_LABELS[activePreset];
    if (!calFrom) return 'Select range';
    if (!calTo) return calFrom;
    return `${calFrom} → ${calTo}`;
  };

  const handlePreset = (p: DatePreset) => {
    setActivePreset(p);
    if (p !== 'custom') {
      const r = getPresetRange(p);
      onChange(r);
      setCalFrom(r.from);
      setCalTo(r.to);
      setShowCalendar(false);
      setOpen(false);
    } else {
      setShowCalendar(true);
      setCalFrom(null);
      setCalTo(null);
      setSelecting('from');
    }
  };

  const handleDateSelect = (d: string) => {
    if (selecting === 'from') {
      setCalFrom(d);
      setCalTo(null);
      setSelecting('to');
    } else {
      if (calFrom && d < calFrom) {
        setCalTo(calFrom);
        setCalFrom(d);
      } else {
        setCalTo(d);
      }
      setSelecting('from');
    }
  };

  const applyCustom = () => {
    if (!calFrom || !calTo) return;
    onChange({ from: calFrom, to: calTo });
    setOpen(false);
  };

  const prevMonth = () => {
    if (calMonth === 0) { setCalMonth(11); setCalYear(y => y - 1); }
    else setCalMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (calMonth === 11) { setCalMonth(0); setCalYear(y => y + 1); }
    else setCalMonth(m => m + 1);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 hover:border-gray-300 bg-white transition-colors"
      >
        <Calendar size={14} className="text-gray-400" />
        {label && <span className="text-gray-400">{label}:</span>}
        <span>{formatDisplay()}</span>
      </button>

      {open && (
        <div className="absolute top-full mt-1 right-0 z-50 bg-white border border-gray-200 rounded-xl shadow-lg min-w-[200px]">
          {!showCalendar ? (
            <div className="p-1">
              {presets.map(p => (
                <button
                  key={p}
                  onClick={() => handlePreset(p)}
                  className={`w-full text-left px-3 py-2 text-sm rounded-lg transition-colors ${
                    activePreset === p ? 'bg-[#0F4C81] text-white' : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {PRESET_LABELS[p]}
                </button>
              ))}
            </div>
          ) : (
            <div className="p-3">
              <div className="flex items-center justify-between mb-3">
                <button onClick={() => { setShowCalendar(false); }} className="text-xs text-gray-400 hover:text-gray-700 flex items-center gap-1">
                  <X size={12} /> Close calendar
                </button>
                <div className="flex items-center gap-2">
                  <button onClick={prevMonth} className="p-1 hover:bg-gray-100 rounded"><ChevronLeft size={14} /></button>
                  <span className="text-sm font-medium text-gray-700">{MONTHS[calMonth]} {calYear}</span>
                  <button onClick={nextMonth} className="p-1 hover:bg-gray-100 rounded"><ChevronRight size={14} /></button>
                </div>
              </div>
              <p className="text-xs text-gray-400 mb-2">
                {selecting === 'from' ? 'Select start date' : `Start: ${calFrom} — select end date`}
              </p>
              <CalendarMonth
                year={calYear} month={calMonth}
                selecting={selecting}
                selectedFrom={calFrom} selectedTo={calTo}
                hoverDate={hoverDate}
                onSelectDate={handleDateSelect}
                onHoverDate={setHoverDate}
              />
              {calFrom && calTo && (
                <button
                  onClick={applyCustom}
                  className="mt-2 w-full bg-[#0F4C81] text-white text-sm py-2 rounded-lg hover:bg-[#0d3d69] transition-colors"
                >
                  Apply: {calFrom} → {calTo}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
