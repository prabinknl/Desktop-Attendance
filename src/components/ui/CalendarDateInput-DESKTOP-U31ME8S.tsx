import React, { useMemo } from 'react';
import {
  adYmdToBsYmd,
  bsYmdToAdYmd,
  BS_MONTH_OPTIONS,
  getBsMonthDayCount,
  type CalendarSystem,
} from '../../lib/dateDisplay';

interface Props {
  /** Stored value is always AD `yyyy-MM-dd`. */
  value: string;
  onChange: (adYmd: string) => void;
  calendar: CalendarSystem;
  min?: string;
  max?: string;
  className?: string;
}

function parseYmd(ymd: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(ymd.trim());
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

/** Date input that supports AD (native) or BS (Nepali year/month/day). Value is always AD ymd. */
export default function CalendarDateInput({
  value,
  onChange,
  calendar,
  min,
  max,
  className = '',
}: Props) {
  const bsYmd = useMemo(() => (value ? adYmdToBsYmd(value) : ''), [value]);
  const bsParts = parseYmd(bsYmd) ?? parseYmd(adYmdToBsYmd(new Date().toISOString().slice(0, 10)));

  const yearOptions = useMemo(() => {
    const current = bsParts?.y ?? 2083;
    const years: number[] = [];
    // Wide past range so back-dated leave/attendance entries are selectable
    for (let y = current - 20; y <= current + 5; y += 1) years.push(y);
    return years;
  }, [bsParts?.y]);

  const dayCount = bsParts ? getBsMonthDayCount(bsParts.y, bsParts.m) : 30;

  if (calendar === 'ad') {
    return (
      <input
        type="date"
        value={value}
        min={min || undefined}
        max={max || undefined}
        onChange={(e) => onChange(e.target.value)}
        className={className || 'input py-2 w-auto'}
      />
    );
  }

  const emitBs = (y: number, m: number, d: number) => {
    const maxDay = getBsMonthDayCount(y, m);
    const day = Math.min(d, maxDay);
    const ad = bsYmdToAdYmd(
      `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    );
    if (!ad) return;
    if (min && ad < min) return;
    if (max && ad > max) return;
    onChange(ad);
  };

  if (!bsParts) return null;

  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <select
        aria-label="BS year"
        value={bsParts.y}
        onChange={(e) => emitBs(Number(e.target.value), bsParts.m, bsParts.d)}
        className="input py-2 w-auto min-w-[5.5rem]"
      >
        {yearOptions.map((y) => (
          <option key={y} value={y}>
            {y} BS
          </option>
        ))}
      </select>
      <select
        aria-label="BS month"
        value={bsParts.m}
        onChange={(e) => emitBs(bsParts.y, Number(e.target.value), bsParts.d)}
        className="input py-2 w-auto min-w-[8rem]"
      >
        {BS_MONTH_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <select
        aria-label="BS day"
        value={Math.min(bsParts.d, dayCount)}
        onChange={(e) => emitBs(bsParts.y, bsParts.m, Number(e.target.value))}
        className="input py-2 w-auto min-w-[4.5rem]"
      >
        {Array.from({ length: dayCount }, (_, i) => i + 1).map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>
    </div>
  );
}
