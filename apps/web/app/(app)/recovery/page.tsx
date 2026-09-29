'use client';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { RECOVERY_STATUS_LABELS, type RecoveryStatus } from '@rupeemap/shared';
import { api } from '@/lib/api';
import { formatINRCompact } from '@/lib/format';
import { useMe } from '@/lib/session';
import { PageHeader } from '@/components/shell';
import { DateRangeFilter, DEFAULT_RANGE, rangeToParams, type RangeValue } from '@/components/date-range';
import { RecoveryList } from '@/components/recovery';
import { cx, Kpi } from '@/components/ui';

const FILTERS: { key: string; label: string; status: string }[] = [
  { key: 'open', label: 'Open', status: 'RECOVERY_PENDING,BANK_RECOVERY_RECEIVED,DEMAND_RAISED,PARTIALLY_RECOVERED,DISPUTED' },
  { key: 'demand', label: RECOVERY_STATUS_LABELS.DEMAND_RAISED, status: 'DEMAND_RAISED,PARTIALLY_RECOVERED' },
  { key: 'disputed', label: RECOVERY_STATUS_LABELS.DISPUTED, status: 'DISPUTED' },
  { key: 'done', label: 'Recovered, waived or closed', status: 'FULLY_RECOVERED,WAIVED,CLOSED' },
  { key: 'all', label: 'All', status: '' },
];

export default function RecoveryPage() {
  const { data: me } = useMe();
  const [filter, setFilter] = useState('open');
  const [range, setRange] = useState<RangeValue>(DEFAULT_RANGE);
  const dates = rangeToParams(range);
  const status = FILTERS.find((f) => f.key === filter)!.status;
  const summary = useQuery({
    queryKey: ['recoveries', 'summary', dates],
    queryFn: async () => (await api.page<unknown>('/recoveries', { pageSize: 1, ...dates })).meta.summary as { bankRecovered: number; demanded: number; received: number; outstanding: number; byStatus: { status: RecoveryStatus; count: number }[] },
  });
  const s = summary.data;
  const staff = me?.role === 'ADMIN' || me?.role === 'EXECUTIVE';
  return (
    <div className="space-y-4">
      <PageHeader
        title="Recovery"
        sub={staff ? 'Payouts the bank clawed back: record them, raise a demand on the partner and enter what they repay. Outstanding is always demanded minus received.' : 'Payouts the bank clawed back on your cases, and what Rupeemap has asked you to repay. Contact Rupeemap if anything looks wrong.'}
      />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto px-1" role="tablist" aria-label="Recovery status">
          {FILTERS.map((f) => (
            <button key={f.key} role="tab" aria-selected={filter === f.key} onClick={() => setFilter(f.key)} className={cx('shrink-0 rounded-xl px-3 py-2 text-sm font-semibold', filter === f.key ? 'bg-teal-700 text-white' : 'bg-white text-ink-600 ring-1 ring-ink-200 hover:bg-ink-50')}>
              {f.label}
            </button>
          ))}
        </div>
        <DateRangeFilter value={range} onChange={setRange} />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {(
          [
            ['all', 'Bank recovered', s?.bankRecovered, 'neutral'],
            ['demand', 'Demanded', s?.demanded, 'gold'],
            ['done', 'Received back', s?.received, 'teal'],
            ['open', 'Outstanding', s?.outstanding, s?.outstanding ? 'red' : 'neutral'],
          ] as const
        ).map(([key, label, value, tone]) => (
          <button key={key} onClick={() => setFilter(key)} className={cx('rounded-2xl text-left ring-2 transition', filter === key ? 'ring-teal-600' : 'ring-transparent')} aria-pressed={filter === key}>
            <Kpi label={label} value={value === undefined ? '–' : formatINRCompact(value)} tone={tone} sub={`Show ${FILTERS.find((f) => f.key === key)!.label.toLowerCase()}`} />
          </button>
        ))}
      </div>
      <RecoveryList key={filter + JSON.stringify(dates)} status={status} dates={dates} />
    </div>
  );
}
