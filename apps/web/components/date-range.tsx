'use client';
/** Period filter used on dashboards and reports: quick presets plus a custom from/to range. */
import { CalendarRange } from 'lucide-react';
import { cx } from './ui';

export type RangeKey = 'all' | 'today' | 'week' | 'month' | 'custom';
export interface RangeValue {
  key: RangeKey;
  from: string; // yyyy-mm-dd, used when key = custom
  to: string;
}

export const DEFAULT_RANGE: RangeValue = { key: 'all', from: '', to: '' };

const PRESETS: { key: RangeKey; label: string }[] = [
  { key: 'all', label: 'All time' },
  { key: 'month', label: 'This month' },
  { key: 'week', label: 'Last 7 days' },
  { key: 'today', label: 'Today' },
  { key: 'custom', label: 'Custom' },
];

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** API params (ISO timestamps). Custom dates cover the whole of both days in the viewer's time zone. */
export function rangeToParams(r: RangeValue): { from?: string; to?: string } {
  const now = new Date();
  if (r.key === 'today') return { from: new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString() };
  if (r.key === 'week') return { from: new Date(Date.now() - 7 * 86_400_000).toISOString() };
  if (r.key === 'month') return { from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString() };
  if (r.key === 'custom') {
    const out: { from?: string; to?: string } = {};
    if (r.from) out.from = new Date(`${r.from}T00:00:00`).toISOString();
    if (r.to) out.to = new Date(`${r.to}T23:59:59.999`).toISOString();
    return out;
  }
  return {};
}

export function DateRangeFilter({ value, onChange, className }: { value: RangeValue; onChange: (v: RangeValue) => void; className?: string }) {
  const today = ymd(new Date());
  const invalid = value.key === 'custom' && !!value.from && !!value.to && value.from > value.to;
  return (
    <div className={cx('flex flex-col items-stretch gap-2 sm:items-end', className)}>
      <div className="no-scrollbar flex overflow-x-auto rounded-xl bg-white p-1 shadow-card ring-1 ring-ink-200/70" role="tablist" aria-label="Date range">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            role="tab"
            aria-selected={value.key === p.key}
            onClick={() =>
              onChange(
                p.key === 'custom' && !value.from
                  ? { key: 'custom', from: ymd(new Date(new Date().getFullYear(), new Date().getMonth(), 1)), to: today }
                  : { ...value, key: p.key },
              )
            }
            className={cx('flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold', value.key === p.key ? 'bg-teal-700 text-white' : 'text-ink-600 hover:bg-ink-50')}
          >
            {p.key === 'custom' && <CalendarRange className="h-3.5 w-3.5" />}
            {p.label}
          </button>
        ))}
      </div>
      {value.key === 'custom' && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-1.5">
            <span className="text-ink-500">From</span>
            <input
              type="date"
              value={value.from}
              max={value.to || today}
              onChange={(e) => onChange({ ...value, from: e.target.value })}
              className="h-9 rounded-lg border border-ink-200 bg-white px-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-4 focus:ring-teal-100"
            />
          </label>
          <label className="flex items-center gap-1.5">
            <span className="text-ink-500">To</span>
            <input
              type="date"
              value={value.to}
              min={value.from || undefined}
              max={today}
              onChange={(e) => onChange({ ...value, to: e.target.value })}
              className="h-9 rounded-lg border border-ink-200 bg-white px-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-4 focus:ring-teal-100"
            />
          </label>
          {invalid && <span className="text-xs font-medium text-brand-red">From date is after To date</span>}
        </div>
      )}
    </div>
  );
}
